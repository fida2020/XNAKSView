# STEP 4 — LIVE Streaming: Progress Log

Last updated: 2026-09-06 — **STEP 4 implemented, deep-reviewed, and the
review's blocking findings fixed — verified against live PostgreSQL, Redis,
and a real self-hosted LiveKit server, including a full backend automated
test suite (no mocks) and mobile/admin static analysis.**

Project location: `C:\Users\Asia Computer\Desktop\XNAKView`.

This document exists because the rest of this codebase's comments
(`lib/liveStreaming.ts`, `lib/liveEligibility.ts`, `lib/liveModeration.ts`,
`routes/v1/liveGuests.ts`, `routes/v1/liveMatches.ts`,
`routes/v1/liveEvents.ts`, `infrastructure/docker-compose.yml`, and both
`__tests__/live*.test.ts` files) point here for the reasoning behind
specific decisions. If you're reading one of those comments, this is the
"§N" it's referring to.

## What this step covers

- **Backend**: real WebRTC LIVE via a self-hosted LiveKit SFU (host publish,
  viewer subscribe, real join tokens, real room lifecycle); LIVE discovery
  and scheduling (LIVE events + reminders); chat with an admin-managed
  keyword filter; per-session and per-target reporting (session, viewer,
  chat message); moderators, mute, block; co-host/multi-guest with
  consent-based invite/accept/decline; LIVE Match/Battle with
  challenge/accept/decline consent and participant-gated scoring; a replay
  *status* foundation (no recording pipeline); a subscriber-only-chat gate
  (no subscription purchase flow); a minimal admin-role foundation
  (`User.isAdmin`) gating every `/admin/*` route; and a manual account
  ban/suspend endpoint wired to the enforcement hook that has existed
  unreachable since Step 2.
- **Mobile (Flutter)**: start-LIVE, LIVE discovery feed, host screen (camera/
  mic publish, viewer count, end control), viewer screen (subscribe,
  report, viewer count), polling-based chat panel. Co-host/guest, LIVE
  Match, moderator actions, and LIVE events have backend support but no
  mobile screens yet (see "Known limitations" below).
- **Admin (Next.js)**: LIVE session list/detail, LIVE report list/detail,
  blocked-word list management — all now behind real admin authorization,
  not `requireAuth` alone.
- **Tests**: 137 backend tests passing (Vitest + Supertest) across 8 files,
  against real Postgres/Redis/LiveKit — see §9 for the breakdown, including
  the 19 added while fixing the deep-review findings.

## 1. Database

Four migrations back this step:

- `20260905204235_live_streaming` — `LiveSession`, `LiveViewer`,
  `LiveChatMessage`, `LiveReport`.
- `20260905213128_live_streaming_extensions` — replay fields on
  `LiveSession`; `LiveViewerReport`, `LiveChatMessageReport`, `LiveEvent`,
  `LiveEventReminder`, `LiveModerator`, `LiveViewerRestriction`,
  `LiveBlockedWord`, `LiveGuestSlot`, `LiveMatch`, `LiveSubscription`.
- `20260906095717_admin_role_and_enforcement` — added during the deep-review
  fix pass: `User.isAdmin`, `User.statusReason`, `User.statusUpdatedAt`,
  `User.statusUpdatedById`.

All three apply cleanly via `prisma migrate deploy` against a fresh
database (verified) and match `schema.prisma` exactly (verified via
`prisma migrate status` / `prisma validate`, both clean).

**Deliberately not created**: a `LiveGift`/`LiveCoin` ledger, a
`LiveModerationAction`/audit-log table beyond the four `statusReason`/
`statusUpdatedAt`/`statusUpdatedById` columns already on `User`, and an
`AdminRole` table. A boolean `isAdmin` is the whole "role system" — see §7.

## 2. Real-time streaming engine

Unchanged from the initial Step 4 implementation and re-verified during
this pass: `lib/liveStreaming.ts`'s `LiveStreamingProvider` interface,
backed by self-hosted LiveKit (`infrastructure/docker-compose.yml`). Every
route calls the interface, never `livekit-server-sdk` directly.

