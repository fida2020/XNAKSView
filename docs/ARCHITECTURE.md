# XNAKView — Architecture

**Company:** BALOCH SAHAB TECHNOLOGIES (SMC-PRIVATE) LIMITED
**Domain:** balochsahab.com
**Status:** Step 3 — Video Platform

This document describes the architecture established in Step 1 and
extended in Steps 2 and 3. It will be extended further, not rewritten, as
later phases (see `ROADMAP.md`) add real functionality on top of this
foundation.

## 1. Overall architecture

XNAKView is a monorepo containing four independently deployable applications
and one shared infrastructure definition:

```
XNAKView/
├── mobile/              # Flutter — Android + iOS client
├── backend/              # Node.js + TypeScript REST API
├── admin/                 # Next.js admin console
├── infrastructure/          # Local dev infra (Docker Compose)
└── docs/                     # This documentation
```

The mobile app and admin console are both clients of the backend's REST API
— neither talks to the database or Redis directly. This keeps a single
source of truth for business rules, auth, and data access, and lets the
backend evolve (schema changes, new dependencies) without every client
needing to change in lockstep.

```
 ┌──────────┐        ┌──────────┐
 │  mobile   │        │  admin    │
 │ (Flutter) │        │ (Next.js) │
 └─────┬────┘        └─────┬────┘
       │        HTTPS         │
       │      /api/v1/*         │
       └─────────┬─────────────┘
                 ▼
          ┌─────────────┐
          │   backend    │
          │ (Express+TS)  │
          └──────┬───────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
  ┌───────────┐      ┌─────────┐
  │ PostgreSQL │      │  Redis   │
  │  (Prisma)   │      │          │
  └───────────┘      └─────────┘
```

## 2. Monorepo structure

Each app is self-contained with its own dependency manifest
(`package.json` / `pubspec.yaml`), its own lint/build/test tooling, and its
own README. There is currently no shared code package between them — the
monorepo exists for coordinated versioning and single-PR cross-cutting
changes (e.g. an API contract change touching both `backend` and `mobile`),
not for a shared build system. If genuine cross-app shared code emerges
(e.g. a TypeScript types package shared between `backend` and `admin`), it
should be introduced deliberately as its own package rather than assumed
upfront.

## 3. Backend architecture

Node.js + TypeScript + Express, structured as:

```
backend/src/
├── app.ts            # Express app assembly: middleware pipeline + routes
├── server.ts           # Process entrypoint: listen + graceful shutdown
├── config/
│   └── env.ts            # zod-validated environment config (fails fast on boot)
├── lib/
│   ├── logger.ts           # pino structured logger
│   ├── prisma.ts            # Prisma client singleton + health check
│   ├── redis.ts               # ioredis client singleton + health check
│   ├── password.ts              # bcrypt hash/verify
│   ├── age.ts                     # server-side age calculation (18+ enforcement)
│   ├── tokens.ts                    # JWT access tokens + opaque refresh tokens
│   ├── session.ts                     # issues/rotates Session rows (+ Device link)
│   ├── loginLockout.ts                  # Redis per-identifier brute-force lockout
│   ├── storage.ts                         # StorageDriver abstraction (local disk today)
│   ├── ffmpeg.ts                            # probe/thumbnail/transcode child-process wrappers
│   ├── videoProcessing.ts                     # Orchestrates the processing pipeline + retries
│   ├── videoAccess.ts                           # canViewVideo, serializeVideo, batch like/author/follow lookups
│   └── pagination.ts                              # Opaque (createdAt, id) cursor encode/decode
├── middleware/
│   ├── requestId.ts             # Assigns/propagates X-Request-Id
│   ├── rateLimit.ts               # express-rate-limit (in-memory + Redis-backed)
│   ├── validate.ts                  # zod-based request validation helper
│   ├── auth.ts                        # requireAuth: verifies token + live session
│   ├── upload.ts                        # multer config + AppError-mapped upload errors
│   ├── errorHandler.ts                    # Centralized error → HTTP response mapping
│   └── notFound.ts                          # 404 fallback
├── schemas/                # zod request-body schemas (auth, profile, video, admin)
├── routes/v1/           # All routes mounted under /api/v1
│   ├── index.ts
│   ├── health.ts
│   ├── auth.ts             # register / login / refresh / logout
│   ├── me.ts               # GET /me
│   ├── profile.ts          # GET/PUT /profile
│   ├── videos.ts           # upload, detail, delete, file/thumbnail serving, likes, comments, shares, views, reports
│   ├── feed.ts             # GET /feed
│   ├── follow.ts           # follow/unfollow, public profile, creator video listing
│   └── admin.ts            # read-only video/report inspection
├── test/                # Vitest setup, shared test helpers, and fixtures/ (a real sample video)
└── utils/
    └── AppError.ts        # Typed operational error with HTTP status mapping
```

