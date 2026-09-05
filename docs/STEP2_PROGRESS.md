# STEP 2 — Authentication & User Profiles: Progress Log

Last updated: 2026-09-05 — **STEP 2 implemented and verified against live
PostgreSQL + Redis, including a full backend automated test suite and a
real-browser smoke test of the admin login flow.**

Project location: `C:\Users\Asia Computer\Desktop\XNAKView` (the only
working copy used for this step — see "Known leftovers" in
`STEP1_PROGRESS.md` for two harmless stray copies elsewhere that were not
touched).

## What this step covers

- Backend: registration (email or phone), 18+ age enforcement computed
  server-side, login, JWT access tokens + hashed/rotating refresh tokens
  backed by `Session`, logout/revocation, `/me`, profile create/update/read,
  account-status enforcement, Redis-backed rate limiting and a per-identifier
  login lockout.
- Mobile (Android + iOS, same Flutter codebase): welcome/splash → login/
  register → DOB step → profile setup → home, real API integration, secure
  token storage, loading/error states.
- Admin: real login backed by the same backend auth, middleware-enforced
  route protection (verified against the backend on every navigation, not
  just cookie presence), logout.
- 31 new backend automated tests (Vitest + Supertest) against live
  Postgres/Redis, all passing. Full Step 1 regression suite re-run and
  passing across backend, mobile, and admin.

## 1. Backend

### Database

`backend/prisma/schema.prisma` already had everything Step 2 needed from
Step 1's foundation models (`User`, `Profile`, `Verification`, `Device`,
`Session`) — no new models were added, per the "extend only where required"
constraint. One small, genuinely-needed addition: `Session.deviceId` (optional
FK to `Device`), so a session can be traced back to the device that created
it — the minimum needed for future multi-device session management, without
building that management UI now.

Migration: `20260905180733_add_session_device_link`, applied against the
live `xnakview_dev` Postgres container and verified via `psql`.

### Auth design

- **Passwords**: hashed with `bcryptjs` (12 rounds), never stored or logged
  in plaintext. Policy: ≥10 chars, upper+lowercase, digit, symbol — enforced
  server-side via a zod schema (`schemas/auth.schema.ts`), independent of
  whatever the client does.
- **Access tokens**: JWTs (`JWT_ACCESS_SECRET`, 15m TTL by default), payload
  is `{ sub: userId, sid: sessionId }` — deliberately includes the session
  id, not just the user id (see "Revocation" below).
- **Refresh tokens**: opaque random tokens (48 bytes), returned to the
  client once; only their SHA-256 hash (`Session.refreshTokenHash`) is ever
  persisted, so a database leak doesn't hand out usable tokens. Refresh
  **rotates** on every use: the old session is revoked and a new one issued,
  so a stolen refresh token stops working the moment the legitimate client
  refreshes again.
- **Revocation is real, not just "the refresh token stops working"**: the
  access token's `sid` is checked against `Session.revokedAt`/`expiresAt` on
  *every* authenticated request (`middleware/auth.ts`). This costs one extra
  query per request versus a purely stateless JWT check, but it's what makes
  logout, admin suspension, and refresh-rotation take effect immediately
  instead of waiting out the access token's 15-minute TTL. This tradeoff is
  deliberate and documented here rather than silently accepted.
- **Account status**: reuses Step 1's `UserStatus` enum as-is (no new values
  added). New registrations are set to `ACTIVE` directly — `PENDING_VERIFICATION`
  is left available for a future email/SMS verification flow (out of scope
  for Step 2, since no verification-code sending exists yet). Login and the
  auth middleware both reject any non-`ACTIVE` status.

### 18+ enforcement

`dateOfBirth` is required at registration. Age is computed **only**
server-side (`lib/age.ts`, calendar-accurate, UTC-based) from that date —
the request body has no `age` or `ageVerified` field for a client to send,
and even if extra fields are included in a request, zod strips them before
the handler ever sees them (verified by a dedicated test: `does not trust
a client-supplied ageVerified value`). Under-18 registrations are rejected
outright (`403 FORBIDDEN`) — no account is created, ageVerified is never
set to `true` for them. `ageVerified: true` is only ever set by the server,
at the moment it has independently confirmed the DOB clears 18.

### Rate limiting / abuse protection (Redis)

