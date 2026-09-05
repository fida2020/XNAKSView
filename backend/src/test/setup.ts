import { afterAll, beforeAll } from 'vitest';

import { connectDatabase, disconnectDatabase, prisma } from '@/lib/prisma';
import { connectRedis, disconnectRedis, redis } from '@/lib/redis';

beforeAll(async () => {
  await connectDatabase();
  await connectRedis();
  // Start each test run from a clean slate against the real dev database/Redis.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE sessions, devices, verifications, profiles, users RESTART IDENTITY CASCADE',
  );
  await redis.flushdb();
});

afterAll(async () => {
  await disconnectDatabase();
  await disconnectRedis();
});
