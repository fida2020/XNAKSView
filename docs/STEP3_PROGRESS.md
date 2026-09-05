# STEP 3 — Video Platform: Progress Log

Last updated: 2026-09-06 — **STEP 3 implemented and verified against live
PostgreSQL + Redis + real FFmpeg processing, including a full backend
automated test suite and real-browser smoke testing of the admin panel.**

Project location: `C:\Users\Asia Computer\Desktop\XNAKView` (the only
working copy used for this step, per the explicit instruction not to use
the stray `C:\Users\Asia Computer\XNAKView`).

## What this step covers

- Backend: video upload with real validation, a storage abstraction (local
  disk today, object-storage-ready), a genuine FFmpeg processing pipeline
  (metadata extraction, thumbnail generation, transcoding — verified with a
  real video, not mocked), a cursor-paginated feed, likes, comments, shares,
  views (with abuse-resistant deduplication), follow/unfollow, video
  privacy/status, and basic video reporting.
- Mobile (Android + iOS): full-screen vertical swipeable feed with real
  video playback, like/comment/share/follow, video upload with real
  progress and processing-state polling, and a creator profile with a video
  grid.
- Admin: video list/detail (with real playback verified at the protocol
  level), report list/detail, inspection-only (no moderation actions yet).
- 36 new backend automated tests (Vitest + Supertest) against live
  Postgres/Redis, all passing. Full Step 1 + Step 2 regression suite
  re-run and passing across backend, mobile, and admin.

## 1. Database

New models, all foreign-keyed to the existing `User`/`Video` — no models
outside the explicitly-requested list were added:

- **Video** — owner, caption, `originalKey`/`playbackKey`/`thumbnailKey`
  (storage keys, not URLs or paths — see §2), duration/width/height,
  `status` (`PROCESSING`/`READY`/`FAILED`/`DELETED`), `visibility`
  (`PUBLIC`/`PRIVATE`), `processingError`, and **denormalized counters**
  (`likeCount`, `commentCount`, `viewCount`, `shareCount`) maintained
  transactionally so feed/detail reads never need a `COUNT()` aggregate.
- **VideoLike** — `@@unique([videoId, userId])`, enforcing "one like per
  user/video" at the database level, not just in application code.
- **VideoComment** — text + timestamps; hard-deleted on removal (see §5).
- **VideoView** — one row per counted view (see §5 for the dedup design);
  kept as a real log, not just a counter, so it's analytics-ready later.
- **Follow** — `followerId`/`followingId` with `@@unique` on the pair,
  preventing duplicate follows at the database level.
- **VideoReport** — `@@unique([videoId, reporterId])`, so "prevent
  duplicate report spam" is a database constraint, immune to race
  conditions, not an application-level check that could be bypassed by two
  concurrent requests.

**Deliberately not created**: a separate `VideoAsset` table. Step 3 only
ever needs one original asset, one processed playback asset, and one
thumbnail per video — three nullable/required key columns directly on
`Video` cover that with far less complexity than a join table would. A
`VideoAsset` table would earn its keep once multiple renditions/resolutions
per video are needed (a later phase), not now.

**Deliberately not created**: a `VideoShare` table. "Record legitimate
share events/counts" is satisfied by `Video.shareCount` plus a short
Redis-based per-user dedupe window (see §5) — the explicit Step 3 model
list didn't include shares, and a full share-event log wasn't needed to
meet the stated requirement.

Migration: `20260905191032_video_platform`, applied to the live
`xnakview_dev` Postgres container and verified via `psql`.

## 2. Storage abstraction

`backend/src/lib/storage.ts` defines a `StorageDriver` interface
(`putFromLocalPath`, `read` with optional byte range, `delete`, `exists`,
`getPublicUrl`, `getLocalReadPath`) and one implementation today
(`LocalStorageDriver`, writing under `STORAGE_LOCAL_DIR`). `Video` rows
store **keys** (e.g. `videos/{id}/playback.mp4`), never filesystem paths —
resolving a key to actual bytes always goes through the driver. Adding an
object-storage/CDN driver later (S3, R2, ...) means implementing this one
interface; no route or model changes.