**Request lifecycle:** request ID assignment → structured request logging →
security headers (helmet) → CORS → compression → body parsing → rate
limiting → versioned router (`/api/v1`) → 404 handler → centralized error
handler. Every error — thrown `AppError`, a `ZodError` from validation, or an
unexpected exception — is normalized into the same JSON error shape,
including the request ID, so client-side error handling and log correlation
are consistent from day one.

**Startup is dependency-tolerant by design.** The HTTP server starts
immediately; PostgreSQL and Redis connections are attempted in the
background rather than awaited before `listen()`. This was a deliberate fix
during Step 1: the initial implementation awaited both connections before
starting the server, which meant that if Redis was unreachable, the process
would hang forever (ioredis's retry strategy retries indefinitely by
design and never rejects the initial `connect()` promise). A backend that
can't come up when a dependency is briefly down is not resilient — instead,
`/api/v1/health` reports live, per-dependency status on every request, and
Kubernetes/process-manager-style liveness vs. readiness distinctions can be
built on top of that endpoint later without changing this shape.

**Graceful shutdown:** `SIGTERM`/`SIGINT` stop accepting new connections,
close in-flight requests, disconnect Prisma/Redis, and force-exit after a
timeout if something hangs.

## 4. Database architecture

PostgreSQL via Prisma. Step 1 defines only the foundation/identity models —
enough to represent a user account, its profile, its verification records,
its devices, and its sessions:

- **User** — core account record (email/phone, password hash, date of
  birth + age verification flag, status).
- **Profile** — the public-facing identity for a user (username, display
  name, bio, avatar, location). Kept separate from `User` so
  account/security concerns and public-profile concerns can evolve
  independently (e.g. profile fields becoming versioned/moderated later
  without touching auth-critical fields).
- **Verification** — a generic record of a verification attempt/result,
  typed by `verificationType` (email, phone, identity document, age) so new
  verification types don't require new tables.
- **Device** — a device a user has authenticated from, for session
  management and future fraud/security signals.
- **Session** — a refresh-token session record (hashed, never the raw
  token), so sessions can be listed, revoked individually, and expired.

Every model relates back to `User` via a `userId` foreign key with
`onDelete: Cascade`, which is the pattern every future domain model (Video,
LIVE, Match, Message, Wallet, Coins, Gifts, Withdrawals, Reports,
Moderation, Levels, Teams, ...) will follow: a new model in its own file
region of the schema, foreign-keyed to `User` (and to each other where
relevant), without needing to modify the models defined in Step 1.

Indexes are placed on foreign keys and on fields used for lookup/filtering
(`status`, `username`, `deviceIdentifier`, `expiresAt`) since those are the
query patterns an auth/identity system needs from day one.

`Session.deviceId` (added in Step 2) is an optional foreign key to `Device`
— when a login/register includes device info, the resulting session is
linked to it, so a session can be traced back to which device created it.
This is the minimum needed for future multi-device session management
(e.g. "sign out this device") without building that UI now.

Step 3 added the video platform models — **Video** (owner, storage keys
for its original/playback/thumbnail assets, status, visibility,
denormalized engagement counters), **VideoLike**/**VideoComment**/
**VideoView** (each foreign-keyed to both `Video` and `User`),
**Follow** (a self-referential `User`-to-`User` edge), and
**VideoReport**. See `STEP3_PROGRESS.md` §1 for the full field-by-field
rationale, including why a separate `VideoAsset` table and a `VideoShare`
table were deliberately *not* created.

