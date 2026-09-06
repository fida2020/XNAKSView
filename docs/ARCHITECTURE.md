# XNAKView — Architecture

**Company:** BALOCH SAHAB TECHNOLOGIES (SMC-PRIVATE) LIMITED
**Domain:** balochsahab.com
**Status:** Step 5 — Direct Messaging + Voice Calls

This document describes the architecture established in Step 1 and
extended in Steps 2, 3, 4, and 5. It will be extended further, not
rewritten, as later phases (see `ROADMAP.md`) add real functionality on top
of this foundation.

Dating/Matching was implemented under a working Step 6 and then permanently
cancelled before being committed; it has been fully removed from this
codebase and does not exist anywhere in XNAKView. Step 6 is now defined as
TikTok-parity social + creation features (see `ROADMAP.md`).

1:1 video calling (Step 5) was permanently removed as a product decision
(misuse/indecent-behavior risk) and does not exist anywhere in XNAKView.
1:1 calling is voice-only. This is unrelated to LIVE, which remains full
video (streaming, co-host/multi-guest, Match/Battle).

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

## 7. LIVE streaming architecture (Step 4)

- **Real WebRTC, not fake HTTP-upload "LIVE."** Host publishing and viewer
  playback both go over WebRTC via a self-hosted **LiveKit** SFU
  (`infrastructure/docker-compose.yml`'s `livekit` service), not ordinary
  video file upload/playback. This is the concrete difference between a
  genuine low-latency LIVE feature and a video feed that merely refreshes
  quickly.
- **The streaming engine is abstracted, not hardcoded.** `lib/liveStreaming.ts`
  defines a `LiveStreamingProvider` interface (`createRoom`, `deleteRoom`,
  `generateToken`, `getParticipantCount`, `wsUrl`); `LiveKitStreamingProvider`
  is the only implementation today, wrapping `livekit-server-sdk`'s
  `RoomServiceClient` (room lifecycle) and `AccessToken` (signed, scoped
  join tokens). Every route calls the interface, never the SDK directly —
  swapping to a different SFU or a managed provider (Agora, a hosted
  LiveKit Cloud instance, etc.) later means implementing this one
  interface, not touching routes, models, or mobile code beyond the
  connection URL/token it already treats as opaque.
- **Provider choice, and why:** LiveKit was chosen over Agora (proprietary
  SaaS, requires a vendor account and recurring cost even for local dev)
  and Mux (HLS-based — higher latency, a weaker fit for "low-latency live
  video" than WebRTC) because it is open-source, self-hostable (so local
  development and future self-managed production both work without a
  third-party account), and has official, actively maintained server
  (`livekit-server-sdk`) and Flutter (`livekit_client`) SDKs. The choice
  was verified empirically, not assumed: the real server was run locally,
  a real room was created/listed/deleted, and a real signed JWT was
  generated and decoded via a standalone script before any application
  code was written against it (see `STEP4_PROGRESS.md` §2 for the actual
  evidence).
- **Authorization is server-issued, never client-asserted.** A join token's
  `canPublish` grant is set by the backend based on whether the caller is
  the session's `hostId` (from the authenticated JWT, never a client-
  supplied field) — a viewer's token is always subscribe-only. The LiveKit
  server itself enforces this grant at the SFU level, so a modified mobile
  client couldn't publish video by lying about its role even if it tried;
  the enforcement point is the media server, not just the REST API.
- **Session lifecycle is a database row, not just a LiveKit room.**
  `LiveSession.status` (`LIVE`/`ENDED`) is the source of truth the REST API
  enforces (join/chat/reconnect all reject once `ENDED`); the LiveKit room
  is created alongside it and deleted when the host ends the session — two
  systems kept in sync by the same request handler, not by polling one
  from the other.
- **Duplicate-join is idempotent, not rejected.** Rejoining a session the
  viewer already has an active `LiveViewer` row for returns `200` with a
  fresh token and does **not** re-increment `viewerCount` — this is what
  makes "duplicate join protection" mean "the count can't be inflated by
  the same person," not "a reconnecting mobile client gets an error,"
  which would be the wrong behavior for a network blip or app
  backgrounding.
- **Ending a session cleans up viewer state in the same transaction** that
  flips `status` to `ENDED` — every active `LiveViewer` row for that
  session gets `leftAt` set, so no viewer is left "active" against a
  session that no longer exists, and a subsequent `/leave` call for that
  viewer correctly reports nothing left to leave (`404`) rather than
  silently succeeding against a dead session.
