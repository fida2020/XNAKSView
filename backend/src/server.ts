import type { Server } from 'http';

import { createApp } from '@/app';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { connectDatabase, disconnectDatabase } from '@/lib/prisma';
import { connectRedis, disconnectRedis } from '@/lib/redis';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  // Dependency connections are kicked off in the background rather than awaited
  // here: ioredis retries indefinitely by design (see retryStrategy in lib/redis.ts),
  // so blocking startup on it would hang the process whenever Redis is unreachable.
  // The HTTP server must come up regardless of dependency availability — the
  // health endpoint reports live per-request status for each dependency.
  connectDatabase().catch((err) => {
    logger.error({ err }, 'Failed to connect to PostgreSQL at startup');
  });
  connectRedis().catch((err) => {
    logger.error({ err }, 'Failed to connect to Redis at startup');
  });

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(`XNAKView backend listening on port ${env.PORT} (${env.NODE_ENV})`);
    logger.info(`API base path: ${env.API_PREFIX}`);
  });

  let listening = false;
  server.once('listening', () => {
    listening = true;
  });

  // A failure to bind (e.g. EADDRINUSE) fires here, not as an uncaughtException
  // path through server.close() — closing a server that never started listening
  // throws ERR_SERVER_NOT_RUNNING, which would otherwise mask the real error.
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (!listening && error.code === 'EADDRINUSE') {
      logger.error(`Port ${env.PORT} is already in use`);
      process.exit(1);
    }
    logger.error({ err: error }, 'HTTP server error');
  });

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, starting graceful shutdown`);

    const forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    server.close(async (err) => {
      if (err) {
        logger.error({ err }, 'Error while closing HTTP server');
      } else {
        logger.info('HTTP server closed');
      }

      await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);

      clearTimeout(forceExitTimer);
      process.exit(err ? 1 : 0);
    });
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });
}

void main();