## 5. Authentication & session architecture (Step 2)

- **Sign-up**: email or phone (at least one required) + password + date of
  birth. The server independently computes age from the submitted DOB
  (`lib/age.ts`) — there is no client-supplied age or `ageVerified` field,
  and zod strips unrecognized fields before a handler ever sees them, so a
  client cannot pass one in anyway. Under-18 is rejected outright; no
  account row is created. `User.ageVerified` is set to `true` only by the
  server, only once it has confirmed 18+.
- **Tokens**: a short-lived JWT access token (`JWT_ACCESS_SECRET`, default
  15m) carries `{ sub: userId, sid: sessionId }`. A long-lived opaque
  refresh token (default 30d) is returned once to the client; only its
  SHA-256 hash is persisted (`Session.refreshTokenHash`).
- **Refresh rotation**: every `/auth/refresh` call revokes the session it
  was issued from and creates a new one (new access token, new refresh
  token, same device link). A refresh token can therefore only ever be used
  once — replaying an old one fails.
- **Revocation is checked per request, not just left to expire**:
  `middleware/auth.ts` looks up the session named by the access token's
  `sid` on every authenticated request and rejects it if revoked or
  expired. This is an explicit tradeoff (one extra query per authenticated
  request vs. a fully stateless JWT check) made so that logout, refresh
  rotation, and account suspension all take effect immediately rather than
  waiting out the access token's TTL.