**What is and isn't exercised by the automated tests**: `live.test.ts` and
`liveExtensions.test.ts` make genuine control-plane calls to a real LiveKit
server (`CreateRoom`, `DeleteRoom`, signed `AccessToken` issuance/decoding)
for every start/join/reconnect/end/guest-accept/event-start call. What they
do **not and cannot** exercise on this development machine is actual WebRTC
media (publishing a real camera/mic and a second client decoding it) — that
needs real client SDKs with real media hardware/permissions, which no
automated test here attempts. Claiming otherwise would be untested and
false.

## 3. LIVE lifecycle (start / join / leave / end / reconnect)

Unchanged in behavior from the initial implementation; still fully covered
by `live.test.ts`. Host-only start/end, server-issued tokens
(`canPublish` never client-asserted), idempotent join (no double-counting a
reconnecting viewer), and session-end cleanup (every active `LiveViewer`
gets `leftAt` set in the same transaction that flips `status` to `ENDED`).

## 4. Viewer count: one source of truth

**Fixed during the deep-review pass.** `LiveSession.viewerCount` /
`peakViewerCount` (maintained transactionally by `/join`/`/leave`) is now
the *only* source every surface reads:

- Admin and discovery always read it from the API response — unchanged.
- The mobile viewer screen (`live_viewer_screen.dart`) previously set its
  count once from the `/join` response and never refreshed it for the rest
  of the stream. It now polls `GET /live/:id` every 5 seconds, same as chat.
- The mobile host screen (`live_host_screen.dart`) previously derived its
  count from `Room.remoteParticipants.length` — the LiveKit room's live
  participant list. That double-counts co-host/guest participants once
  they exist (they're WebRTC participants but not `LiveViewer` rows), and
  it disagreed with what admin/discovery/the viewer screen showed for the
  same stream. It now polls the same `GET /live/:id` endpoint instead.

This is also *why* guests never inflate viewer counts by construction:
`LiveGuestSlot` is a separate model, never written to `LiveViewer`.

## 5. Discovery & scheduling (LIVE events)

Unchanged in behavior, with one fix: **`POST /live/events/:id/start` now
runs the same `checkLiveEligibility` gate `POST /live` enforces** (age
verification, configurable minimum account age). Before this fix, a host
who had become ineligible after scheduling an event (or who was never
eligible in the first place) could start LIVE anyway through the event
path, bypassing the direct-start gate entirely. Covered by a new test that
flips `ageVerified` to `false` on a host with an already-scheduled event and
confirms `start` now returns `403` and the event never leaves `SCHEDULED`.

## 6. Co-host / multi-guest

Real: an accepted guest gets a genuine `canPublish: true` LiveKit token, not
a simulated one. `LiveGuestSlot.role` (`CO_HOST`/`GUEST`) and
`LiveSession.maxGuestSlots` back both "one co-host" and "several guests"
with the same schema.

**Fixed during the deep-review pass**: accepting an invite now reads the
active-guest count and writes `ACTIVE` inside a `Serializable`-isolation
transaction, so two guests accepting the last free slot at the same instant
can't both succeed (Postgres aborts one as a serialization failure, mapped
to `409 Conflict`). Covered by a genuine concurrency test that fires two
`accept` calls via `Promise.all` and asserts exactly one active guest
results.

**What's still missing**: mobile UI to render more than the host's single
video tile, and any mobile screen for inviting/accepting/removing a guest
at all (backend-only today).

## 7. LIVE Match / Battle

**Two fixes from the deep review, both about who gets to do what:**

- **Consent**: creating a match (`POST /live/:id/match`) only proposes it
  (`PENDING`). Previously *either* participating host could call `/start`
  to activate it — meaning the challenger could immediately activate their
  own challenge, forcing the other session into a battle with no say.
  `/start` is replaced by `/accept` and a new `/decline`, both restricted to
  the *challenged* host (`sessionB`) only — the same invite/accept/decline
  shape the guest-slot flow already used.
- **Scoring authorization**: `POST /live/matches/:matchId/score` previously
  required only `requireAuth` — any registered account, having never joined
  or hosted either session, could inflate either side's score. It now
  requires the caller to be a host, an active viewer, or an active
  co-host/guest of one of the two sessions.

Both are covered by new tests, including one that proves a bystander who
never joined or hosted either session gets `403` from `/score`.

