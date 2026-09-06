import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Storage is abstracted behind lib/storage — STORAGE_DRIVER is the only
  // thing that needs to change to move from local disk to object storage
  // (e.g. S3) later; nothing else in the codebase references the disk path
  // directly.
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),

  // LIVE streaming (Step 4) is behind lib/liveStreaming's LiveStreamingProvider
  // abstraction — LiveKit (self-hosted) is the only implementation today.
  // LIVEKIT_HOST is the backend's server-to-server control API address;
  // LIVEKIT_WS_URL is what's handed to clients (mobile) to actually connect.
  LIVEKIT_HOST: z.string().default('http://localhost:7880'),
  LIVEKIT_WS_URL: z.string().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().min(1, 'LIVEKIT_API_KEY is required'),
  LIVEKIT_API_SECRET: z.string().min(32, 'LIVEKIT_API_SECRET must be at least 32 characters'),

  // LIVE eligibility (Step 4) — configurable so business thresholds can
  // change without a code change. 0 disables the check. See lib/liveEligibility.ts.
  LIVE_MIN_ACCOUNT_AGE_HOURS: z.coerce.number().int().min(0).default(0),

  // Chat + calls (Step 5). See lib/voiceValidation.ts and routes/v1/calls.ts.
  MAX_VOICE_MESSAGE_SECONDS: z.coerce.number().int().positive().default(120),
  CALL_RING_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(45),
  // How long after sending a sender may unsend/delete a message. See
  // routes/v1/messages.ts.
  MESSAGE_UNSEND_WINDOW_MINUTES: z.coerce.number().int().positive().default(1440),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