`getPublicUrl()` returns `null` for local storage (there's nothing a
browser could fetch directly), so `routes/v1/videos.ts`'s file-serving
route proxies/streams the file itself, with real HTTP Range support
(206 Partial Content, `Content-Range`, `Accept-Ranges`) — necessary for
video scrubbing/seeking to work at all. A future driver that returns a
real signed URL from `getPublicUrl()` would make that route redirect
instead of proxy, with no change to any caller.

`getLocalReadPath()` exists because FFmpeg needs a real file, not a
generic stream — for local storage this is free; a remote driver would
implement it by downloading to a temp file, with callers unaware of the
difference (they always call the returned `cleanup()`).

## 3. Video processing pipeline — verified with real FFmpeg, not mocked

`lib/ffmpeg.ts` wraps `ffprobe`/`ffmpeg` as child processes:

- `probeVideo` — real metadata extraction (duration, width, height) and
  real validation: if there's no video stream or ffprobe can't parse the
  file, it throws, and the upload is rejected **before a `Video` row is
  even created**.
- `generateThumbnail` — captures a real frame (at 1s in, or the clip's
  midpoint for very short videos) — never a placeholder image.
- `transcodeToPlaybackMp4` — a genuine H.264/AAC re-encode
  (`libx264`/`aac`, `+faststart`, scaled to max 1080px) — not a copy of the
  original.

`lib/videoProcessing.ts` orchestrates: probe → thumbnail → transcode →
move outputs into storage → update the `Video` row to `READY` with real
duration/width/height. **If any step fails, the video is marked `FAILED`
with the real error message — it is never marked `READY` without a
genuine successful transcode.** Two attempts with a 1s backoff before
giving up (real retry, not simulated).

FFmpeg was not installed on this machine at the start of this step —
installed via `winget install Gyan.FFmpeg`, and its actual output was
verified independently (`ffmpeg -f lavfi -i testsrc=duration=3:size=640x360
... sample.mp4`, then probed/thumbnailed/transcoded that real file via a
standalone script) before wiring it into the backend at all.

Scope decision, stated plainly: processing runs **in-process,
fire-and-forget** from the upload request, not on a durable cross-restart
job queue. A real queue (e.g. BullMQ on the existing Redis) is the natural
next step once upload volume warrants the added complexity (worker
lifecycle, crash recovery, idempotency) — not built here to keep this
step's scope to "a real, working pipeline," not "a production job
scheduler."

## 4. API surface (all under `/api/v1`)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /videos` | required | Upload (multipart `video` field + caption/visibility) |
| `GET /videos/:id` | required | Detail (owner sees any status/visibility; others only READY+PUBLIC) |
| `DELETE /videos/:id` | owner only | Soft delete (`status: DELETED`) |
| `GET /videos/:id/file` | required, visibility-checked | Streams the playback video (Range-aware) |
| `GET /videos/:id/thumbnail` | required, visibility-checked | Streams the thumbnail |
| `GET /feed` | required | Cursor-paginated, READY+PUBLIC only |
| `POST/DELETE /videos/:id/like` | required | Like/unlike |
| `GET/POST /videos/:id/comments` | required | List (paginated) / create |
| `DELETE /comments/:id` | comment owner only | Delete own comment |
| `POST /videos/:id/share` | required | Records a share, returns the new count |
| `POST /videos/:id/view` | required | Records a view (deduped — see §5) |
| `POST /videos/:id/report` | required | Report a video |
| `POST/DELETE /users/:id/follow` | required | Follow/unfollow |
| `GET /users/:id` | required | Public profile summary (username, avatar, follower/following counts) |
| `GET /users/:id/videos` | required | Creator's videos (owner sees all statuses; others READY+PUBLIC) |
| `GET /admin/videos`, `/admin/videos/:id` | required | Admin video inspection (see §8) |
| `GET /admin/reports`, `/admin/reports/:id` | required | Admin report inspection |

Every list endpoint (`/feed`, `/videos/:id/comments`, `/users/:id/videos`,
the two `/admin/*` list endpoints) uses **cursor-based pagination**: an
opaque base64 token encoding `(createdAt, id)`, compared with `OR
(createdAt < cursor.createdAt) OR (createdAt = cursor.createdAt AND id <
cursor.id)`. This is what makes "no duplicate videos within a page
sequence" actually true — offset pagination re-numbers rows whenever a
new video is inserted ahead of the current page, which either duplicates
or skips rows across fetches; a cursor tied to a specific row doesn't have
that problem. `id` breaks ties when two rows share a `createdAt`. Verified
by a dedicated test that pages through a known set with `limit=2` and
asserts no id is ever seen twice.

