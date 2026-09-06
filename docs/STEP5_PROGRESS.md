# STEP 5 — Chat + Voice/Video Calls: Progress Log

Last updated: 2026-09-06 — **STEP 5 implemented and verified against live
PostgreSQL, Redis, and a real self-hosted LiveKit server, including a full
backend automated test suite (no mocks, including a real Socket.IO
client/server round trip) and mobile/admin static analysis. NOT yet
committed — pending final review.**

Project location: `C:\Users\Asia Computer\Desktop\XNAKView`.

## What this step covers

- **Backend**: 1:1 direct messaging (conversation create/reuse, cursor
  pagination, idempotent send, delivered/read receipts, unread counts,
  mute/pin/report/block/unblock), message-request privacy gating
  (`MessagingPrivacySettings.whoCanMessage`), voice messages (real
  magic-byte + ffprobe-decoded validation, not client-trusted), a real-time
  gateway (Socket.IO + Redis adapter) for message delivery/read
  receipts/typing/presence, and 1:1 voice/video calls (real WebRTC via the
  same LiveKit provider Step 4 LIVE uses) with full lifecycle
  (ring/accept/decline/cancel/end/busy/missed/timeout), call history, and a
  notification abstraction.
- **Mobile (Flutter)**: inbox (pinned + recent, unread badges), chat screen
  (text + voice messages, typing indicator, read receipts, online/last-active
  header, block/report), voice recording/playback, incoming-call screen,
  active call screen (voice + video, mic mute, camera on/off, camera flip),
  call history.
