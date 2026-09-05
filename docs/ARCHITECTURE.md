# XNAKView — Architecture

**Company:** BALOCH SAHAB TECHNOLOGIES (SMC-PRIVATE) LIMITED
**Domain:** balochsahab.com
**Status:** Step 1 — Foundation

This document describes the architecture established in Step 1. It will be
extended, not rewritten, as later phases (see `ROADMAP.md`) add real
functionality on top of this foundation.

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
│   └── redis.ts               # ioredis client singleton + health check
├── middleware/
│   ├── requestId.ts             # Assigns/propagates X-Request-Id
│   ├── rateLimit.ts               # express-rate-limit, configurable window/max
│   ├── validate.ts                  # zod-based request validation helper
│   ├── errorHandler.ts               # Centralized error → HTTP response mapping
│   └── notFound.ts                     # 404 fallback
├── routes/v1/           # All routes mounted under /api/v1
│   ├── index.ts
│   └── health.ts
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

## 5. Security approach

- **Password hashing**: `passwordHash` is stored, never a raw password;
  Step 1 defines the column, the actual hashing (e.g. argon2/bcrypt) and
  auth endpoints arrive in Phase 2.
- **Sessions**: `Session.refreshTokenHash` stores a hash, not the raw
  refresh token, so a database leak doesn't directly leak usable tokens.
  JWT access/refresh secrets are environment-provided and validated to be
  at least 32 characters at boot (`config/env.ts`) — the process refuses to
  start with a weak or missing secret.
- **Input validation**: zod schemas at the request boundary
  (`middleware/validate.ts`), never trusting client input past that point.
- **Rate limiting**: a global limiter is applied by default
  (`middleware/rateLimit.ts`); per-route stricter limiters (e.g. for future
  login/OTP endpoints) can be composed with `createRateLimiter(...)`.
- **CORS**: explicit allow-list via `CORS_ORIGINS`, not a wildcard.
- **Security headers**: `helmet` is applied by default.
- **Secrets**: only ever read from environment variables, validated at
  boot; `.env.example` documents every variable with placeholder values;
  real `.env` files are gitignored and must never be committed.
- **No hardcoded credentials** anywhere in source, including local dev —
  the committed `docker-compose.yml` uses clearly-labeled dev-only
  credentials that match `.env.example`, not anything resembling a
  production secret.

## 6. API versioning

All routes are mounted under `/api/v1`. A future breaking change gets its
own `/api/v2` mounted alongside `v1` rather than mutating `v1` in place,
so existing mobile app installs that haven't updated yet keep working
against the version they were built against.

## 7. Mobile architecture (Android + iOS)

Single Flutter codebase, both platforms built from the same `lib/` source
— no platform-forked product logic. Clean-architecture-flavored layering:

```
mobile/lib/
├── app/            # App widget: theme + router wiring
├── core/
│   ├── config/       # Compile-time env config (--dart-define)
│   ├── errors/         # AppException hierarchy
│   ├── network/          # ApiClient abstraction (Dio-backed)
│   ├── router/              # go_router, auth-aware redirects
│   ├── storage/                # SecureStorage abstraction
│   ├── theme/                    # AppTheme
│   └── widgets/                     # Shared widgets
└── features/
    ├── auth/          # Auth state/controller (Phase 2 builds the real flows)
    └── splash/
```

Where a future feature genuinely needs platform-specific behavior (push
notification registration, native payment SDKs, camera/mic permission
flows for LIVE), the pattern is the same one already used for storage: a
single abstract interface in `core/`, with platform differences resolved
inside its implementation or by the underlying plugin — not
`Platform.isAndroid`/`Platform.isIOS` branches scattered through feature
code.

## 8. Future scalability

Step 1 intentionally does not implement LIVE, dating/matching, chat/calls,
coins/gifts, monetization, ads, or AI moderation — but the foundation is
shaped so those can be added without rework:

- **Database**: new domains are new Prisma models foreign-keyed to `User`;
  nothing in the Step 1 schema needs to change to support them.
- **API**: new domains are new route groups mounted under `/api/v1` (or a
  future `/api/v2`); the middleware pipeline (auth, validation, rate
  limiting, error handling) already applies to any route added under it.
- **Realtime (LIVE, chat, calls)**: Redis is already wired in and is the
  natural backbone for presence, pub/sub, and ephemeral state once those
  features are built; no new "add a cache layer" migration is needed later.
- **Background/async work** (payouts, moderation queues, notification
  fan-out): not needed yet, but the backend's dependency-tolerant startup
  pattern (background connect, live health reporting) extends naturally to
  a future queue/worker dependency the same way it applies to Postgres and
  Redis today.
- **Mobile/Admin**: both already depend on the backend exclusively through
  an abstraction (`ApiClient` / `apiClient`), so switching transport details
  (e.g. adding a WebSocket connection for LIVE alongside REST) doesn't
  require touching every call site.
