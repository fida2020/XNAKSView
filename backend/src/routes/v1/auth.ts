import { Router } from 'express';
import { Prisma } from '@prisma/client';

import { assessAccountCreationRisk } from '@/lib/fraudRiskEngine';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/password';
import { meetsMinimumAge, MINIMUM_REGISTRATION_AGE } from '@/lib/age';
import { issueSession, rotateSession } from '@/lib/session';
import { hashRefreshToken } from '@/lib/tokens';
import { assertNotLockedOut, clearFailedLogins, recordFailedLogin } from '@/lib/loginLockout';
import { requestOtp, verifyOtpCode, redeemOtpVerificationToken } from '@/lib/otpService';
import { validate } from '@/middleware/validate';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { AppError } from '@/utils/AppError';
import { loginSchema, otpRequestSchema, otpVerifySchema, refreshSchema, registerSchema } from '@/schemas/auth.schema';

export const authRouter = Router();

const registerLimiter = createAuthRateLimiter(60 * 60 * 1000, 5, 'register');
const loginLimiter = createAuthRateLimiter(15 * 60 * 1000, 15, 'login');
const refreshLimiter = createAuthRateLimiter(15 * 60 * 1000, 60, 'refresh');
const otpRequestLimiter = createAuthRateLimiter(15 * 60 * 1000, 5, 'otp-request');
const otpVerifyLimiter = createAuthRateLimiter(15 * 60 * 1000, 20, 'otp-verify');

/**
 * OTP-first signup/login (real, server-generated/server-verified codes only
 * — see lib/otpService.ts/lib/otpProviders.ts, never a fake/hardcoded/
 * client-side-bypass OTP). `/auth/otp/request` sends the code;
 * `/auth/otp/verify` checks it — for REGISTER, returning a short-lived
 * `verificationToken` that `/auth/register` below requires; for LOGIN,
 * completing the login immediately (a passwordless alternative to
 * `/auth/login`, going through the exact same lockout/status/session
 * machinery).
 */
authRouter.post('/auth/otp/request', otpRequestLimiter, validate({ body: otpRequestSchema }), async (req, res, next) => {
  try {
    const { email, phone, purpose } = req.body;
    const identifier = (email ?? phone) as string;
    const channel = email ? 'EMAIL' : 'SMS';
    const result = await requestOtp({ identifier, channel, purpose });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post('/auth/otp/verify', otpVerifyLimiter, validate({ body: otpVerifySchema }), async (req, res, next) => {
  try {
    const { email, phone, purpose, code, device } = req.body;
    const identifier = (email ?? phone) as string;
    const channel = email ? 'EMAIL' : 'SMS';

    const { verificationToken } = await verifyOtpCode({ identifier, channel, purpose, code });

    if (purpose === 'REGISTER') {
      res.status(200).json({ verified: true, verificationToken });
      return;
    }

    // LOGIN — the OTP itself already proved ownership; complete login now
    // through the exact same checks as password login (account status,
    // failed-login clearing, session issuance).
    await assertNotLockedOut(identifier);
    const user = email ? await prisma.user.findUnique({ where: { email } }) : await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'Invalid or expired verification code');
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError('FORBIDDEN', `Account is ${user.status.toLowerCase().replace('_', ' ')}`);
    }
    await clearFailedLogins(identifier);
    const tokens = await issueSession(user.id, device);
    res.status(200).json({
      user: { id: user.id, email: user.email, phone: user.phone, status: user.status, ageVerified: user.ageVerified },
      ...tokens,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/auth/register', registerLimiter, validate({ body: registerSchema }), async (req, res, next) => {
  try {
    const { email, phone, password, dateOfBirth, device, verificationToken } = req.body;
    const identifier = (email ?? phone) as string;

    // Never trust a client-supplied age/ageVerified value — always derive it
    // server-side from the submitted date of birth.
    if (!meetsMinimumAge(dateOfBirth)) {
      throw new AppError('FORBIDDEN', `You must be at least ${MINIMUM_REGISTRATION_AGE} years old to register`);
    }

    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) throw new AppError('CONFLICT', 'Email is already registered');
    }
    if (phone) {
      const existing = await prisma.user.findUnique({ where: { phone } });
      if (existing) throw new AppError('CONFLICT', 'Phone number is already registered');
    }

    // OTP verification (above) proves ownership of the phone/email — this
    // is what actually gates account creation now, not merely knowing the
    // identifier. Deliberately checked LAST (after age/conflict), so a
    // registration that fails for an unrelated reason (under 18, a race
    // against a just-completed duplicate registration) never burns the
    // verification and forces the user to re-verify their phone/email just
    // to fix a birthday typo. Redeeming also marks the underlying
    // OtpChallenge used, so the same verification can never complete a
    // second registration.
    await redeemOtpVerificationToken(verificationToken, identifier, 'REGISTER');

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        passwordHash,
        dateOfBirth,
        ageVerified: true,
        status: 'ACTIVE',
      },
    });

    // Step 10 fraud extension — informational rapid-account-creation signal
    // (see fraudRiskEngine.ts's doc comment on why this never blocks
    // registration by itself). Best-effort: never fails registration.
    try {
      await assessAccountCreationRisk(req.ip ?? null);
    } catch (error) {
      logger.error({ err: error }, 'assessAccountCreationRisk failed');
    }

    const tokens = await issueSession(user.id, device);

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        status: user.status,
        ageVerified: user.ageVerified,
      },
      ...tokens,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('CONFLICT', 'Email or phone is already registered'));
      return;
    }
    next(error);
  }
});

authRouter.post('/auth/login', loginLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { email, phone, username, password, device } = req.body;
    const identifier = (email ?? phone ?? username) as string;

    await assertNotLockedOut(identifier);

    const user = email
      ? await prisma.user.findUnique({ where: { email } })
      : phone
        ? await prisma.user.findUnique({ where: { phone } })
        : (await prisma.profile.findUnique({ where: { username }, include: { user: true } }))?.user ?? null;

    // A social-only account (Google/Facebook, never a password) has a null
    // hash — password login correctly fails for it rather than throwing.
    const passwordMatches = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;

    if (!user || !passwordMatches) {
      await recordFailedLogin(identifier);
      throw new AppError('UNAUTHORIZED', 'Invalid email/phone/username or password');
    }

    if (user.status !== 'ACTIVE') {
      throw new AppError('FORBIDDEN', `Account is ${user.status.toLowerCase().replace('_', ' ')}`);
    }

    await clearFailedLogins(identifier);

    const tokens = await issueSession(user.id, device);

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        status: user.status,
        ageVerified: user.ageVerified,
      },
      ...tokens,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/auth/refresh', refreshLimiter, validate({ body: refreshSchema }), async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const session = await prisma.session.findUnique({ where: { refreshTokenHash } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new AppError('UNAUTHORIZED', 'Invalid or expired refresh token');
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new AppError('FORBIDDEN', 'Account is not active');
    }

    const tokens = await rotateSession(session.id);

    res.status(200).json(tokens);
  } catch (error) {
    next(error);
  }
});

authRouter.post('/auth/logout', requireAuth, async (req, res, next) => {
  try {
    await prisma.session.updateMany({
      where: { id: req.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    res.status(200).json({ message: 'Logged out' });
  } catch (error) {
    next(error);
  }
});
