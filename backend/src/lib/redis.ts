import Redis from 'ioredis';

import { env } from '@/config/env';
import { logger } from '@/lib/logger';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
});

redis.on('error', (error) => {
  logger.error({ err: error }, 'Redis client error');
});

redis.on('connect', () => {
  logger.info('Redis connection established');
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

export async function connectRedis(): Promise<void> {
  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }
}

export async function disconnectRedis(): Promise<void> {
  redis.disconnect();
}

export async function checkRedisHealth(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown Redis error' };
  }
}
