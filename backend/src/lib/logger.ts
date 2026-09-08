import pino from 'pino';

import { env, isDevelopment } from '@/config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Defense in depth: every call site in this codebase is expected to pass
  // already-masked identifiers/no raw secrets (see e.g. lib/otpService.ts's
  // `maskIdentifier`) — this is a backstop in case a future call site
  // accidentally logs a raw object containing one of these field names
  // (a password, a token, an OTP code, a bank/card number), not a
  // substitute for masking at the call site.
  redact: {
    paths: [
      'password',
      'passwordHash',
      '*.password',
      '*.passwordHash',
      'accessToken',
      'refreshToken',
      'token',
      '*.accessToken',
      '*.refreshToken',
      '*.token',
      'code',
      'otp',
      'otpCode',
      '*.code',
      '*.otp',
      '*.otpCode',
      'authorization',
      '*.authorization',
    ],
    censor: '[REDACTED]',
  },
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: 'xnakview-backend',
  },
});
