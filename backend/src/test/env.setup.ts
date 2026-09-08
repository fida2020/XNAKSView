// FIRST entry in vitest.config.ts's `setupFiles` — this must run, and fully
// resolve, before src/test/setup.ts (or anything it imports, including
// lib/prisma.ts's PrismaClient singleton and config/env.ts's env parsing)
// is ever imported. Vitest imports setupFiles in array order and awaits
// each one's module evaluation before moving to the next, which is what
// makes it safe to overwrite process.env.DATABASE_URL here: no other module
// has read it yet.
//
// This is layer 1 of 2. Layer 2 is the runtime re-check in
// src/test/setup.ts's beforeAll, right before the destructive TRUNCATE, in
// case this file is ever bypassed, reordered, or edited incorrectly.
import dotenv from 'dotenv';

import { parseDatabaseName, resolveTestDatabaseUrl } from './dbGuard';

dotenv.config();

const devDatabaseUrl = process.env.DATABASE_URL;
const testDatabaseUrl = resolveTestDatabaseUrl(process.env);

// Snapshot the real dev URL under a different key so setup.ts's layer-2
// guard can still compare against it after DATABASE_URL is overwritten
// below, and so the isolation safety test itself can prove the dev
// database was never the one actually connected to.
process.env.DEV_DATABASE_URL_SNAPSHOT = devDatabaseUrl ?? '';
process.env.DATABASE_URL = testDatabaseUrl;

if (process.env.TEST_REDIS_URL) {
  process.env.DEV_REDIS_URL_SNAPSHOT = process.env.REDIS_URL ?? '';
  process.env.REDIS_URL = process.env.TEST_REDIS_URL;
}

const dbName = parseDatabaseName(testDatabaseUrl);
let host = 'unknown';
let port = 'unknown';
try {
  const parsed = new URL(testDatabaseUrl);
  host = parsed.hostname;
  port = parsed.port || '5432';
} catch {
  // Name-only fallback above already covers the "no secrets" requirement.
}

// Safe identifier only — no username, no password, ever.
// eslint-disable-next-line no-console
console.log(`[test-db-guard] TEST DB HOST = ${host}:${port} | TEST DB NAME = ${dbName} | DATABASE ROLE = TEST`);