Deliberately still has no Coins/Gifts wiring — score increments come from
an authenticated, verified-participant call, not a real gift-value ledger.
That integration is explicit future work once Coins/Gifts exist as their
own step; the hook point is `POST /live/matches/:matchId/score`, unchanged
in shape by this fix.

## 8. Moderation, reporting, and the abuse policy

**Real today**: an admin-managed, whole-word, case-insensitive chat keyword
filter checked before a message is ever persisted; host/moderator mute
(can watch, can't chat) and block (ends viewership, can't rejoin); a
host-appointed `LiveModerator` role distinct from host-only powers (ending
LIVE, managing guests); per-session, per-viewer, and per-chat-message
reporting, each with database-enforced duplicate-report protection.

**Fixed during the deep-review pass**: `POST /live/:id/report-viewer` now
verifies the reported user actually participated in the session (was the
host, a `LiveViewer` at any point, or a guest who actually joined) before
accepting the report — previously any valid user id was accepted regardless
of any relationship to the session.

**The account-enforcement gap, and what's now built (see §10 for the full
picture)**: `UserStatus.SUSPENDED`/`BANNED` has existed since Step 2 and
`requireAuth` has always rejected non-`ACTIVE` accounts on every request —
but nothing anywhere could actually set an account to that status. That's
fixed now: `POST /admin/users/:id/status` (admin-only) calls
`lib/accountEnforcement.ts`'s `enforceAccountStatus()`, which is the one
place `User.status` should ever be written for moderation. Because
`requireAuth` re-reads `status` from the database every request rather than
trusting the JWT, enforcement is immediate — verified by a test that calls
an authenticated endpoint successfully, bans the account, and calls the
exact same endpoint with the exact same still-valid access token
immediately after, now rejected.