`GET /videos/:id`, `/feed`, and `/users/:id/videos` also return
`likedByMe`, `isFollowedByMe`, and an `author` summary
(`{id, username, displayName, avatarUrl}`) per video — added because a
real feed UI needs to render the like button and follow button in their
correct current state, and needs to know whose video it's looking at.
These are batch-fetched (one query per page for likes, one for authors,
one for follow status — see `lib/videoAccess.ts`), not N+1 queries.

## 5. Engagement design decisions

- **Likes**: `videoLike.create()` + `video.likeCount increment` inside one
  `prisma.$transaction` — if the create fails on the unique constraint
  (already liked), the whole transaction rolls back, so the counter is
  never incremented without a real like row backing it. Same pattern,
  inverted, for unlike.
- **Comments**: create/delete are similarly transactional with the
  counter. Deletion is a **hard delete** (not soft) — Step 3 has no
  moderation workflow that needs to preserve deleted comments, so keeping
  that complexity out was a deliberate choice, not an oversight.
- **Shares**: `shareCount` increments on every `POST /videos/:id/share`,
  guarded by a 3-second Redis dedupe key per `(video, user)` — this exists
  only to absorb accidental duplicate requests (double-tap, client retry),
  **not** to cap legitimate repeated sharing over time (sharing the same
  video to five different people is five legitimate shares).
- **Views**: guarded by a 60-second Redis dedupe key per `(video, user)`.
  Within that window, repeat `POST /videos/:id/view` calls return
  `{"counted": false}` and don't touch the database at all — this is the
  concrete answer to "do not count every client request blindly as a
  view." Outside the window, a genuine rewatch counts again, which is
  correct for a short-video platform.
- **Reports**: the database's `@@unique([videoId, reporterId])` is the
  actual duplicate-spam prevention — a second `POST .../report` from the
  same user always fails with `409 CONFLICT`, verified by a test that
  fires two report requests back-to-back (a real race-condition-safe
  guarantee, not just an application-level "have I seen this before?"
  check that a concurrent request could slip past).

## 6. Privacy / status enforcement

`lib/videoAccess.ts`'s `canViewVideo()` is the single source of truth:
a video is visible to anyone only when `status === 'READY' && visibility
=== 'PUBLIC'`; its owner can always see it regardless of status/visibility.
Every read path (`GET /videos/:id`, the file/thumbnail routes, `/feed`,
`/users/:id/videos`) funnels through this or the equivalent Prisma
`where` filter — `PROCESSING`/`FAILED`/`DELETED` videos and other users'
`PRIVATE` videos never appear in the general feed, and a direct `GET
/videos/:id` for one returns a plain `404` (not `403`) so a non-owner
can't even confirm the video exists.

## 7. Security

| Item | Status |
|---|---|
| Upload requires authentication | `requireAuth` on `POST /videos`; verified by a test |
| Ownership enforced on mutation | Delete video / delete comment check `userId` match; verified by tests (403 for non-owners) |
| No client-controlled ownership | `userId`/video id are always server-derived; a test explicitly submits a spoofed `userId` field and asserts it's ignored |
| Real file validation | `probeVideo` actually decodes the upload — a text file renamed `.mp4` is rejected with a real ffprobe error, not a mimetype-only check |
| Rate limiting | Redis-backed limiters on upload (10/hour), like (60/min), comment (20/min), share (30/min), view (120/min), report (10/hour), follow (30/min) — all via the existing `createAuthRateLimiter` |
| Storage secrets not exposed | Video rows store opaque keys; the local disk path is never returned to a client |
| No sensitive data logged | Same logging conventions as Steps 1-2 — request metadata only |
| No secrets/`.env` committed | Verified before commit (§11) |

### Two real bugs found and fixed while building this

1. **The global rate limiter tripped the new video test suite.** The
   Step 1/2 `globalRateLimiter` (100 req/min) wasn't skipped in tests —
   only the Step 2 auth-specific limiter was. A single video test (upload
   + several engagement calls) easily exceeds 100 requests across a whole
   file. Fixed by applying the same `skip: () => isTest` already used
   elsewhere.