- **Account status**: reuses Step 1's `UserStatus` enum unchanged. Only
  `ACTIVE` accounts may log in or use an existing session; any other status
  is rejected with a status-specific message once credentials have already
  been verified (so it doesn't leak account existence to an attacker who
  doesn't have the password).
- **Rate limiting / abuse protection**: `/auth/register`, `/auth/login`,
  `/auth/refresh` each have a Redis-backed IP rate limiter
  (`createAuthRateLimiter`, using `rate-limit-redis`), and login additionally
  has a per-identifier lockout (`lib/loginLockout.ts`) independent of IP —
  8 failed attempts against the same email/phone within 15 minutes blocks
  further attempts against *that identifier* regardless of source IP. Redis
  holds only this kind of ephemeral state; PostgreSQL remains the source of
  truth for accounts, sessions, and profiles.
- **Profile authorization**: `PUT/GET /profile` always act on
  `req.user.id` — there is no route parameter naming a different user, so
  "a user can only touch their own profile" is a structural property of the
  routes, not a check that could be forgotten on a new endpoint.

## 6. Video platform architecture (Step 3)

- **Storage is abstracted, not hardcoded to local disk.** `lib/storage.ts`
  defines a `StorageDriver` interface (`putFromLocalPath`, `read` with an
  optional byte range, `delete`, `exists`, `getPublicUrl`,
  `getLocalReadPath`). `Video` rows store **keys**
  (`videos/{id}/playback.mp4`), never filesystem paths — every read goes
  through the driver. The only implementation today is local disk
  (`STORAGE_LOCAL_DIR`); adding S3/R2/etc. later means implementing this
  one interface, not touching routes or models. `getPublicUrl()` returns
  `null` for local storage, so the video-file route proxies/streams bytes
  itself (with real HTTP Range support); a driver backed by real object
  storage would return a signed URL there instead, and the route would
  redirect — callers don't need to know which.
- **Processing is a real pipeline, not a status flag.** `lib/ffmpeg.ts`
  wraps `ffprobe`/`ffmpeg` as child processes for metadata extraction,
  thumbnail capture, and H.264/AAC transcoding. `lib/videoProcessing.ts`
  orchestrates probe → thumbnail → transcode → store outputs → mark
  `READY` with the real extracted duration/width/height, retrying
  transient failures twice before marking the video `FAILED` with the
  actual error — a video is never marked `READY` without a genuine
  successful transcode. Runs in-process, fire-and-forget from the upload
  request; a durable job queue (e.g. BullMQ on the existing Redis) is the
  natural next step once upload volume warrants it, not built prematurely.
- **Cursor-based pagination**, not offset. Every list endpoint (`/feed`,
  comments, creator video listings, admin lists) uses an opaque
  `(createdAt, id)` cursor (`lib/pagination.ts`). Offset pagination
  re-numbers rows whenever something is inserted ahead of the current
  page, causing duplicates or skips across fetches; a cursor tied to a
  specific row doesn't have that problem, and `id` breaks ties on equal
  timestamps.
- **Visibility is centralized.** `lib/videoAccess.ts`'s `canViewVideo()`
  (owner always; everyone else only `READY` + `PUBLIC`) is the single rule
  every read path applies — the general feed, a creator's video listing to
  a non-owner, and direct-by-id lookups. A non-owner requesting a video
  they can't see gets a plain `404`, not a `403`, so existence isn't
  confirmed to someone who shouldn't see it.
- **Engagement counters are transactional, not eventually-consistent.**
  Likes/comments/shares/views update `Video`'s denormalized counters in
  the same `prisma.$transaction` as the row that backs them, so a feed or
  detail read never needs a `COUNT()` aggregate, and a counter can't drift
  from the rows that justify it. Duplicate-abuse protection differs by
  what's being protected: likes/reports use a database unique constraint
  (race-condition-safe); views/shares use a short Redis dedupe window
  (60s / 3s) sized to absorb accidental duplicate requests without
  capping legitimate repeated engagement over time.

## 7. Security approach

- **Password hashing**: `bcryptjs`, 12 rounds — `passwordHash` is the only
  form a password ever takes at rest; plaintext is never logged or returned
  in a response.
- **Sessions**: `Session.refreshTokenHash` stores a hash, not the raw
  refresh token, so a database leak doesn't directly leak usable tokens.
  JWT access/refresh secrets are environment-provided and validated to be
  at least 32 characters at boot (`config/env.ts`) — the process refuses to
  start with a weak or missing secret.
- **Input validation**: zod schemas at the request boundary
  (`middleware/validate.ts`), never trusting client input past that point.
- **Rate limiting**: a global limiter is applied by default
  (`middleware/rateLimit.ts`); auth endpoints use the stricter Redis-backed
  `createAuthRateLimiter`, plus a per-identifier login lockout — see §5.
  Video upload and every engagement action (like, comment, share, view,
  report, follow) each have their own Redis-backed limiter for the same
  reason. The global limiter and all `createAuthRateLimiter` instances are
  skipped in the test environment (`isTest`) — automated tests legitimately
  exceed normal per-minute limits within a single file; this was a real
  bug (only the auth limiter was skipped, not the global one) found and
  fixed while building Step 3's test suite, not a design decision made in
  advance.
- **Upload validation is real, not mimetype-only**: `probeVideo` actually
  decodes an uploaded file with `ffprobe` before a `Video` row is created;
  a non-video file renamed with a `.mp4` extension is rejected with the
  real decoder error, not just a `Content-Type` check (which is trivially
  spoofable).
- **CORS**: explicit allow-list via `CORS_ORIGINS`, not a wildcard.
- **Security headers**: `helmet` is applied by default.
- **Secrets**: only ever read from environment variables, validated at
  boot; `.env.example` documents every variable with placeholder values;
  real `.env` files are gitignored and must never be committed.
- **No hardcoded credentials** anywhere in source, including local dev —
  the committed `docker-compose.yml` uses clearly-labeled dev-only
  credentials that match `.env.example`, not anything resembling a
  production secret.

## 8. API versioning

All routes are mounted under `/api/v1`. A future breaking change gets its
own `/api/v2` mounted alongside `v1` rather than mutating `v1` in place,
so existing mobile app installs that haven't updated yet keep working
against the version they were built against.

## 9. Mobile architecture (Android + iOS)

Single Flutter codebase, both platforms built from the same `lib/` source
— no platform-forked product logic. Clean-architecture-flavored layering:

```
mobile/lib/
├── app/            # App widget: theme + router wiring
├── core/
│   ├── config/       # Compile-time env config (--dart-define)
│   ├── device/         # Non-invasive per-install device identity
│   ├── errors/           # AppException hierarchy
│   ├── network/            # ApiClient abstraction (Dio-backed)
│   ├── router/                # go_router, auth- and profile-aware redirects
│   ├── storage/                  # SecureStorage abstraction
│   ├── theme/                       # AppTheme
│   └── widgets/                        # Shared widgets
└── features/
    ├── auth/
    │   ├── data/          # AuthRepository, TokenRefresher
    │   ├── domain/           # AuthState, UserAccount, ProfileModel
    │   └── presentation/        # AuthController, sign-in/register screens
    ├── profile/
    │   └── presentation/     # Post-registration profile setup screen
    ├── video/
    │   ├── data/          # VideoRepository (feed, upload w/ progress, engagement, follow)
    │   ├── domain/           # VideoModel, CommentModel, UserProfileSummary
    │   └── presentation/        # FeedController, the vertical pager, comment sheet,
    │                             # upload screen (progress/processing/error states),
    │                             # creator profile screen
    └── splash/
```

Where a future feature genuinely needs platform-specific behavior (push
notification registration, native payment SDKs, camera/mic permission
flows for LIVE), the pattern is the same one already used for storage: a
single abstract interface in `core/`, with platform differences resolved
inside its implementation or by the underlying plugin — not
`Platform.isAndroid`/`Platform.isIOS` branches scattered through feature
code.

## 10. Admin architecture

Next.js (App Router). `proxy.ts` (Next middleware) verifies every protected
navigation's session cookie against the backend's `/me` before the page is
allowed to render — deliberately not just "is a cookie present": a
cookie-presence-only check would let a revoked or expired session through
until the next API call happened to fail. Route Handlers under
`src/app/api/auth/` (`login`, `logout`) are the only place the admin app
talks to the backend's auth endpoints directly; page components read the
resulting httpOnly cookies via `next/headers` and call other backend
endpoints (e.g. `/me`) with the access token as needed.

There is no admin-specific role or permission concept yet — `User` has no
`role` field, and one wasn't introduced in Step 2 (see
`STEP2_PROGRESS.md` §4 for why). Admin login today authenticates as any
XNAKView account; role-gating is real future work, not simulated.

