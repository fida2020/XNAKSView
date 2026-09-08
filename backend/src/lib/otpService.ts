import { createHmac, randomInt, timingSafeEqual } from 'crypto';

import type { OtpChannel, OtpPurpose } from '@prisma/client';
import jwt from 'jsonwebtoken';

import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { emailProvider, smsProvider } from '@/lib/otpProviders';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

const OTP_VERIFICATION_TOKEN_TYPE = 'otp_verification';

/** A real, cryptographically random 6-digit code — never `123456`/`000000`/anything predictable. */
function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** HMAC, never the plaintext code — this codebase never persists or logs a real OTP anywhere (brief §3: "Never log OTPs or expose them in client logs"). */
function hashCode(code: string, identifier: string): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(`${identifier}:${code}`).digest('hex');
}

/** `+14155552671` -> `+*******2671`; `fida@example.com` -> `f***@example.com` — enough to confirm "yes, that's mine" without exposing the full identifier on screen. */
export function maskIdentifier(identifier: string, channel: OtpChannel): string {
  if (channel === 'EMAIL') {
    const atIndex = identifier.indexOf('@');
    if (atIndex < 1) return identifier;
    const name = identifier.slice(0, atIndex);
    const domain = identifier.slice(atIndex);
    return `${name.slice(0, 1)}${'*'.repeat(Math.max(name.length - 1, 3))}${domain}`;
  }
  const last4 = identifier.slice(-4);
  const maskedLength = Math.max(identifier.length - 4 - 1, 0);
  return `+${'*'.repeat(maskedLength)}${last4}`;
}

export interface RequestOtpParams {
  identifier: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
}

export interface RequestOtpResult {
  maskedIdentifier: string;
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
}

/**
 * Sends a real, server-generated OTP — the ONLY place an OTP is ever
 * created or dispatched. One `OtpChallenge` row is reused per
 * identifier+purpose across resends (updated in place), so `attempts`
 * resets on every genuine resend but `sendCount`/`lastSentAt` still bound
 * how often a resend itself is allowed (brief §8: resend throttling,
 * maximum verification attempts).
 */