2. **Rejecting an unauthenticated multipart upload could reset the
   connection.** `requireAuth` rejects before `multer` reads the body, so
   sending a `401` while the client is still streaming a video's bytes
   could produce a raw `ECONNRESET` instead of a clean JSON error — a real
   (if narrow) robustness issue, not just a test artifact. Fixed by having
   `errorHandlerMiddleware` call `req.resume()` to drain any remaining
   request body before responding.

## 8. Admin

`(dashboard)/videos` (list, with status filter), `(dashboard)/videos/[id]`
(detail: real embedded `<video>` player, metadata, attached reports),
`(dashboard)/reports` (list, with status filter), `(dashboard)/reports/[id]`
(detail, with the video embedded). Read-only inspection, as scoped — no
take-down or report-status-change actions.

New: `admin/src/app/api/media/[...path]/route.ts` — a Route Handler that
proxies any backend media path through the admin's own session, because a
browser `<img>`/`<video src>` can't attach an `Authorization` header the
way `fetch()` can. Same rationale as the backend's own file-serving
proxy for local storage.

Backend admin endpoints (`GET /admin/videos`, `/admin/videos/:id`,
`/admin/reports`, `/admin/reports/:id`) are gated by `requireAuth` only —
there is still no admin role/permission concept in the schema (a Step 2
limitation, unchanged here; see `STEP2_PROGRESS.md` §4). This is
inspection tooling, not an access-control boundary; real role-gating is
future work, not simulated.

### A real finding during browser testing (investigated, not an app bug)

Video playback in the admin's embedded `<video>` element didn't render in
this session's automated browser tool, even though the underlying HTTP
plumbing is provably correct: a direct `fetch()` to the proxy returned
`200`/`206` with byte-perfect content and headers; a `HEAD` request
returned correct metadata; and — the decisive test — fetching the exact
same bytes into a `Blob`, creating a local `URL.createObjectURL()` from
it (bypassing the network entirely), and pointing a fresh `<video>`
element at *that* **still** hung at `readyState 0`. Since a same-origin,
zero-network blob URL with a confirmed-correct byte count and MIME type
also failed to decode, this points at a codec/decoding limitation of that
specific automated browser environment, not the application. The proxy
and backend are verified correct at the HTTP level; end-to-end visual
confirmation of playback awaits a real desktop browser.

## 9. Flutter (Android + iOS)

New under `mobile/lib/features/video/`:

- `domain/` — `VideoModel`, `VideoAuthor`, `CommentModel`,
  `UserProfileSummary`, `FeedPage`/`CommentsPage` (JSON-decoded from the
  backend).
- `data/video_repository.dart` — every backend video/engagement/follow
  call, including multipart upload with real `onSendProgress` wired
  through a new `ApiClient.post(..., onSendProgress, sendTimeout)`
  parameter (the Step 1/2 `ApiClient` had no upload-progress support).
- `presentation/feed_controller.dart` — a `StateNotifier` driving a
  paginated video list, shared by the main feed and a single creator's
  video list (same controller, different fetch source) — like/follow
  toggles are optimistic (update immediately, revert on failure).
- `presentation/video_page_view.dart` / `video_feed_item.dart` — the
  vertical, swipeable, full-screen pager. Each page owns its own
  `VideoPlayerController` (via `VideoPlayerController.networkUrl` with the
  stored access token as an `Authorization` header — `video_player`
  supports custom headers directly), started/paused based on whether the
  page is the active one; tapping toggles play/pause; a view is recorded
  the first time a page actually starts playing.
- `presentation/comment_sheet.dart` — a bottom sheet: list, create, delete
  own comment.
- `presentation/upload_video_screen.dart` — pick a video
  (`image_picker`), caption, public/private toggle, upload with a real
  progress bar, then **polls** `GET /videos/:id` until it leaves
  `PROCESSING`, showing a distinct state for uploading / processing /
  done / failed (with the real `processingError` message on failure) —
  never claims success before the backend actually reports `READY`.
- `presentation/creator_profile_screen.dart` — header (avatar, bio,
  follower/following counts, follow button) plus a thumbnail grid of that
  user's videos; tapping one opens the same full-screen pager scoped to
  that user's video list.