- **Admin**: read-only inspection of conversations, message reports,
  conversation reports, and call reports — same `requireAdmin` gate as every
  other admin route. No new admin *frontend* pages this step (see "Known
  limitations").
- **Tests**: 206 backend tests passing (Vitest + Supertest, plus a genuine
  Socket.IO client/server test file) across 13 files, against real
  Postgres/Redis/LiveKit — up from 137 at the end of Step 4 (+69 new).

## 1. Database

Two migrations:

- `20260906104115_step5_chat_calls` — `Conversation`, `ConversationParticipant`,
  `Message`, `MessageReceipt`, `MessageReport`, `ConversationReport`,
  `UserBlock`, `MessagingPrivacySettings`, `Call`, plus `User.lastActiveAt`.
- `20260906104609_step5_call_reports` — `CallReport` (added right after the
  first migration once call abuse-reporting was designed the same way
  message/conversation reporting already was).

Both apply cleanly via `prisma migrate dev`/`deploy` and match
`schema.prisma` exactly (`prisma validate` / `prisma migrate status` clean).

**Deliberately not created**: a `CallParticipant` join table (a `Call` is
always exactly caller + callee — two plain foreign keys are simpler and
sufficient; see schema.prisma's own comment); a `Presence` table ("online
right now" lives in Redis, not Postgres — see §3); a generic `UserReport`
model (reporting a person outside a specific message/conversation/call
context is satisfied by `ConversationReport` + block — see §7 for why a
separate model wasn't added).

**Reused, not duplicated**: `VideoReportReason` / `VideoReportStatus` (from
Step 3) back `MessageReport`, `ConversationReport`, and `CallReport` — the
same pattern Step 4's `LiveReport` family already established.

## 2. Real-time architecture

`lib/realtime.ts` defines the gateway as a small function surface
(`initRealtime`, `emitToUser`, `emitToConversation`, `isOnline`) — the same
shape as Step 4's `LiveStreamingProvider` — backed by Socket.IO with a Redis
adapter (`@socket.io/redis-adapter`) for cross-instance pub/sub. Route
handlers never touch `socket.io` directly.

- **Authenticated connection**: the handshake's `auth.token` is verified by
  `resolveAuth()` (extracted from `middleware/auth.ts` so HTTP and socket
  auth can never drift apart) — same session/status checks as every REST
  call, including the ban/suspend check.
- **Messages/calls are never created over the socket.** The REST endpoints
  persist first (idempotency enforced by `Message`'s unique constraint —
  see §3 of `STEP4_PROGRESS.md` for the same pattern applied to LIVE match
  scoring) and then call into the gateway to notify. A duplicate or
  out-of-order socket event is therefore harmless — clients reconcile by id,
  never by trusting the event as the source of truth.
- **Reconnect**: Socket.IO's client handles reconnection; on reconnect the
  mobile app re-authenticates (handshake `auth` is re-sent) and re-fetches
  the current message page via REST, so a missed-event gap during a
  disconnect is closed by re-fetching, not by trying to replay events.
- **Heartbeat**: Socket.IO's default ping/pong (25s interval / 20s timeout)
  — not overridden, and sufficient for dead-connection detection.
- **Presence**: a Redis key per online user (`presence:online:{userId}`,
  75s TTL, refreshed every 25s while connected) — not a database table,
  because "online right now" changes far too often to be worth a Postgres
  write per heartbeat. `User.lastActiveAt` (Postgres) is the durable "last
  seen" fallback, written on disconnect. Presence is only ever broadcast to
  users who share an **ACCEPTED** conversation with the person coming
  online/offline, and only if the *target's* `showActivityStatus` setting
  allows it — verified by a real test (two real sockets, one comes online,
  the other receives `presence:update`).
- **Typing indicators**: relayed only within a `conversation:{id}` room a
  socket has been let into (verified as a real participant on every join
  attempt, not just once at handshake), and server-side throttled
  (2s minimum interval per user per conversation) so a modified client
  can't flood the room.
- **WebSocket connection-abuse rate limiting**: a Redis-backed cap (30
  connection attempts/minute per user) in the `io.use()` auth middleware —
  Express's rate-limit middleware never sees a WebSocket upgrade, so this
  needed its own check, added during the security-review pass (see §9).

**What's not built**: horizontal multi-instance testing (the Redis adapter
is wired for it, but the test suite — like Step 4's — runs a single
instance; correctness of the adapter path itself isn't exercised beyond
"it doesn't throw when only one instance exists").

## 3. Direct messaging

- **Conversation creation/reuse**: `Conversation.participantOneId`/
  `participantTwoId` are always normalized (lexicographically smaller id
  first), making "find or create the 1:1 conversation between these two
  users" one unique-index lookup — verified by a test that creates from
  both directions and gets the same conversation id back.
- **Message requests**: `MessagingPrivacySettings.whoCanMessage`
  (`EVERYONE` / `MUTUAL_FOLLOWERS` [default] / `NO_ONE`) is checked once, at
  conversation-creation time (not on every message — see the schema
  comment for why). A non-mutual stranger's message lands as a `PENDING`
  conversation ("message request"), not a rejection; it flips to
  `ACCEPTED` the moment the recipient replies or explicitly calls
  `POST /conversations/:id/accept`. `NO_ONE` rejects outright — no request
  possible, matching the reference product's most restrictive setting.
- **Idempotent send**: `Message`'s `[conversationId, senderId,
  clientMessageId]` unique constraint means retrying the same logical send
  (e.g. after a dropped response on a flaky connection) returns the
  already-created message (`200`) instead of creating a duplicate (`201`
  the first time) — enforced by the database, verified by firing the exact
  same request twice and confirming exactly one row exists.
- **Delivery/read state**: `MessageReceipt` per (message, recipient).
  "Delivered" is set the moment either the recipient is online when the
  message is sent, or lazily when they next fetch the conversation's
  messages (covers the offline-then-reconnect-and-fetch case without
  needing a queued-delivery mechanism). "Read" is set by
  `POST /conversations/:id/read`, which also zeroes `unreadCount` and pushes
  a `message:read` event to the sender in real time — verified by an actual
  two-socket test.
- **Unsend/delete**: sender-only, within `MESSAGE_UNSEND_WINDOW_MINUTES`
  (default 24h) of sending — a tombstone (`deletedAt` set, `text`/`voiceKey`
  cleared), not a hard delete, so message ordering and the conversation's
  denormalized `lastMessageId` pointer stay intact.
- **Mute / pin**: per-`ConversationParticipant` flags — muting/pinning is
  never visible to the other participant. Pinned conversations are returned
  as a separate, unpaginated list in `GET /conversations` (see the route's
  own comment for why mixing them into the cursor-paginated list was
  avoided).
- **Blocking**: `UserBlock` is directional in the schema but treated as
  mutual for messaging/call purposes everywhere it's checked
  (`lib/messagingAccess.ts`'s `isBlockedEitherDirection`) — a block in
  *either* direction stops new conversations, in-flight sends, and calls,
  both ways. Re-checked on every send (not just at conversation creation),
  so blocking mid-thread actually stops the other side, verified by a test.

## 4. Voice messages

Real validation, the same posture Step 3's video upload and Step 4's LIVE
thumbnail upload already established: `lib/voiceValidation.ts` checks the
file's actual magic bytes (WAV/OGG/MP3/M4A/WebM signatures) *and* runs it
through `ffprobe` (`lib/ffmpeg.ts`'s new `probeAudio`) to confirm a real
audio stream exists and extract its real duration — the client's claimed
duration is never trusted. A file that isn't actually audio, or exceeds
`MAX_VOICE_MESSAGE_SECONDS` (default 120s), is rejected — both paths are
covered by tests using real WAV fixtures (`backend/src/test/fixtures/
sample-voice.wav`, a real 2-second tone; `sample-voice-too-long.wav`, a real
125-second tone). Playback is streamed through the same range-aware
`mediaStreaming.ts` video/LIVE-thumbnail serving already uses, gated by
conversation participancy. Voice messages support the same unsend/report
flow as text messages.

## 5. Calls (voice + video)

Reuses Step 4's `LiveStreamingProvider` (self-hosted LiveKit) — a call is a
two-participant room (`call-{callId}`), not a separate media stack. This
is deliberate: it's the same "proper WebRTC/media architecture and provider
abstraction" the brief asked for, without building a second one.

- **Lifecycle**: `RINGING` → `ACCEPTED`/`DECLINED`/`CANCELLED`/`MISSED`/
  `BUSY` → `ENDED`. Only the callee may accept/decline; only the caller may
  cancel; either may end an active call. All three are enforced
  server-side and covered by IDOR tests (a non-participant gets `403`/`404`
  on every action).
- **Ring timeout**: an in-process timer (`CALL_RING_TIMEOUT_SECONDS`,
  default 45s) flips an unanswered call to `MISSED` and tears down the
  LiveKit room. **Known limitation**: this timer is in-memory — a server
  restart mid-ring loses it (the call would stay `RINGING` until acted on
  or the room simply times out on LiveKit's own side).
- **Busy handling**: if the callee is already in a call, a `BUSY` call
  record is created immediately (for history) instead of ringing — no
  LiveKit room is created for it.
- **Concurrency safety**: initiating a call reads "is either party already
  busy" and creates the `Call` row inside a `Serializable` transaction, the
  same fix applied to Step 4's guest-slot race — two simultaneous
  initiations (the same caller double-dialing, or two callers dialing the
  same callee at once) can't both succeed. Verified by a real concurrent
  (`Promise.all`) test. This was found and fixed during the security-review
  pass (§9), not present in the first draft.
- **Authorization**: caller/callee identity always comes from
  `req.user!.id` and the loaded `Call` row, never a client-supplied field.
  Blocked users can't call each other (either direction); banned/suspended
  accounts can't initiate (`requireAuth` rejects them before the route
  runs) or be called (the callee's `status` is checked explicitly, since
  they're not the one making the request).
- **Call history**: `GET /calls`, cursor-paginated, both directions,
  labeled `INCOMING`/`OUTGOING`.

**What's not and cannot be exercised** on this development machine: real
two-way WebRTC audio/video (a real camera/mic and a second client actually
decoding it) — same honest limitation Step 4's LIVE tests already stated.
Every control-plane action (room create/delete, signed token issuance with
the right `canPublish` grant) is real and tested.

## 6. Admin inspection

`/admin/conversations` (list + detail), `/admin/message-reports`,
`/admin/conversation-reports`, `/admin/call-reports` — all read-only, all
behind the same `requireAdmin` gate Step 4 wired router-wide (no route-level
opt-out is possible short of editing that one line). Message *content* is
only visible through a report (the reported message itself), not by
browsing a conversation's full history — deliberately narrower than Step 4's
LIVE admin surface, since 1:1 DMs carry a stronger privacy expectation than
a public LIVE chat.

## 7. What Step 5 implements vs. what it defers

**Implemented**: everything in §1–6 above, plus a notification
*abstraction* (`lib/notifications.ts`'s `NotificationDispatcher`) — today
its only implementation forwards onto the realtime gateway, which reaches a
currently-connected client only. No FCM/APNs integration exists; the
abstraction exists so one can be added as a second implementation without
touching `routes/v1/messages.ts` or `routes/v1/calls.ts`.

**Deliberately NOT implemented**:

- A generic `UserReport` model independent of a message/conversation/call —
  "report a user" in this step's scope is satisfied by `ConversationReport`
  (report the whole thread) plus blocking; a person-level report untied to
  any specific interaction would be new future scope, not this step's.
- Admin *frontend* pages for the new inspection endpoints (Step 4 got
  Next.js pages for LIVE; Step 5's admin surface is API-only this pass —
  see "Known limitations").
- Push notifications (FCM/APNs) for a backgrounded/killed app — see §6's
  notification-abstraction note.
- Full AI abuse-severity classification and ban-evasion/identity
  verification — unchanged from Step 4's position (`docs/STEP4_PROGRESS.md`
  §8): the messaging surface uses the same manual
  `enforceAccountStatus()` enforcement path (a message/conversation/call
  report reaching an admin can result in a manual ban, exactly like a LIVE
  report can), and nothing here auto-bans on a keyword match — false-positive
  protection is preserved by construction (no automatic classifier exists
  to be wrong).
- Coins/gifts/payouts/ad monetization/Agency/paid subscriptions/dating —
  out of scope per the brief, untouched.
- Group messaging — the schema (`MessageReceipt` per-recipient rather than
  a single status enum, `ConversationParticipant` as a join table rather
  than two flat columns) was shaped to make this a schema no-op later, but
  no group UI or group-specific logic exists now.

## 8. Security review (performed before declaring this step done)

- **IDOR**: every conversation/message/call action re-verifies the caller
  is an actual participant (`loadConversationForParticipant`,
  `assertParticipant`) and returns `404` (not `403`) for a non-participant —
  covered by dedicated IDOR tests for conversations, messages, and calls.
- **Block bypass**: checked at conversation creation *and* on every
  subsequent send (not cached from creation time), and for calls at
  initiation — both directions, tested.
- **Privacy bypass**: `NO_ONE`/`EVERYONE`/`MUTUAL_FOLLOWERS` all tested,
  including the message-request path for the non-mutual case.
- **WebSocket authentication**: connections without a token, or with an
  invalid one, are rejected before `connection` fires — tested with a real
  client.
- **Token handling**: the same access token used for REST is sent once in
  the Socket.IO handshake `auth` payload (not a URL query parameter, so it
  doesn't end up in server access logs).
- **File upload validation**: voice messages get the same real-decode
  posture as video/image uploads — see §4.
- **Rate limits**: message send, conversation create, message/conversation/
  call report, voice upload, call initiate all have Redis-backed limits;
  **WebSocket connection abuse and typing-event flooding did not initially
  have any limit** — found during this review and fixed (see §2's
  connection-rate-limit and typing-throttle bullets). This is called out
  specifically because it was a real gap in the first draft, not a
  hypothetical.
- **Sensitive data exposure**: admin conversation/report listings return
  email/phone (matching Step 4's existing admin convention for videos/LIVE),
  gated by `requireAdmin`; ordinary users never see another user's contact
  info through the messaging API.
- **Admin authorization**: every new admin route re-verified with a
  non-admin-gets-403 test, not just relying on the shared
  `adminRouter.use(requireAuth, requireAdmin)` line being present.
- **Race conditions / duplicate creation**: message idempotency (database
  unique constraint) and call-initiation busy-checking (Serializable
  transaction, found and fixed during this review — see §5) were both
  specifically tested under real concurrency (`Promise.all`), not just
  sequentially.

## 9. Cross-cutting fixes made while building this step

- **Android/iOS platform permissions were missing entirely** — discovered
  while wiring up calls/voice messages. `AndroidManifest.xml` had no
  `INTERNET`, `CAMERA`, `RECORD_AUDIO`, or `MODIFY_AUDIO_SETTINGS`
  permissions at all (meaning *no* networking would have worked on a real
  Android device, for any step, not just this one), and `Info.plist` had no
  `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` (iOS hard-crashes
  a permission request without these, rather than just denying it). Both
  fixed. This was a latent Step 4 gap (LIVE also needs camera/mic) that
  next surfaced here because Step 5 needed the same permissions and this
  step actually reasoned through the real device manifest.

## 10. Test status

206 backend tests passing, 0 failing, across 13 files, run against real
Postgres + Redis + LiveKit (no mocks) — including a real Socket.IO
client/server round trip, not a simulated transport:

| File | Tests |
| --- | --- |
| `liveExtensions.test.ts` (Step 4, regression) | 38 |
| `messaging.test.ts` (new) | 29 |
| `live.test.ts` (Step 4, regression) | 22 |
| `videos.test.ts` (Step 3, regression) | 25 |
| `calls.test.ts` (new) | 21 |
| `auth.test.ts` (Step 2, regression) | 21 |
| `realtime.test.ts` (new) | 8 |
| `voiceMessages.test.ts` (new) | 8 |
| `adminAuth.test.ts` (Step 4, regression) | 10 |
| `follow.test.ts` (Step 3, regression) | 7 |
| `adminMessaging.test.ts` (new) | 3 |
| `profile.test.ts` (Step 2, regression) | 10 |
| `feed.test.ts` (Step 3, regression) | 4 |

`tsc --noEmit` (backend and admin) clean. `flutter analyze` (mobile) clean.
`prisma validate` / `prisma migrate status` clean against a fresh apply of
all eight migrations.

## 11. Known limitations (not blocking, tracked for a later pass)

- No admin frontend pages for the new inspection endpoints (API-only).
- No push notifications for a backgrounded/killed app — realtime-only
  delivery today (see §7).
- In-memory call ring-timeout doesn't survive a server restart (§5).
- Group messaging is not built (schema is shaped to allow it later without
  a rewrite, per §7).
- `CallListener` (mobile) re-registers its `call:incoming` socket listener
  on every widget rebuild while connected; harmless in a normal single
  login-per-session flow, but a repeated logout/login cycle within one app
  session could accumulate duplicate listeners. Not hit by any current
  flow; flagged rather than silently left.
- Real two-way WebRTC audio/video is untested on this development machine
  (§5) — the control-plane (room lifecycle, token issuance/grants) is real
  and tested; actual media decode by a second real client is not.