Step 3 added video/report inspection pages (`/videos`, `/videos/[id]`,
`/reports`, `/reports/[id]`) and `api/media/[...path]/route.ts` — a Route
Handler that proxies any backend media path through the admin's own
session. Browser `<img>`/`<video>` tags can't attach an `Authorization`
header the way `fetch()` can, so this exists for the same reason the
backend proxies its own local-disk storage behind an authenticated route.

## 11. Future scalability

Steps 1-3 intentionally do not implement LIVE, dating/matching,
chat/calls, coins/gifts, monetization, ads, advanced recommendation AI, or
AI moderation — but the foundation is shaped so those can be added without
rework:

- **Database**: new domains are new Prisma models foreign-keyed to `User`;
  nothing in the Step 1 schema needs to change to support them.
- **API**: new domains are new route groups mounted under `/api/v1` (or a
  future `/api/v2`); the middleware pipeline (auth, validation, rate
  limiting, error handling) already applies to any route added under it.
- **Realtime (LIVE, chat, calls)**: Redis is already wired in and is the
  natural backbone for presence, pub/sub, and ephemeral state once those
  features are built; no new "add a cache layer" migration is needed later.
- **Background/async work** (payouts, moderation queues, notification
  fan-out, and — concretely, now — durable video processing): video
  processing today runs in-process/fire-and-forget (see §6); the backend's
  dependency-tolerant startup pattern (background connect, live health
  reporting) extends naturally to a future queue/worker dependency on the
  same Redis instance the same way it applies to Postgres and Redis today.
- **Mobile/Admin**: both already depend on the backend exclusively through
  an abstraction (`ApiClient` / `apiClient`), so switching transport details
  (e.g. adding a WebSocket connection for LIVE alongside REST) doesn't
  require touching every call site.