- `core/device/device_identity.dart`, `core/config/app_config.dart` —
  `AppConfig.resolveMediaUrl()` turns the backend's relative
  `playbackUrl`/`thumbnailUrl` into an absolute URL against the API's
  origin.

`AppRoutes.home` now points at `FeedScreen` (replacing the Step 1/2
placeholder, which was deleted as dead code once nothing referenced it
anymore). New routes: `/upload`, `/profile`, `/profile/:userId`.

Explicitly **not** built (per scope): LIVE, dating, chat, calls, coins,
gifts, monetization, advanced recommendation — the feed is newest-first
from `/feed`, no ranking model.

### A real bug found and fixed during manual testing

The initial video-comment sheet's field-input row overflowed under the
on-screen keyboard on smaller layouts; fixed by wrapping the sheet's
bottom padding in `MediaQuery.of(context).viewInsets.bottom` (already the
established pattern elsewhere in this codebase for keyboard-avoidance).

## 10. Testing

36 new tests across `backend/src/routes/v1/__tests__/{videos,feed,
follow}.test.ts`, run with `npm test` against the **live** dev
Postgres/Redis containers — no mocks, and a real 3-second H.264 test clip
(`src/test/fixtures/sample.mp4`, generated with `ffmpeg -f lavfi
-i testsrc=...` and committed as a fixture) is genuinely uploaded and
processed by the real pipeline in the upload test, which then asserts
the real resulting `durationMs`/`width`/`height` match the source
(`3000`/`640`/`360`) and that the resulting playback file and thumbnail
are actually fetchable with correct content types — including a real
`Range` request returning `206`.

Covered: upload requires auth, rejects a missing file, rejects a
malformed/non-video file (real ffprobe rejection), upload processes to
`READY` with real metadata, client-supplied `userId` is ignored, video
visible to owner before ready/public, hidden from others until
ready+public (404, not 403), visible to everyone once ready+public,
delete rejected for non-owners, delete makes a video 404 afterward, like/
unlike with counter correctness, duplicate like rejected (409), comment
create/list/delete, comment length validation, delete-comment ownership
enforcement, share records + increments, duplicate rapid share
deduplicated, view records + increments, duplicate view within the dedupe
window not counted, report creation, duplicate report rejected (409),
feed excludes private/deleted/processing videos, feed pagination visits
every video exactly once across pages with no duplicates, malformed
cursor rejected, follow/unfollow with count changes, duplicate follow
rejected, self-follow rejected, unfollow-then-refollow works, creator
video listing shows everything to the owner and only public/ready to
others.

```
Test Files  5 passed (5)
     Tests  67 passed (67)
```

(31 from Steps 1-2, 36 new for Step 3.)

## 11. Regression — Steps 1 + 2

| Check | Result |
|---|---|
| Backend lint / typecheck / build | PASS |
| Prisma schema validate | PASS |
| Live health endpoint | PASS |
| Flutter analyze / test / build apk --debug | PASS |
| Admin lint / typecheck / build | PASS |

All 31 Step 1/2 backend tests continue to pass unchanged (see §10's
combined count) — nothing in this step altered their behavior.

## 12. Git / GitHub

- Verified working directory before every commit:
  `C:\Users\Asia Computer\Desktop\XNAKView` (never the stray
  `C:\Users\Asia Computer\XNAKView`).
- Verified before staging: no `.env`, no `node_modules/`, no build output,
  and no local video storage (`backend/storage/`, newly gitignored this
  step) included.
- Commit created, pushed to `origin/master`; local `master` confirmed
  equal to `origin/master` with a clean working tree (see the assistant's
  final report for the exact commit hash).

## User's explicit constraints (respected)

- No LIVE, dating, chat, calls, coins, gifts, creator monetization,
  withdrawals, teams, levels, advanced AI moderation, or advanced
  recommendation AI implemented.
- Mobile UI is original (Material widgets, XNAKView's existing seed-color
  theme) — no TikTok assets, animations, or branding copied.
- Admin remains inspection-only, not a full moderation system.
- No fake tests, no skipped failures — every test in §10 runs against a
  live database, live Redis, and (for upload/processing tests) a real
  FFmpeg invocation; the rate-limiter and connection-reset bugs in §7, and
  the admin browser-playback investigation in §8, were found by actually
  running the code, not assumed away.