export async function requestOtp(params: RequestOtpParams): Promise<RequestOtpResult> {
  const { identifier, channel, purpose } = params;

  if (purpose === 'REGISTER') {
    const existingUser = channel === 'EMAIL' ? await prisma.user.findUnique({ where: { email: identifier } }) : await prisma.user.findUnique({ where: { phone: identifier } });
    if (existingUser) {
      throw new AppError('CONFLICT', channel === 'EMAIL' ? 'Email is already registered' : 'Phone number is already registered');
    }
  }

  const activeChallenge = await prisma.otpChallenge.findFirst({
    where: { identifier, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (activeChallenge) {
    const cooldownEndsAt = new Date(activeChallenge.lastSentAt.getTime() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000);
    if (cooldownEndsAt.getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil((cooldownEndsAt.getTime() - Date.now()) / 1000);
      throw new AppError('RATE_LIMITED', `Please wait ${retryAfterSeconds}s before requesting another code`, { retryAfterSeconds });
    }
  }

  // For LOGIN, never reveal whether the identifier actually has an account
  // — always report success, but only actually generate/send a code when a
  // matching ACTIVE user exists.
  if (purpose === 'LOGIN') {
    const user = channel === 'EMAIL' ? await prisma.user.findUnique({ where: { email: identifier } }) : await prisma.user.findUnique({ where: { phone: identifier } });
    if (!user || user.status !== 'ACTIVE') {
      return { maskedIdentifier: maskIdentifier(identifier, channel), expiresInSeconds: env.OTP_CODE_TTL_SECONDS, resendAvailableInSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
    }
  }

  const code = generateCode();
  const codeHash = hashCode(code, identifier);
  const expiresAt = new Date(Date.now() + env.OTP_CODE_TTL_SECONDS * 1000);

  const challenge = activeChallenge
    ? await prisma.otpChallenge.update({
        where: { id: activeChallenge.id },
        data: { codeHash, attempts: 0, expiresAt, lastSentAt: new Date(), sendCount: { increment: 1 } },
      })
    : await prisma.otpChallenge.create({
        data: { identifier, channel, purpose, codeHash, expiresAt, lastSentAt: new Date() },
      });

  const message = `${code} is your XNAKView verification code. It expires in ${Math.round(env.OTP_CODE_TTL_SECONDS / 60)} minutes. Never share this code.`;
  const delivery = channel === 'EMAIL' ? await emailProvider.sendEmail(identifier, 'Your XNAKView verification code', message) : await smsProvider.sendSms(identifier, message);

  if (!delivery.sent) {
    logger.warn({ identifier: maskIdentifier(identifier, channel), channel, purpose, challengeId: challenge.id, reason: delivery.reason }, 'OTP delivery not sent');
    throw new AppError('SERVICE_UNAVAILABLE', delivery.reason ?? 'Verification code delivery is not available right now');
  }

  logger.info({ identifier: maskIdentifier(identifier, channel), channel, purpose, challengeId: challenge.id }, 'OTP sent');

  return {
    maskedIdentifier: maskIdentifier(identifier, channel),
    expiresInSeconds: env.OTP_CODE_TTL_SECONDS,
    resendAvailableInSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
  };
}

export interface VerifyOtpParams {
  identifier: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
  code: string;
}

/**
 * Verifies a submitted code against the stored HMAC — constant-time
 * comparison, incremented `attempts` on every failed check (never on
 * success), and a hard stop once `maxAttempts` is reached (must request a
 * fresh code). On success, issues a short-lived, single-purpose
 * `verificationToken` (a signed JWT whose `jti` is this exact
 * `OtpChallenge` row) proving phone/email ownership — this token, not the
 * OTP itself, is what `/auth/register` requires next.
 */
export async function verifyOtpCode(params: VerifyOtpParams): Promise<{ verificationToken: string; challengeId: string }> {
  const { identifier, channel, purpose, code } = params;

  const challenge = await prisma.otpChallenge.findFirst({
    where: { identifier, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired verification code');
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    throw new AppError('RATE_LIMITED', 'Too many incorrect attempts. Please request a new code.');
  }

  const submittedHash = hashCode(code, identifier);
  const storedHash = challenge.codeHash;
  const matches = submittedHash.length === storedHash.length && timingSafeEqual(Buffer.from(submittedHash), Buffer.from(storedHash));

  if (!matches) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    throw new AppError('UNAUTHORIZED', 'Invalid or expired verification code');
  }

  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

  const verificationToken = jwt.sign({ sub: identifier, channel, purpose, typ: OTP_VERIFICATION_TOKEN_TYPE }, env.JWT_ACCESS_SECRET, {
    expiresIn: '15m',
    jwtid: challenge.id,
  });

  return { verificationToken, challengeId: challenge.id };
}

interface OtpVerificationTokenPayload {
  sub: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
  typ: string;
  jti: string;
}

/**
 * Redeems a `verificationToken` for the given identifier/purpose —
 * `/auth/register`'s gate. Checks the JWT signature/expiry AND that the
 * underlying `OtpChallenge` is still consumed-but-not-yet-used-for-registration,
 * marking it used atomically with the check so the same token can never
 * complete two registrations (defense in depth on top of the unique
 * email/phone constraint).
 */
export async function redeemOtpVerificationToken(token: string, identifier: string, purpose: OtpPurpose): Promise<void> {
  let payload: OtpVerificationTokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as unknown as OtpVerificationTokenPayload;
  } catch {
    throw new AppError('UNAUTHORIZED', 'Your verification has expired. Please verify your phone/email again.');
  }
  if (payload.typ !== OTP_VERIFICATION_TOKEN_TYPE || payload.sub !== identifier || payload.purpose !== purpose) {
    throw new AppError('UNAUTHORIZED', 'This verification does not match the phone/email being registered');
  }

  const updated = await prisma.otpChallenge.updateMany({
    where: { id: payload.jti, identifier, purpose, consumedAt: { not: null }, registrationConsumedAt: null },
    data: { registrationConsumedAt: new Date() },
  });
  if (updated.count === 0) {
    throw new AppError('UNAUTHORIZED', 'Your verification has expired or was already used. Please verify your phone/email again.');
  }
}