**What this is NOT**: a full AI abuse-detection system, and not
ban-evasion/identity-verification infrastructure (a banned user re-registering
under a new email/phone is not detected or blocked — that needs identity
verification this codebase doesn't have). What this step establishes is the
*enforcement path* — a single, reusable function with one rule set
("can't touch another admin account", audit fields populated) that a future
automated system calls instead of duplicating. Today the only caller is the
manual admin endpoint.

**Keyword filtering vs. "zero-tolerance permanent ban"**: the blocked-word
list is real moderation *prevention* (stops a message from ever being
posted) but is not, and was never meant to be, a severity-classification or
auto-ban system. There is still no violation-history tracking (no data
backs a "prior violations" eligibility check — see `lib/liveEligibility.ts`)
and no automatic classification of "high-confidence severe" vs. "ambiguous"
abuse. Building that classifier is explicitly out of scope for Step 4; §10
below is exactly the boundary of what exists today.

## 9. Admin authorization foundation

**New in this pass, closing a real gap.** Every `/admin/*` route —
including the ones that existed before Step 4 (`/admin/videos`,
`/admin/reports`) — now requires `User.isAdmin`, enforced by
`middleware/requireAdmin.ts` and applied once via `adminRouter.use(requireAuth,
requireAdmin)`. Before this fix, every admin route (including the LIVE ones
added in Step 4) was gated by `requireAuth` only, meaning:

- Any registered user could read host/reporter email and phone numbers
  across videos, video reports, LIVE sessions, and LIVE reports.
- Any registered user could create or delete entries in the LIVE chat
  keyword filter — i.e., disable the moderation system this feature exists
  to support. Confirmed exploitable in the pre-fix test suite, which
  deleted a blocked word using a plain host's own access token.

`isAdmin` is a single boolean, not a role/permission system — deliberately.
There is no endpoint that grants it and no admin-management UI; an operator
sets it directly in the database (`UPDATE users SET "isAdmin" = true WHERE
id = '...'`). **This means the admin Next.js panel itself now requires
whichever account is used to sign into it to have `isAdmin = true`** —
previously any registered account could use the admin panel. A fuller
role/permission system, an admin-invite flow, and an audit log beyond the
four status-change columns on `User` are real future work, not built here.

Covered by `adminAuth.test.ts` (10 tests): every existing admin GET route
rejects a non-admin with `403`, an unauthenticated request gets `401`, an
admin can read them and manage blocked words, and the enforcement endpoint
(§8) rejects non-admins, rejects targeting another admin, and round-trips
ban → immediate lockout → reinstate → restored access.

## 10. What Step 4 implements vs. what it defers

**Implemented**: real WebRTC LIVE (LiveKit); host/viewer lifecycle;
discovery and scheduling; chat with keyword filtering; moderators/mute/
block; per-target reporting with participation validation; co-host/
multi-guest with concurrency-safe acceptance; LIVE Match/Battle with
challenge consent and participant-gated scoring; a replay status
foundation; a subscriber-only-chat gate; a minimal admin-role foundation;
and a manual, admin-only, immediately-effective account ban/suspend action.

**Deliberately NOT implemented** — later steps' scope, hooks only where one
was cheap and honest:

- Coins/wallet, Gift financial transactions, creator payouts/withdrawals,
  ad monetization, Agency commissions, paid subscriptions. The
  `LiveSubscription` model exists (so `subscriberOnlyChat` has something
  real to check) but nothing outside a test or a direct database write can
  ever set one to `ACTIVE` — there is no purchase flow.
  `LiveMatch.scoreA`/`scoreB` accept a bare authenticated-participant
  increment, not a gift-value ledger.
- Full chat/DM system, voice/video calling.
- The actual LIVE recording/egress pipeline. `LiveReplayStatus` and the
  `GET`/`DELETE /live/:id/replay` endpoints are real, but nothing ever
  transitions a replay to `AVAILABLE` — no egress worker exists.
- Effects/stickers — no interface, stub, or model exists for this at all.
- A full AI abuse-detection/severity-classification system, and
  ban-evasion/identity-verification infrastructure (§8).
- A role/permission system beyond the single `isAdmin` boolean; an
  admin-invite or admin-management UI; report-status transitions from the
  admin panel (the status field and filter exist, but nothing sets
  `REVIEWED`/`ACTIONED` yet — a pre-existing Step 3 gap, not introduced
  here).
- Mobile UI for LIVE events, co-host/guest, LIVE Match, or moderator
  actions (mute/block/remove-message) — backend-complete, screen-absent.

## 11. Environment / local infrastructure

`infrastructure/docker-compose.yml`'s LiveKit UDP port range was
`50000-50100`, which collides with a Windows-reserved UDP port-exclusion
range on this development machine (confirmed via `netsh int ipv4 show
excludedportrange protocol=udp`, which listed `50000-50059` as
administratively excluded) — `docker compose up -d` failed with "ports are
not available" after a host restart. Changed to `51000-51100`, which is
clear of that reservation, and verified: LiveKit now starts cleanly via
`docker compose up -d` and its control API responds on `:7880`. This is a
local Docker networking fix, not a WebRTC-correctness one — real
cross-NAT media delivery remains untested on this machine, as noted in §2.

## 12. Test status

137 backend tests passing, 0 failing, across 8 files, run against real
Postgres + Redis + LiveKit (no mocks):

| File | Tests |
| --- | --- |
| `liveExtensions.test.ts` | 38 |
| `live.test.ts` | 22 |
| `videos.test.ts` | 25 |
| `auth.test.ts` | 21 |
| `adminAuth.test.ts` (new) | 10 |
| `follow.test.ts` | 7 |
| `profile.test.ts` | 10 |
| `feed.test.ts` | 4 |

`tsc --noEmit` (backend and admin) clean. `flutter analyze` (mobile) clean.
`prisma validate` / `prisma migrate status` clean against a fresh apply of
all four migrations.

## 13. Remaining work (not blocking, tracked for a later pass)

- Mobile screens for LIVE events, co-host/guest, LIVE Match, and moderator
  actions.
- Report-status transitions (`REVIEWED`/`ACTIONED`) from the admin panel,
  for both video and LIVE reports.
- An admin action to force-end an in-progress LIVE session directly from
  the admin panel (today: inspection only, plus the new account-status
  action).
- A real-time chat channel (LiveKit data-track messaging) instead of
  REST polling.
- Revisiting whether LiveKit's actual RTC UDP port usage needs to be
  pinned to match the published Docker range for genuine cross-NAT media
  once that becomes the thing being tested (see §2, §11).
