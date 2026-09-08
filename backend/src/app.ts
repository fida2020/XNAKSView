import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { corsOrigins, env } from '@/config/env';
import { logger } from '@/lib/logger';
import { errorHandlerMiddleware } from '@/middleware/errorHandler';
import { notFoundMiddleware } from '@/middleware/notFound';
import { globalRateLimiter } from '@/middleware/rateLimit';
import { requestIdMiddleware } from '@/middleware/requestId';
import { v1Router } from '@/routes/v1';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestIdMiddleware);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // pino-http's default request/response serializers log every header
      // verbatim — without this, every access token, refresh cookie, and
      // OTP-request-carrying cookie would land in plaintext in the log
      // stream on every single request. `censor` overwrites rather than
      // drops the key, so it's still visible in the log shape that a header
      // was present, just never its value.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["set-cookie"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(globalRateLimiter);

  app.use(env.API_PREFIX, v1Router);

  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}