- **Viewer count has one source of truth: the database, not WebRTC.**
  `LiveSession.viewerCount`/`peakViewerCount` are maintained transactionally
  by the `/join` and `/leave` REST calls (see the idempotent-join bullet
  above) — never derived from the LiveKit room's live participant list.
  Every surface that shows a count (host screen, viewer screen, admin,
  discovery) polls or reads this same field, which is also why co-host/
  guest participants never inflate it: guests are tracked in a separate
  `LiveGuestSlot` model and are never inserted into `LiveViewer`, so they
  can join the LiveKit room and publish without ever counting as a
  "viewer." (An earlier version of the host screen derived its count from
  `Room.remoteParticipants.length` instead, which would have double-counted
  guests once that UI exists — fixed to poll the same API the other three
  surfaces already used.)
- **Guest-slot acceptance is concurrency-safe, not just wrapped in a
  transaction.** Accepting a co-host/guest invite reads the session's
  active-guest count and writes `ACTIVE` inside a `Serializable`-isolation
  transaction (`routes/v1/liveGuests.ts`), so two guests accepting the last
  free slot at the same instant can't both succeed — Postgres aborts one as
  a serialization failure, surfaced as `409 Conflict`, not silently
  overrunning `maxGuestSlots`.
- **LIVE Match / Battle requires the challenged host's consent.** Creating a
  match (`POST /live/:id/match`) only proposes it (`PENDING`); only the
  *challenged* host — never the challenger, and never a bystander — can
  `POST /live/matches/:matchId/accept` or `/decline`. A host cannot force
  another session into a battle by creating and then unilaterally starting
  one, mirroring the invite/accept/decline shape the guest-slot flow
  already used. Score contribution (`/score`) requires the caller to
  actually be a host, active viewer, or active guest of one of the two
  sessions — not just any authenticated account.
- **Admin authorization is a real (if minimal) gate, not `requireAuth` alone.**
  Every `/admin/*` route — including LIVE inspection and the chat keyword
  filter — requires `User.isAdmin`, checked by `middleware/requireAdmin.ts`
  after `requireAuth`. There is no self-serve way to become an admin (an
  operator sets the flag directly in the database); this is deliberately a
  boolean, not a role/permission system, because a fake multi-role system
  would be worse than an honestly minimal one. This closed a real gap: an
  earlier version gated these routes by `requireAuth` only, so any
  registered user could read report/host contact details and — for the
  blocked-word list specifically — disable the chat keyword filter outright.
- **Account enforcement (ban/suspend) has one call path.**
  `lib/accountEnforcement.ts`'s `enforceAccountStatus()` is the only place
  `User.status` is set for moderation purposes; `POST
  /admin/users/:id/status` (admin-only) calls it today. `requireAuth`
  re-reads `status` from the database on every request rather than trusting
  the JWT, so a ban/suspension takes effect on the target's very next
  authenticated call — no token revocation needed. This is the manual
  enforcement path implied by `UserStatus.SUSPENDED`/`BANNED` existing since
  Step 2 but never being reachable by anything; it is also the intended
  call site for a future automated abuse-detection system (not built in
  Step 4 — see below), so that system reuses the same admin-can't-touch-
  another-admin rule and audit fields instead of duplicating them.
- **What Step 4 implements vs. what it deliberately defers.** Implemented:
  co-hosting/multi-guest (`LiveGuestSlot`, consent-gated), LIVE Match/Battle
  (challenge/accept/decline, score, winner), moderator roles beyond
  host/viewer (`LiveModerator`, mute/block, keyword filter), LIVE
  scheduling (`LiveEvent` + reminders), a replay *status* foundation
  (`LiveReplayStatus`), and a subscriber-only-chat *gate*
  (`LiveSession.subscriberOnlyChat`). Deliberately NOT implemented, because
  they belong to later monetization/communication steps and only a clean
  hook exists today: the actual LIVE recording/egress pipeline behind the
  replay status, Coins/wallet, Gift financial transactions, creator
  payouts/withdrawals, ad monetization, Agency commissions, paid
  subscriptions (the `LiveSubscription` model has no purchase flow — an
  admin/test can only create one directly), full chat/DM, and voice/video
  calling. LIVE chat itself is REST-polled (`GET /live/:id/chat` every few
  seconds from the mobile client), not a real-time push channel — LiveKit's
  own data-track messaging is a natural upgrade path without changing the
  chat data model.

## 8. Chat + calls architecture (Step 5)

