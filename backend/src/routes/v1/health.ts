import { Router } from 'express';

import { checkDatabaseHealth } from '@/lib/prisma';
import { checkRedisHealth } from '@/lib/redis';

export const healthRouter = Router();

const startedAt = Date.now();

healthRouter.get('/health', async (_req, res) => {
  const [database, cache] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);

  const dependencies = { database, cache };
  const allHealthy = Object.values(dependencies).every((dep) => dep.ok);

  const body = {
    status: allHealthy ? 'ok' : 'degraded',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.1.0',
    dependencies,
  };

  res.status(allHealthy ? 200 : 503).json(body);
});
