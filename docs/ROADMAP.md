# XNAKView — Roadmap

This roadmap sequences the full product. Each phase builds on the
foundation established by the phases before it. **Phases 1-3 are
implemented today.**

## Phase 1 — Foundation *(done)*

Monorepo structure; backend bootstrap (Express + TypeScript, Prisma,
Redis, structured logging, centralized error handling, security
middleware, `/api/v1/health`); foundation/identity database models (User,
Profile, Verification, Device, Session); Flutter mobile app skeleton
(Android + iOS, clean architecture, routing, secure storage, theme);
Next.js admin app skeleton (shell, sidebar, auth-ready route protection);
local dev infrastructure definition (Docker Compose for Postgres + Redis);
architecture and roadmap documentation.

## Phase 2 — Authentication / Profile *(done)*

Sign-up (email or phone) with server-verified 18+ enforcement, password
hashing, JWT access tokens + hashed/rotating refresh tokens backed by the
`Session` model, session revocation, device linking backed by the `Device`
model, profile creation/edit backed by the `Profile` model, admin console
real login (against the existing backend auth — no separate admin role
yet). Redis-backed rate limiting and a per-identifier login lockout. 31
automated backend tests.

**Deferred to a later phase, not built now:** email/SMS verification codes
(the `Verification` model exists but nothing populates it yet —
registration sets accounts `ACTIVE` directly rather than
`PENDING_VERIFICATION`), admin role/permission model (admin login
authenticates as any account today), multi-device session management UI
(the data model — `Session.deviceId` — supports it, no UI built).

## Phase 3 — Video Feed *(current)*

Video upload with real validation and a storage abstraction (local disk
today, object-storage-ready), a genuine FFmpeg processing pipeline
(metadata, thumbnails, transcoding), a cursor-paginated feed, likes,
comments, shares, views (with abuse-resistant deduplication),
follow/unfollow, video privacy/status (`PROCESSING`/`READY`/`FAILED`/
`DELETED`, `PUBLIC`/`PRIVATE`), and basic video reporting. Admin gained
read-only video/report inspection. 67 automated backend tests total (31
from Steps 1-2 + 36 new).

**Deferred to a later phase, not built now:** a durable cross-restart
video-processing job queue (processing runs in-process/fire-and-forget
today — see `docs/ARCHITECTURE.md` §6), report status changes / video
takedown actions from the admin panel (inspection only), a recommendation/
ranking model for the feed (newest-first from `/feed` only), a dedicated
`VideoAsset` table for multiple renditions per video (not needed while
each video has exactly one playback rendition).

## Phase 4 — LIVE

## Phase 4 — LIVE

Live streaming infrastructure, live chat, viewer counts, live-specific
moderation, stream discovery.

## Phase 5 — Chat / Voice Calls

Direct/group messaging (`Message` model), real-time delivery, voice
calls, call history, block/report integration.

1:1 video calling was implemented alongside voice calling and then
permanently removed as a product decision (misuse/indecent-behavior risk)
— it does not exist anywhere in XNAKView and will not be implemented. 1:1
calling is voice-only. This is unrelated to LIVE, which remains full video.

## Phase 6 — TikTok Feature Parity / Social + Creation Features

Stories, photo/text posts, Duet, Stitch, repost, favorites, hashtags,
mentions, search, discover/trending, sounds, expanded video creation
tools, effects/filters, drafts, creator playlists, expanded notifications,
share/download controls, comments expansion, follow/friends experience,
and profile expansion.

Dating/Matching was previously planned here and has been permanently
cancelled — it does not exist anywhere in XNAKView and will not be
implemented.

## Phase 7 — Coins / Gifts / Creator Earnings

Virtual currency (`Wallet`, `Coins`), gifting during LIVE/video
(`Gifts`), creator earnings ledger, payout requests (`Withdrawals`).

## Phase 8 — Monetization

Subscriptions/premium tiers, ads integration, promotional/boost
mechanics, pricing experiments.

## Phase 9 — AI Moderation / Fraud

Automated content moderation (image/video/text), fraud detection on
payments and coin flows, abuse/spam detection, integration with the
`Reports`/`Moderation` models.

## Phase 10 — Admin / Analytics

Full admin functionality: user management, content moderation queues,
verification review queues, financial oversight (wallets, payouts),
product analytics dashboards, `Levels`/`Teams` management tooling.

## Phase 11 — Security / Testing

Full security review and hardening pass, penetration testing, load
testing, automated test coverage expansion (unit/integration/e2e) across
backend, mobile, and admin.

## Phase 12 — Production Launch

Production infrastructure provisioning, CI/CD pipelines, monitoring and
alerting, app store submission (iOS App Store + Google Play), phased
rollout.