- **Direct messaging is a normalized-pair conversation, not a message log
  with implicit grouping.** `Conversation.participantOneId`/
  `participantTwoId` are always stored smaller-id-first
  (`lib/messagingAccess.ts`'s `normalizePair`), so "find or create the 1:1
  conversation between these two users" is one unique-index lookup, not an
  OR-of-two-orderings query. Per-user mutable state (unread count, mute,
  pin, read cursor) lives on a separate `ConversationParticipant` row per
  side — deliberately, so "I muted this" is never visible to the other
  participant, and so the schema already fits a future group conversation
  without a rewrite (more `ConversationParticipant` rows, not a new shape).
- **Message sending is idempotent by database constraint, not
  by convention.** `Message`'s `[conversationId, senderId, clientMessageId]`
  unique index means a client retrying a send after a dropped response
  (a flaky connection, an app backgrounded mid-request) gets back the
  message that was actually created, not a duplicate — the same posture
  Step 4 gave LIVE chat's guest-slot/match-creation flows.
- **The real-time gateway is additive, never the source of truth.**
  `lib/realtime.ts` wraps Socket.IO (+ a Redis adapter for cross-instance
  pub/sub) behind the same small-interface pattern
  `LiveStreamingProvider` established in Step 4 — `emitToUser`,
  `emitToConversation`, `isOnline`. Messages and calls are always written to
  Postgres first by a REST handler; the gateway is only ever told
  afterwards. A duplicate or delayed socket event therefore can't create
  duplicate data — a client reconciles by id, never by trusting the event
  itself as authoritative. Authentication on the socket handshake reuses
  `middleware/auth.ts`'s `resolveAuth()` (the same function `requireAuth`
  calls), so a suspended/banned account is rejected identically on both
  transports.
- **Presence lives in Redis, not Postgres.** A per-user key with a 75-second
  TTL (refreshed every 25s while connected) is "online now"; `User.lastActiveAt`
  (a real column) is the durable "last seen" fallback, written on
  disconnect. Presence is only ever broadcast to users who share an
  *accepted* conversation with the person coming online/offline, and only
  if that person's `MessagingPrivacySettings.showActivityStatus` allows it.
- **Message-request privacy is checked once, at conversation creation, not
  per-message.** `MessagingPrivacySettings.whoCanMessage` (`EVERYONE` /
  `MUTUAL_FOLLOWERS` / `NO_ONE`) decides whether a new conversation starts
  `ACCEPTED` or `PENDING` (a "message request," matching the reference
  product's behavior for non-mutual senders); once a conversation exists,
  tightening the setting later doesn't retroactively lock out an existing
  thread. Blocking is checked on every send, not just at creation, and is
  treated as mutual for messaging/call purposes regardless of which
  direction the block row was created in.
- **Calls reuse Step 4's LiveKit provider — a call is just a
  two-participant room.** `routes/v1/calls.ts` calls the same
  `LiveStreamingProvider` interface LIVE streaming uses (`createRoom`,
  `deleteRoom`, `generateToken`) rather than a second WebRTC stack. Call
  lifecycle (`RINGING → ACCEPTED/DECLINED/CANCELLED/MISSED/BUSY → ENDED`)
  and busy-detection are computed inside a `Serializable` transaction — the
  same fix Step 4 applied to guest-slot acceptance — so two simultaneous
  initiations can't both succeed and leave a caller or callee in two calls
  at once. **1:1 calling is voice-only.** 1:1 video calling was originally
  built alongside voice calling in Step 5 and was later permanently removed
  as a product decision (misuse/indecent-behavior risk) — there is no
  `Call.type`/video branch anywhere in the call lifecycle. This is unrelated
  to LIVE, which remains full video (streaming, co-host/multi-guest,
  Match/Battle).
- **Voice messages get the same "never trust the client" validation as
  video uploads.** `lib/voiceValidation.ts` checks real magic bytes and
  runs the file through `ffprobe` (extending `lib/ffmpeg.ts`) to confirm an
  actual audio stream and its real duration before accepting it — the
  client's claimed duration is never used for the stored `voiceDurationMs`.
- **Notifications are behind a one-method interface
  (`lib/notifications.ts`'s `NotificationDispatcher`), not hardcoded to a
  provider.** Its only implementation today forwards onto the realtime
  gateway, which reaches a connected client only — there is no
  background/killed-app push (FCM/APNs) yet. Adding one later is a second
  implementation of the same interface, not a change to
  `routes/v1/messages.ts` or `routes/v1/calls.ts`.
- **What Step 5 implements vs. defers** (see `docs/STEP5_PROGRESS.md` §7 for
  the full list): implemented — 1:1 messaging with requests/mute/pin/
  block/report, voice messages, real-time delivery/typing/presence/read
  receipts, 1:1 voice calls with full lifecycle and history, admin
  inspection. Deferred — group messaging, push notifications, a generic
  person-level report model (satisfied here by conversation reports +
  blocking), and — unchanged from Step 4's position — full AI
  abuse-severity classification (the manual `enforceAccountStatus()` path
  from Step 4 is what a message/conversation/call report feeds into today).

## 9. Security approach

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

## 10. API versioning

All routes are mounted under `/api/v1`. A future breaking change gets its
own `/api/v2` mounted alongside `v1` rather than mutating `v1` in place,
so existing mobile app installs that haven't updated yet keep working
against the version they were built against.

## 11. Mobile architecture (Android + iOS)

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

## 12. Admin architecture

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

## 13. Future scalability

Steps 1-3 intentionally do not implement LIVE, chat/calls, coins/gifts,
monetization, ads, advanced recommendation AI, or AI moderation — but the
foundation is shaped so those can be added without rework:

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