- `middleware/rateLimit.ts` gained `createAuthRateLimiter`, an IP-based
  limiter backed by Redis (`rate-limit-redis`) rather than in-memory state,
  applied to `/auth/register` (5/hour), `/auth/login` (15/15min), and
  `/auth/refresh` (60/15min).
- `lib/loginLockout.ts` adds a **per-identifier** lockout (independent of
  IP): 8 failed attempts against the same email/phone within 15 minutes
  returns `429 RATE_LIMITED`, cleared on a successful login. This protects
  a specific targeted account even from a distributed/rotating-IP attacker,
  which the IP limiter alone can't.
- Both are disabled only in the test environment for the IP-based limiter
  (`isTest` skip, so 30+ automated requests to the same endpoint in a test
  file don't trip it) — the per-identifier lockout stays active in tests
  and is exercised directly by its own test.
- Redis is used only for this kind of ephemeral/rate-limit state — Postgres
  remains the sole source of truth for user/session/profile data.

### API surface (all under `/api/v1`)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /auth/register` | none (rate-limited) | Create account (email or phone + password + DOB), auto-issues a session |
| `POST /auth/login` | none (rate-limited) | Authenticate, issues a session |
| `POST /auth/refresh` | refresh token in body | Rotates the session, issues a new token pair |
| `POST /auth/logout` | access token | Revokes the current session |
| `GET /me` | access token | Authenticated user's account + profile |
| `GET /profile` | access token | Authenticated user's own profile |
| `PUT /profile` | access token | Create/update the authenticated user's own profile |

### Profile

`PUT /profile` upserts the caller's own profile — there is no route
parameter naming a different user, so "a user can only modify their own
profile" is structural, not a permission check that could be forgotten
(verified by a dedicated test). Validation (`schemas/profile.schema.ts`):
username 3-20 chars, must start with a letter, letters/digits/underscores
only, normalized to lowercase for uniqueness (`"Fida"` and `"fida"` collide
by design); displayName ≤50 chars; bio ≤300 chars; avatarUrl must be a
`https://` URL; country/city are short free-text fields. Username
uniqueness conflicts return `409 CONFLICT`.

### A real bug fixed along the way

`tsconfig.json`'s `include` listed `prisma/seed.ts` under `rootDir: "src"`,
which is structurally invalid (a file outside `rootDir` can't be included)
— it only surfaced once `prisma/seed.ts` existed. Fixed by dropping it from
`include`; it doesn't need to be there since `db:seed` runs it via `tsx`
directly, not through `tsc`.

Also hardened `lib/redis.ts`'s `connectRedis()` to be a no-op if already
connecting/connected (checks `redis.status` first) — needed because the new
test suite's multiple test files share one Redis client instance, and
without the guard a second `connect()` call while the first was still
in-flight would throw. Harmless and correct in production too, where it was
previously assumed `connectRedis()` would only ever be called once.

## 2. Testing

31 new tests, `backend/src/routes/v1/__tests__/{auth,profile}.test.ts`
(Vitest + Supertest), run with `npm test`, against the **live** dev
Postgres/Redis containers (not mocks) — `src/test/setup.ts` truncates the
relevant tables before each run so results are deterministic.

Covered: registration success (email + phone), duplicate email, duplicate
phone, weak password rejected, under-18 rejected, one-day-under-18
rejected, exactly-18-today accepted, client-supplied `ageVerified`/`status`
ignored, login success (email + phone), invalid credentials (generic
message, doesn't distinguish "no such account" from "wrong password"),
suspended account blocked, deleted account blocked, per-identifier
brute-force lockout, refresh + rotation (old token rejected after use),
unknown refresh token rejected, logout revokes the session (subsequent
`/me` with the same access token fails), `/me` success/unauthenticated/
malformed-token, profile create/update, duplicate username rejected,
invalid username rejected, bio-too-long rejected, non-https avatarUrl
rejected, cross-user profile isolation.

```
Test Files  2 passed (2)
     Tests  31 passed (31)
```

## 3. Mobile (Android + iOS)

New/changed under `mobile/lib/`:

- `core/device/device_identity.dart` — a random, opaque per-install
  identifier persisted in secure storage (deliberately **not** a hardware
  ID like IMEI or advertising ID — "non-invasive" per the brief) plus a
  `currentDevicePlatform()` helper matching the backend's `DevicePlatform`
  enum.
- `core/errors/app_exception.dart` — added `ForbiddenException` (403, e.g.
  under-18/suspended), `ConflictException` (409, e.g. duplicate
  email/username), `RateLimitedException` (429); `core/network/api_client.dart`
  maps these from the real HTTP status and now also surfaces zod's
  `fieldErrors` on 422s.
- `features/auth/domain/user_account.dart` — `UserAccount`, `ProfileModel`,
  `MeResult`, `AuthSessionResult` (JSON-decoded from the backend responses).
- `features/auth/data/auth_repository.dart` — register/login/logout/
  fetchMe/upsertProfile calls.
- `features/auth/data/token_refresher.dart` — used at app startup to
  silently exchange a stale access token for a fresh one via the stored
  refresh token, before falling back to "logged out".
- `features/auth/presentation/auth_controller.dart` — rewritten:
  `register()`, `login()`, real `signOut()` (calls the backend, best-effort,
  then always clears local tokens), and startup session restore now calls
  `/me` (not just "does a token exist locally") so a revoked/expired token
  is detected immediately rather than showing a broken authenticated state.
- `features/auth/presentation/sign_in_screen.dart` — real login screen
  (email/phone toggle, password, loading/error states).
- `features/auth/presentation/register_screen.dart` — new two-step flow:
  credentials (email-or-phone + password, client-side strength hint mirrors
  the backend's real rules) → date-of-birth picker with an explicit 18+
  notice, submitted as a single `/auth/register` call.
- `features/profile/presentation/profile_setup_screen.dart` — new,
  post-registration username/displayName/bio screen.
- `core/router/app_router.dart` — added `/register` and `/profile-setup`
  routes; redirect logic now also sends an authenticated user with no
  profile yet to profile setup before the home shell.

Explicitly **not** built (per scope): video feed, LIVE, dating, chat,
gifts, coins, monetization — the home screen remains the Step 1 placeholder.

### Real bug found and fixed during manual testing

The initial `PUT /profile` username validation regex only accepted
lowercase input (`^[a-z][a-z0-9_]*$`) even though the field is meant to
normalize casing — a real user typing `"SmokeTester"` would have been
rejected instead of normalized. Fixed to accept mixed case and lowercase it
(`backend/src/schemas/profile.schema.ts`).

## 4. Admin

- `POST /api/auth/login`, `POST /api/auth/logout` (Next.js Route Handlers)
  — authenticate against the **same backend `/auth/login`/`/auth/logout`**
  every other client uses, then set/clear two httpOnly cookies (access +
  refresh token).
- `src/app/login/page.tsx` — real client-side login form (was a static
  placeholder).
- `src/app/(dashboard)/dashboard/page.tsx` — now calls the backend `/me`
  with the session's access token and shows the real authenticated
  account (email + status), plus a working sign-out button.
- **Deliberate scope limit, documented rather than hidden**: there is no
  admin-specific role/permission concept in the Step 2 schema (`User` has
  no `role` field) and building one wasn't asked for. Admin login today
  authenticates as *any* XNAKView user account — it proves the
  login/session/protection plumbing end-to-end, not "who is allowed to be
  an admin." That gating is real future work once a role concept exists,
  not simulated here.

### Two real bugs found and fixed while testing this in an actual browser

1. **Cached authenticated responses.** `admin/src/lib/api-client.ts`'s
   shared `fetch()` wrapper didn't disable Next.js's fetch data cache. In
   testing, an authenticated `/me` response got cached and was then served
   back for a *different, invalid* token — a real bug with real security
   implications, not a hypothetical. Fixed by forcing `cache: 'no-store'`
   on every request this client makes, since every response here is
   per-caller and must never be shared.
2. **`redirect()` inside a streamed Server Component.** The dashboard route
   has a `loading.tsx` (from Step 1), which makes Next.js stream the page.
   Calling `redirect()` from deep inside the page's data-fetching after
   streaming has already started doesn't produce a clean HTTP redirect —
   it throws a React error (`#441`) that surfaced in a real browser as a
   broken "Couldn't load the dashboard" error screen instead of sending the
   user to login. Confirmed with `claude-in-chrome`, not just inferred.
   **Fix**: moved session verification into `proxy.ts` (middleware), which
   runs before any page starts rendering — it now calls the backend `/me`
   with the session cookie on every protected navigation and redirects
   (clearing the dead cookie) before the page is ever reached. Verified
   live: a session revoked directly in Postgres now produces a clean
   redirect to `/login?redirectTo=%2Fdashboard`, and the golden path
   (login → dashboard shows real account data → sign out) still works,
   both confirmed in an actual browser, not just curl.

## 5. Security checklist (Step 2 scope)

| Item | Status |
|---|---|
| Password hashing | bcryptjs, 12 rounds, never logged/returned |
| Refresh token hashing | SHA-256, raw token never persisted |
| Access token revocation | Checked per-request via session lookup, not just left to expire |
| Rate limiting | IP-based (Redis-backed) + per-identifier lockout |
| Input validation | zod at every mutating endpoint; unknown fields stripped |
| SQL/ORM safety | Prisma parameterized queries throughout; no raw SQL with interpolated input |
| CORS | Explicit allow-list (`CORS_ORIGINS`), unchanged from Step 1 |
| Secure headers | `helmet`, unchanged from Step 1 |
| Authorization | Profile mutation scoped to `req.user.id`, no user-id route params |
| No sensitive data in logs | Passwords/tokens never logged; pino logs request metadata only |
| No secrets in Git | Verified before commit (see §8) |
| No client-controlled privileges | age/status/ageVerified always server-computed; covered by a test |

Known, accepted limitation carried over from Step 1 and not touched here:
`npm audit` reports 9 pre-existing vulnerabilities (moderate/high/critical)
in `express`'s `body-parser`→`qs` chain, `uuid`, and dev-only `esbuild`/`vite`
— all require major version bumps outside Step 2's scope and were present
before this step. Not introduced by, or worsened by, the Step 2 changes.

## 6. Regression — full Step 1 suite re-run

| Check | Result |
|---|---|
| Backend lint | PASS |
| Backend typecheck | PASS |
| Backend build | PASS |
| Prisma schema validate | PASS |
| Live health endpoint (`/api/v1/health`) | PASS — 200, healthy, both dependencies connected |
| Flutter analyze | PASS — no issues |
| Flutter test | PASS |
| Flutter build apk --debug | PASS |
| Admin typecheck | PASS |
| Admin build | PASS |
| Admin lint | PASS |

## 7. Files changed

See `git show --stat` on the Step 2 commit for the exact list. Summary:
new backend auth/profile modules (`lib/{password,age,tokens,session,
loginLockout}.ts`, `middleware/auth.ts`, `schemas/*.schema.ts`,
`routes/v1/{auth,me,profile}.ts`, `routes/v1/__tests__/*`, `test/*`,
`vitest.config.ts`), one Prisma migration, small fixes to
`tsconfig.json`/`lib/redis.ts`/`middleware/rateLimit.ts`; new mobile auth/
profile/device modules and rewritten auth screens/router/controller; new
admin auth API routes + rewritten login/dashboard pages +
`proxy.ts`/`lib/auth.ts`/`lib/api-client.ts` fixes.

## 8. Git / GitHub

- Verified working directory before every commit:
  `C:\Users\Asia Computer\Desktop\XNAKView` (never the stray
  `C:\Users\Asia Computer\XNAKView`).
- Verified before staging: no `.env` files, no `node_modules/`, no build
  output (`dist/`, `.next/`, `.apk`) included — only `.env.example` files
  are ever tracked.
- Commit created, pushed to `origin/master`. See the top of this repo's
  commit log for the exact hash; the assistant's final report for this step
  states it explicitly.
- Post-push: confirmed local `master` == `origin/master` and a clean
  working tree.

## User's explicit constraints (respected)

- No video, feed, LIVE, dating, chat, calls, gifts, coins, monetization,
  ads, or advanced AI built — home screen remains the Step 1 placeholder.
- Admin: only login/route-protection foundation built, not full user
  management.
- No fake tests, no skipped failures — every test in §2 exercises the real
  code against a live database and Redis; the two admin bugs in §4 and the
  tsconfig/profile-regex bugs in §1/§3 were found by actually running the
  code (automated tests + a real browser), not assumed away.
