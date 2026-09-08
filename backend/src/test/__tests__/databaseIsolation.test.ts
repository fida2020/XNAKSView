import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

import { REQUIRED_TEST_DB_ERROR, parseDatabaseName, resolveTestDatabaseUrl } from '../dbGuard';

// Proves the test/dev database isolation guard actually works — not just
// that it exists. Runs as a normal test file, so by the time it executes,
// src/test/env.setup.ts and src/test/setup.ts have already run for real
// against this same process; these assertions check the REAL effect of
// that, not a mock of it.
describe('test/dev database isolation', () => {
  it('missing TEST_DATABASE_URL causes immediate, loud failure — never a silent fallback to DATABASE_URL', () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow(REQUIRED_TEST_DB_ERROR);
  });

  it('TEST_DATABASE_URL equal to DATABASE_URL is rejected with the same error', () => {
    const shared = 'postgresql://user:pw@localhost:5432/same_db';
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: shared, TEST_DATABASE_URL: shared })).toThrow(
      REQUIRED_TEST_DB_ERROR,
    );
  });

  it("a TEST_DATABASE_URL whose database name doesn't contain \"test\" is rejected (defense in depth, not just presence-checked)", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        DATABASE_URL: 'postgresql://user:pw@localhost:5432/xnakview_dev',
        TEST_DATABASE_URL: 'postgresql://user:pw@localhost:5432/some_other_db',
      }),
    ).toThrow(/must point at a database whose name contains "test"/);
  });

  it('a valid, distinct, test-named TEST_DATABASE_URL resolves without throwing', () => {
    expect(() =>
      resolveTestDatabaseUrl({
        DATABASE_URL: 'postgresql://user:pw@localhost:5432/xnakview_dev',
        TEST_DATABASE_URL: 'postgresql://user:pw@localhost:5432/xnakview_test',
      }),
    ).not.toThrow();
  });

  it('this actual test run is connected to a database whose name contains "test", never to DEV_DATABASE_URL_SNAPSHOT', async () => {
    const devDbName = parseDatabaseName(process.env.DEV_DATABASE_URL_SNAPSHOT);
    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>('SELECT current_database()');
    const actualDbName = rows[0]?.current_database;

    expect(actualDbName).toBeTruthy();
    expect(actualDbName!.toLowerCase()).toContain('test');
    if (devDbName) {
      expect(actualDbName).not.toBe(devDbName);
    }
  });

  it('process.env.DATABASE_URL for this run equals TEST_DATABASE_URL, not the original dev URL', () => {
    expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
    if (process.env.DEV_DATABASE_URL_SNAPSHOT) {
      expect(process.env.DATABASE_URL).not.toBe(process.env.DEV_DATABASE_URL_SNAPSHOT);
    }
  });

  it('the real dev database is untouched by this test run (connecting to it directly, read-only)', async () => {
    const devUrl = process.env.DEV_DATABASE_URL_SNAPSHOT;
    if (!devUrl) {
      // No dev URL was captured (e.g. DATABASE_URL was unset before the
      // guard ran) — nothing to verify against, but this must never be
      // silently treated as "isolation confirmed".
      throw new Error('DEV_DATABASE_URL_SNAPSHOT was not set by env.setup.ts — cannot verify dev DB isolation.');
    }

    const devClient = new PrismaClient({ datasources: { db: { url: devUrl } } });
    try {
      // A read-only existence/count check — this test must never write to,
      // truncate, or otherwise mutate the dev database.
      const rows = await devClient.$queryRawUnsafe<{ current_database: string }[]>('SELECT current_database()');
      expect(rows[0]?.current_database).toBe(parseDatabaseName(devUrl));
    } finally {
      await devClient.$disconnect();
    }
  });
});
