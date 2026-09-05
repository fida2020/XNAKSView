import { randomBytes, createHash } from 'crypto';

import jwt from 'jsonwebtoken';

import { env } from '@/config/env';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

const REFRESH_TOKEN_BYTES = 48;

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'] });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

/** Opaque, high-entropy refresh token. Only its SHA-256 hash is ever persisted. */
export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const DURATION_UNIT_MS: Record<'s' | 'm' | 'h' | 'd', number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parses simple durations like "15m", "30d" (as used by JWT_*_TTL) into milliseconds. */
export function parseDurationMs(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}" (expected e.g. "15m", "30d")`);
  }
  const [, amount, unit] = match as unknown as [string, string, keyof typeof DURATION_UNIT_MS];
  return Number(amount) * DURATION_UNIT_MS[unit];
}
