// Shared by src/test/env.setup.ts (first line of defense — runs before any
// application module, including lib/prisma.ts, is ever imported) and
// src/test/setup.ts (second line of defense — re-verified at runtime right
// before the destructive TRUNCATE). Deliberately has ZERO imports from the
// rest of the app so it is always safe to import first.
//
// This is the exact required error message from the database-isolation
// directive: tests must fail loudly, not fall back to DATABASE_URL.
export const REQUIRED_TEST_DB_ERROR =
  'TEST_DATABASE_URL is required. Refusing to run destructive tests against DATABASE_URL.';

export function parseDatabaseName(connectionUrl: string | undefined | null): string {
  if (!connectionUrl) return '';
  try {
    return new URL(connectionUrl).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

/**
 * Validates TEST_DATABASE_URL against DATABASE_URL and returns it. Throws
 * REQUIRED_TEST_DB_ERROR (verbatim) if it is missing or identical to
 * DATABASE_URL, and a separate loud error if it doesn't even look like a
 * test database by name — never silently falls back.
 */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const testUrl = env.TEST_DATABASE_URL;
  const devUrl = env.DATABASE_URL;

  if (!testUrl || !testUrl.trim()) {
    throw new Error(REQUIRED_TEST_DB_ERROR);
  }
  if (testUrl === devUrl) {
    throw new Error(REQUIRED_TEST_DB_ERROR);
  }

  const testDbName = parseDatabaseName(testUrl);
  if (!testDbName || !testDbName.toLowerCase().includes('test')) {
    throw new Error(
      `TEST_DATABASE_URL must point at a database whose name contains "test" (got "${testDbName || '(none)'}"). ` +
        'Refusing to run destructive tests against an unverified database.',
    );
  }

  return testUrl;
}
