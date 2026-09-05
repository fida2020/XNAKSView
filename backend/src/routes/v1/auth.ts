import { Router } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/password';
import { meetsMinimumAge, MINIMUM_REGISTRATION_AGE } from '@/lib/age';
import { issueSession, rotateSession } from '@/lib/session';
import { hashRefreshToken } from '@/lib/tokens';
import { assertNotLockedOut, clearFailedLogins, recordFailedLogin } from '@/lib/loginLockout';
import { validate } from '@/middleware/validate';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { AppError } from '@/utils/AppError';
import { loginSchema, refreshSchema, registerSchema } from '@/schemas/auth.schema';

export const authRouter = Router();

const registerLimiter = createAuthRateLimiter(60 * 60 * 1000, 5, 'register');
const loginLimiter = createAuthRateLimiter(15 * 60 * 1000, 15, 'login');
const refreshLimiter = createAuthRateLimiter(15 * 60 * 1000, 60, 'refresh');

authRouter.post('/auth/register', registerLimiter, validate({ body: registerSchema }), async (req, res, next) => {
  try {
    const { email, phone, password, dateOfBirth, device } = req.body;

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
    const { email, phone, password, device } = req.body;
    const identifier = (email ?? phone) as string;

    await assertNotLockedOut(identifier);

    const user = email
      ? await prisma.user.findUnique({ where: { email } })
      : await prisma.user.findUnique({ where: { phone } });

    const passwordMatches = user ? await verifyPassword(password, user.passwordHash) : false;

    if (!user || !passwordMatches) {
      await recordFailedLogin(identifier);
      throw new AppError('UNAUTHORIZED', 'Invalid email/phone or password');
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
