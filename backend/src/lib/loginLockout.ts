import { redis } from '@/lib/redis';
import { AppError } from '@/utils/AppError';

const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;

function lockoutKey(identifier: string): string {
  return `auth:login-fail:${identifier.toLowerCase()}`;
}

/** Throws RATE_LIMITED if this identifier (email or phone) has too many recent failed login attempts. */
export async function assertNotLockedOut(identifier: string): Promise<void> {
  const attempts = await redis.get(lockoutKey(identifier));
  if (attempts && Number(attempts) >= MAX_FAILED_ATTEMPTS) {
    throw new AppError('RATE_LIMITED', 'Too many failed login attempts. Please try again later.');
  }
}

export async function recordFailedLogin(identifier: string): Promise<void> {
  const key = lockoutKey(identifier);
  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, LOCKOUT_WINDOW_SECONDS);
  }
}

export async function clearFailedLogins(identifier: string): Promise<void> {
  await redis.del(lockoutKey(identifier));
}
