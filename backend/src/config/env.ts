import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Dedicated test-only database — never read by the running app itself.
  // Only src/test/env.setup.ts reads this (before DATABASE_URL is ever
  // consumed by lib/prisma.ts) to point the test run at a completely
  // separate database. Optional here so production/dev env validation never
  // depends on it existing.
  TEST_DATABASE_URL: z.string().optional(),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Same idea as TEST_DATABASE_URL, for Redis — see src/test/env.setup.ts.
  TEST_REDIS_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Step 10 — HMAC key for `lib/moderation/identityTrust.ts`'s one-way
  // identity fingerprint ("one verified identity = one account"). Falls
  // back to JWT_ACCESS_SECRET when unset so this never blocks local dev/
  // test setup; set independently in production for key separation.
  IDENTITY_FINGERPRINT_SECRET: z.string().min(32).optional(),

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
  // Video editor rebuild — the real font file `drawtext` burns caption/text
  // overlays with. This is a genuine external dependency, not something
  // that can be faked: ffmpeg's drawtext needs an actual on-disk font, and
  // this repo doesn't bundle/own one to ship cross-platform. Defaults to a
  // font already present on this Windows dev machine; a real deployment
  // must set this to a font file it has the rights to ship/install.
  DRAWTEXT_FONT_PATH: z.string().default('C:/Windows/Fonts/arial.ttf'),

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

  // Step 6: Creator Playlists unlock at this many followers, enforced
  // server-side in routes/v1/playlists.ts. Centrally configurable so the
  // threshold can change without a code change — the product default is
  // 5000 and must not be hardcoded anywhere else.
  CREATOR_PLAYLIST_MIN_FOLLOWERS: z.coerce.number().int().min(0).default(5000),

  // Step 7: Coins & Gifts. The PKR-per-Coin value (1.50) is LOCKED and
  // lives as a literal constant in lib/coinEconomy.ts, never here — the
  // PKR/USD exchange rate is configurable via the ExchangeRate table, and
  // the platform/creator split of a Gift's Coin value is configurable via
  // the versioned PlatformRevenueRule table (admin-managed, snapshotted on
  // every GiftTransaction) — never an env var, since TikTok's real split
  // is not publicly disclosed and no XNAKView-invented number should look
  // like a fixed build-time constant.

  // Real Apple/Google verification is only attempted when these are set;
  // otherwise those two providers refuse verification outright rather than
  // silently pretending to succeed (see lib/paymentProviders.ts).
  APPLE_SHARED_SECRET: z.string().optional(),
  APPLE_VERIFY_RECEIPT_URL: z.string().default('https://buy.itunes.apple.com/verifyReceipt'),
  APPLE_VERIFY_RECEIPT_SANDBOX_URL: z.string().default('https://sandbox.itunes.apple.com/verifyReceipt'),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),

  // Generic webhook-signature secret for the Web payment provider — a
  // provider-agnostic HMAC check (brief §4 names no specific gateway to
  // integrate), never a client-reported "payment succeeded" flag.
  WEB_PAYMENT_WEBHOOK_SECRET: z.string().optional(),

  // Real SMS OTP delivery (lib/otpProviders.ts's TwilioSmsProvider) — a
  // plain fetch-based call to Twilio's REST API, no SDK dependency. All
  // optional: when unset, SMS OTP delivery honestly refuses rather than
  // pretending a code was sent (brief §7).
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // Real email OTP delivery (lib/otpProviders.ts's SmtpEmailProvider) via
  // any standard SMTP account (Gmail app password, Mailtrap, a real
  // provider's SMTP relay, etc). All optional, same honest-refusal rule.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().optional(),

  // OTP challenge lifecycle (lib/otpService.ts) — centrally configurable
  // resend/expiry/attempt limits, never hardcoded at each call site.
  OTP_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // Real Google Sign-In server-side verification (lib/oauthProviders.ts).
  // This MUST be a "Web application" OAuth Client ID from Google Cloud
  // Console — the mobile app passes it to google_sign_in as
  // `serverClientId`, which makes Google issue an ID token audienced to
  // THIS id (not the Android client id) so the backend can verify it.
  // Optional: unset means Google sign-in honestly refuses (lib/oauthProviders.ts).
  GOOGLE_OAUTH_SERVER_CLIENT_ID: z.string().optional(),

  // Real Facebook Login server-side verification (lib/oauthProviders.ts) —
  // both required together. Optional: unset means Facebook sign-in
  // honestly refuses.
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),

  // Step 8: Creator Monetization — real ad-revenue webhook signature secret
  // (lib/adRevenueService.ts's webhook route), same provider-agnostic
  // HMAC-SHA256 verification style as WEB_PAYMENT_WEBHOOK_SECRET (brief
  // names no specific ad network to integrate). Unset in local dev means
  // the webhook honestly refuses rather than trusting an unsigned report.
  AD_REVENUE_WEBHOOK_SECRET: z.string().optional(),

  // Minimum balance (in integer minor units, e.g. cents) a creator must
  // have available before a Withdrawal can be REQUESTED —
  // lib/withdrawalService.ts is the only place this is read. This is a
  // GLOBAL floor; `CountryPayoutCapability.minPayoutMinorUnits` (Step 9,
  // admin-configurable per country) applies on top of it. Both are
  // XNAKView's own placeholders, never a claimed real payout threshold.
  WITHDRAWAL_MIN_AMOUNT_MINOR_UNITS: z.coerce.number().int().min(0).default(5000),

  // Step 9 — Automated global creator payouts, real Airwallex integration
  // (lib/payout/airwallexClient.ts). Two independent credential groups:
  // plain Payouts (beneficiaries/transfers — the actual bank-payout rail)
  // and Connected-Account KYC (identity verification), since a real
  // Airwallex account may have one product enabled without the other. Both
  // optional: unset means the corresponding capability honestly reports
  // "unavailable/not configured" rather than faking success — never a fake
  // PAID status, never a fake VERIFIED identity.
  AIRWALLEX_ENV: z.enum(['demo', 'prod']).default('demo'),
  AIRWALLEX_CLIENT_ID: z.string().optional(),
  AIRWALLEX_API_KEY: z.string().optional(),
  AIRWALLEX_WEBHOOK_SECRET: z.string().optional(),
  AIRWALLEX_KYC_CLIENT_ID: z.string().optional(),
  AIRWALLEX_KYC_API_KEY: z.string().optional(),

  // Step 9 — Payoneer White-Label Registration & Payouts
  // (lib/payout/payoneerClient.ts). REQUIRES_APPROVAL: a real Payoneer
  // Partnerships/Compliance sign-off is required before these credentials
  // exist at all (see the Step 9 completion report) — this is not a
  // self-service API. `PAYONEER_PROGRAM_ID` is issued as part of that
  // approval, distinct from the client id/secret. Unset means the provider
  // honestly reports "unavailable" — never a fake payout or fake KYC pass.
  PAYONEER_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PAYONEER_CLIENT_ID: z.string().optional(),
  PAYONEER_CLIENT_SECRET: z.string().optional(),
  PAYONEER_PROGRAM_ID: z.string().optional(),
  PAYONEER_WEBHOOK_SECRET: z.string().optional(),

  // Step 10 — AI Trust & Safety. Text + image moderation both go through
  // OpenAI's documented Moderation API (POST /v1/moderations,
  // model omni-moderation-latest accepts both text and image_url content
  // parts in one call — see lib/moderation/openAiModerationClient.ts).
  // Unset means BOTH `TextModerationProvider`/`ImageModerationProvider`
  // honestly report "unavailable" (lib/moderation/moderationPipeline.ts
  // refuses to allow-by-default when unconfigured) — never a fake "safe"
  // result. No real video/audio moderation vendor or liveness vendor is
  // wired up in this codebase (see the Step 10 completion report) —
  // `VideoModerationProvider`/`AudioModerationProvider`/`LivenessProvider`
  // are real interfaces with only a Mock (test) implementation today.
  OPENAI_MODERATION_API_KEY: z.string().optional(),

  // Real licensed music catalog (Epidemic Sound Partner Content API) —
  // lib/epidemicSound.ts. Optional: unset in an environment without a real
  // partner key means the Sound picker's Trending/Search tabs honestly
  // report "unavailable" rather than faking a track catalog.
  EPIDEMIC_SOUND_API_KEY: z.string().optional(),
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
