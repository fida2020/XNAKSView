import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    env: { NODE_ENV: 'test' },
    testTimeout: 15_000,
    // Test files share one Postgres/Redis connection and a truncate-on-start
    // fixture reset, so they must not run concurrently against each other.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
