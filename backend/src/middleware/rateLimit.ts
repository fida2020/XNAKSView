import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

import { env, isTest } from '@/config/env';
import { redis } from '@/lib/redis';

export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later.',
    },
  },
});

export function createRateLimiter(windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later.',
      },
    },
  });
}

/**
 * Per-IP limiter backed by Redis (shared across server instances, unlike the
 * default in-memory store) for endpoints that need tighter abuse protection
 * than the global limiter, e.g. registration and login.
 *
 * Disabled in tests: automated tests deliberately exercise these endpoints
 * many times from the same "client", which would otherwise trip the limiter
 * and make unrelated tests fail. Endpoint-specific abuse protection (e.g. the
 * per-identifier login lockout) is exercised directly by its own test.
 */
export function createAuthRateLimiter(windowMs: number, limit: number, keyPrefix: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    store: new RedisStore({
      prefix: `ratelimit:${keyPrefix}:`,
      sendCommand: (...args: string[]) => (redis.call as unknown as (...args: string[]) => Promise<never>)(...args),
    }),
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later.',
      },
    },
  });
}
