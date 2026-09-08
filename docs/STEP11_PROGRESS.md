# Step 11 — Levels, Teams & Gamification

**Status: complete.** Server-authoritative XP/levels, badges, achievements,
streaks, LIVE Fan Club, LIVE Teams, leaderboards, gamification notifications,
and admin configuration — fully integrated with the existing Coins/Gifts/
Diamonds/Creator Earnings/LIVE/LIVE Match/Follow/Trust & Safety systems built
in Steps 1–10. No fake XP, no fake badges, no fake rankings, no fake
monetary rewards, no client-side manipulation, no MLM recruitment economics.

## Hard rule this step is built around

XP, levels, badges, points, and rankings are **never** automatically cash.
`lib/gamification/*` never writes to `CoinWallet`, `CreatorDiamondWallet`, or
`CreatorEarningsWallet` — it only ever *reads* facts those systems already
committed (e.g. a `GiftTransaction.totalCoins`) to decide how much XP to
award. Every monetary change still flows exclusively through the Step 7–9
ledger architecture, untouched by this step.

## What TikTok actually has vs. what doesn't exist there

Before building anything, this step researched TikTok's current (2025-2026)
Help Center, Creator Academy, Safety Center, and Newsroom/Transparency Center
pages, plus corroborating tech-press reporting, rather than assuming TikTok
has a game-style leveling system. Headline findings, each cited:

- **TikTok has no general public account-level/XP system.** The closest
  things (TikTok Shop Creator Level, Business Center "entitlements") are
  unrelated e-commerce/permissions tiers, not gamification. XNAKView's User
  Level is therefore an **XNAKView-original mechanic**, not a TikTok port —
  disclosed as such everywhere it appears in code/UI copy.
- **TikTok LIVE Fan Club is real and disclosed at a feature level**
  (join via a 1-coin "Heart Me" gift, 50 fan levels, a visible fan badge in
  chat, daily missions, a 7-day dormancy freeze) but **TikTok publishes no
  exact point formula or level thresholds.** ([TikTok LIVE Studio Help Center — Building Your Fan Club](https://www.tiktok.com/live/studio/help/article/Build-a-career/Building-Your-Fan-Club-How-Fan-Clubs-Strengthen-Your-Streaming-Community?lang=en))
  A paid "Super Fan" subscription tier (launched Sept 15, 2025) grants
  automatic membership + a permanent badge + faster leveling.
  ([TikTok Creator Academy — Subscription or Super Fan](https://www.tiktok.com/creator-academy/en/article/subscription-or-superfan))
- **TikTok has no in-app Team/Guild system.** LIVE "agencies"/guilds are an
  off-platform business/recruiting relationship, not an in-app feature with
  roles, targets, or a team leaderboard. XNAKView's Team system is therefore
  also **XNAKView-original**, inspired loosely by the general concept of
  streaming-platform host teams (a pattern more associated with apps like
  Bigo Live/Likee) rather than copied from TikTok.
- **TikTok LIVE does have ranking mechanics**: a Daily Ranking (24h Diamond
  leaderboard) and a weekly Creator League (tiered, e.g. "League D5"), plus
  an in-stream Top Gifter list and Fan Club "Popular" rankings — exact
  scoring formulas undisclosed.
- **TikTok's Community Guidelines / Safety Center explicitly prohibit** fake
  engagement, platform manipulation (bulk/automated account creation), and
  coordinated inauthentic behavior in this general language, never naming
  "self-gifting" specifically:
  ([TikTok Safety Center — Integrity and Authenticity](https://www.tiktok.com/safety/en/policies-and-engagement/integrity-authenticity),
  [TikTok Newsroom — How TikTok counters deceptive behaviour](https://newsroom.tiktok.com/en-eu/how-tiktok-counters-deceptive-behaviour))
- **TikTok's verification badge** is real, free, and not based on follower
  count. **TikTok tested (not fully shipped)** a Snapchat-style DM streak in
  mid-2024, limited to chat activity — XNAKView's LIVE-attendance/Fan-Club/
  creator-activity streaks are an original extension of that general idea,
  not a copy of a shipped TikTok feature.
- **The Creator Rewards Program** (successor to the Creator Fund/Creativity
  Program) is a monetization-eligibility gate (18+, ≥10k followers, ≥100k
  30-day views, good standing) with payout tied to originality/watch time/
  engagement — **not** a tiered "level" system, and correctly kept separate
  from this step's XP/level design.

Nothing above is treated as license to reverse-engineer or claim a private
TikTok algorithm. Every number XNAKView uses (XP amounts, level thresholds,
streak grace windows, badge/achievement criteria) is defined in
`lib/gamification/config.ts`, admin-overridable, and disclosed in code
comments as XNAKView's own rule.

---

## A–J comparison by feature area

### 1. User Levels & Creator Levels

- **A. TikTok behavior verified:** No general account-level system exists on
  TikTok (see above). LIVE host progression instead uses Daily
  Ranking/Creator League (undisclosed formula).
- **B. XNAKView implementation:** Two separate append-only XP ledgers
  (`XPLedger.USER`, `XPLedger.CREATOR`), each with its own level-threshold
  curve (`GamificationConfig` keys `USER_LEVEL_THRESHOLDS`/
  `CREATOR_LEVEL_THRESHOLDS`). Every award is a `XPEvent` row (idempotent via
  a unique `(ledger, userId, scopeId, sourceType, sourceRefId)` key,
  race-safe via a caught `P2002`), which then atomically updates a
  materialized `UserLevel`/`CreatorLevel` snapshot and records a
  `LevelUpEvent` + notification on level-up. Sources: follows, content
  published, LIVE hosted minutes, LIVE watched minutes, Gifts sent/received,
  achievement unlocks, streak milestones, and positive-only admin bonus
  grants.
- **C. Differences:** XNAKView's User Level is original (TikTok has none);
  Creator Level is XNAKView's own analogue to TikTok's undisclosed host
  ranking, not a claim of parity with it.
- **D. XNAKView-specific rules:** XP curve is `generateCurve(50, base,
  growth)` (a disclosed geometric curve, `config.ts`), fully admin-editable
  without a deploy.
- **E. Anti-abuse:** An active `FraudHold` on the user excludes the XP event
  from the snapshot (still recorded, `excludedAsFraud: true`, for audit); a
  per-user-per-hour XP-event rate cap (`ANTI_ABUSE_SETTINGS.
  maxXpEventsPerUserPerHour`) does the same.
- **F. Admin configuration:** `GET/PUT /admin/gamification/config/
  USER_LEVEL_THRESHOLDS` etc. — every change is a new, timestamped,
  attributed row (never edited in place, mirroring `DiamondEarnRate`'s own
  posture) — full version history via `GET .../history`. A positive-only
  `POST /admin/gamification/xp-adjustments` bonus grant is itself an
  `XPEvent` (fully auditable, never a raw balance write).
- **G. Backend tests:** idempotency, concurrent-call race safety, fraud-hold
  exclusion, Follow-driven XP, Gift-driven XP on both ledgers, "historical XP
  integrity" (a config change never rewrites an already-recorded `XPEvent`),
  admin-only config authorization, positive-only bonus validation
  (`gamification.test.ts`).
- **H. Mobile tests:** `GamificationRepository` progress-bar math including
  the max-level (`nextLevelXP: 0`) divide-by-zero case
  (`gamification_repository_test.dart`).
- **I. Admin status:** Backend API complete; no dedicated admin UI page yet
  (see "Admin UI" limitation below — matches this codebase's existing
  precedent for Steps 7–10).
- **J. Remaining limitations:** Level-up "reward" is XP/cosmetic only by
  design — there is intentionally no monetary tier attached to a level.

### 2. LIVE Fan Club

- **A. TikTok behavior verified:** see above — join via a Gift, 50 levels,
  daily missions, in-chat badge, 7-day dormancy freeze; formula undisclosed.
- **B. XNAKView implementation:** `FanClub` (one per creator, auto-created on
  first join attempt) + `FanClubMembership` (fan level/XP snapshot). Join
  awards a one-time `FAN_CLUB_JOIN` XP event (idempotent even across a
  leave→rejoin cycle — the event's key is the FanClub id itself, so it can
  never be farmed by repeatedly leaving and rejoining). Daily engagement
  (LIVE watched, a Gift sent to that creator) credits `FAN_CLUB_ENGAGEMENT`
  XP once per UTC day via `creditFanEngagement`, plus a `FAN_CLUB_ENGAGEMENT`
  streak.
- **C. Differences:** No "Heart Me" gift requirement (XNAKView's join is a
  free action, admin-configurable per-club via `minAccountAgeDays`); no
  50-level cap; no dormancy-freeze enforcement yet (see limitations).
- **D. XNAKView-specific rules:** `FAN_LEVEL_THRESHOLDS` +
  `XP_AWARD_RULES.FAN_CLUB_JOIN`/`FAN_CLUB_ENGAGEMENT_DAILY`, both
  admin-configurable.
- **E. Anti-abuse:** Self-join blocked structurally (`fanId === creatorId`
  rejected); join XP is idempotent per Fan Club (see above); engagement XP
  flows through the same `recordXP` fraud-hold/rate-limit gate as every
  other XP source.
- **F. Admin configuration:** Fan-level thresholds and XP rules via the same
  `GamificationConfig` surface as Levels.
- **G. Backend tests:** join/leave, self-join rejection, join-XP-once-across-
  leave-rejoin (`gamification.test.ts`).
- **H. Mobile tests:** non-member vs. member view shape, no Fan Club yet
  (`exists: false`) (`gamification_repository_test.dart`); UI: `LIVE →
  loyalty icon → Fan Club sheet` (`fan_club_sheet.dart`), join/leave, level
  progress bar.
- **I. Admin status:** Backend only (see limitation).
- **J. Remaining limitations:** No dormancy/inactivity freeze (TikTok's
  7-day rule) implemented yet; no custom emotes/exclusive-gift perk tier.

### 3. Streaks

- **A. TikTok behavior verified:** TikTok tested (not fully/globally shipped)
  a chat-only DM streak in mid-2024; no LIVE-attendance/creator-activity
  streak exists on TikTok.
- **B. XNAKView implementation:** A single `Streak` model
  (`LIVE_ATTENDANCE` scoped per creator, `FAN_CLUB_ENGAGEMENT` scoped per
  Fan Club, `CREATOR_ACTIVITY` global per user), server-clock UTC-day based,
  idempotent per calendar day, with a configurable grace window
  (`STREAK_RULES.graceHours`) so a user isn't punished for being a few hours
  late relative to UTC midnight. Hitting a milestone (3/7/14/30/50/100 days)
  awards flat XP and re-checks the `CONSISTENCY_7_DAY_STREAK` badge.
- **C. Differences:** Explicitly original — not a TikTok port.
- **D. XNAKView-specific rules:** Milestone list + flat XP award are disclosed
  constants in `streaks.ts`.
- **E. Anti-abuse:** Only the FIRST qualifying action per UTC calendar day
  advances the count (verified by test); a LIVE watch session must clear a
  configurable minimum-minutes threshold before it counts toward
  `LIVE_ATTENDANCE` (prevents a 1-second join/leave from farming a streak).
- **F. Admin configuration:** `STREAK_RULES` (grace hours, minimum LIVE watch
  minutes for credit) via the standard config surface.
- **G. Backend tests:** continuation, no-double-credit-same-day, and reset
  after a long gap, with the longest-run high-water-mark preserved through a
  reset (`gamification.test.ts`).
- **H. Mobile tests:** covered via the repository layer's model parsing;
  dedicated Streaks UI is exposed via `GET /gamification/streaks` (no
  standalone screen shipped yet — see limitations).
- **I. Admin status:** Backend only.
- **J. Remaining limitations:** No dedicated mobile Streaks screen (data is
  fetched but only surfaced inline where relevant, e.g. it could be added to
  Fan Club/profile); intentionally no "streak freeze" purchasable item
  (would risk the "unhealthy/compulsive mechanics" the brief warns against).

### 4. LIVE Teams

- **A. TikTok behavior verified:** No in-app team/guild feature exists on
  TikTok LIVE; talent agencies are an off-platform relationship.
- **B. XNAKView implementation:** `Team`/`TeamMember` (roles OWNER/MANAGER/
  MEMBER)/`TeamInvite`/`TeamTarget`/`TeamActivityEntry`, fully original.
  A user may hold at most one ACTIVE team membership at a time (disclosed
  rule, keeps aggregate team activity meaningful). Every privileged action
  (invite, remove, role change, target creation, disband, ownership
  transfer) is authorized server-side by `requireActiveRole`/explicit owner
  checks in `lib/gamification/teams.ts`, never by the mobile client, and is
  written to `GamificationAuditLog`.
- **C. Differences:** N/A — original feature, disclosed as such everywhere.
- **D. XNAKView-specific rules:** Only the OWNER can remove/demote a MANAGER
  or transfer ownership; a MANAGER can invite/remove plain MEMBERs; an OWNER
  cannot leave without transferring ownership or disbanding first.
- **E. Anti-abuse:** **Recruitment alone awards nothing** — `inviteMember`/
  `respondToInvite` never call `recordXP` or touch any ledger. Only real
  platform activity (`logTeamActivity`, called from the LIVE-end and
  Gift-received hooks in `events.ts`) ever advances a `TeamTarget` or a team
  leaderboard score. A fraud-held contributor's activity is still recorded
  (`TeamActivityEntry.excludedAsFraud`) for audit but never counted toward a
  target or shown in the public activity feed.
- **F. Admin configuration:** Team *settings* (name/description/avatar,
  targets) are owner/manager-configurable per team by design — no
  platform-wide "team settings" exists to configure beyond that, matching
  the brief's "configurable by admin/team owner where appropriate."
- **G. Backend tests:** creation + single-active-membership limit, invite/
  accept/decline, role-based invite authorization (member blocked, promoted
  manager allowed), owner-only manager removal, leave vs. owner-must-
  transfer-first, ownership transfer, target creation → progress → auto-
  completion → leadership notification, fraud-excluded activity never
  counted, and a team leaderboard ranked from real aggregated activity
  (`teams.test.ts`, 9 tests, all real HTTP against the live backend).
- **H. Mobile tests:** `TeamsRepository` create/role-change/target-progress
  parsing (`teams_repository_test.dart`); UI: `MyTeamsScreen` (create/join
  entry point + received invites), `TeamHomeScreen` (Members/Activity/
  Targets/Ranking tabs, role-gated invite/settings actions).
- **I. Admin status:** Backend only.
- **J. Remaining limitations:** No admin-side team oversight/suspension UI
  yet (an admin can still act via the existing Trust & Safety
  FraudHold/EnforcementAction tools, which `logTeamActivity` already
  respects); the mobile "invite" flow takes a raw user id rather than a
  people-search picker (no team-scoped user search endpoint exists yet).

### 5. Badges & Achievements

- **A. TikTok behavior verified:** A real, disclosed verification badge
  (not follower-count-based); no general badge/achievement catalog for
  regular accounts is documented.
- **B. XNAKView implementation:** Admin-managed catalogs (`Badge`,
  `Achievement`, both mutable rows — same posture as the `Gift` catalog),
  each with a `criteriaKey` mapped to exactly one registered evaluator in
  `lib/gamification/badgeRules.ts`/`achievementRules.ts`. A catalog row
  whose `criteriaKey` has no registered evaluator is **inert** (never
  auto-awarded) — verified by test — so an admin can never accidentally
  invent a badge the server doesn't know how to earn. Evaluation is
  event-driven: `checkAndAwardBadges`/`checkAndUnlockAchievements` only run
  the evaluators relevant to what just happened, never a full-catalog scan.
  Achievement unlocks can carry an XP reward, applied via the same
  `recordXP` ledger (never a separate, untracked bonus).
- **C. Differences:** N/A — XNAKView's own catalog, seeded example criteria
  keys: `FIRST_LIVE_HOSTED`, `FOLLOWERS_100`/`FOLLOWERS_1000`,
  `FIRST_GIFT_RECEIVED`, `LIVE_HOST_10_SESSIONS`, `TEAM_MEMBER`/
  `TEAM_LEADER`, `CONSISTENCY_7_DAY_STREAK` (badges); `FIRST_POST`,
  `FIRST_LIVE`, `FIRST_FOLLOWER_MILESTONE`, `FIRST_GIFT_SENT`/
  `FIRST_GIFT_RECEIVED`, `FIRST_TEAM_MEMBERSHIP`,
  `LIVE_MILESTONE_10_SESSIONS`, `CREATOR_MILESTONE_1000_DIAMONDS`
  (achievements).
- **D. XNAKView-specific rules:** Achievement `xpReward` is admin-set per
  achievement; badges carry no XP (prestige-only markers).
- **E. Anti-abuse:** Every evaluator reads real, already-committed data
  (follower counts, real Gift/LIVE-session rows) — never a client-asserted
  claim; a duplicate award attempt is a harmless no-op via the
  `(userId, badgeId)`/`(userId, achievementId)` unique constraint.
- **F. Admin configuration:** Full CRUD (`POST`/`PATCH
  /admin/gamification/badges` and `/achievements`), every create/update
  audit-logged.
- **G. Backend tests:** an unregistered `criteriaKey` never awards anything
  (both badges and achievements); a real Gift flow unlocking
  `first-gift-received` (badge) and `first-gift-sent` (achievement, with its
  XP reward landing in the User XP ledger) (`gamification.test.ts`).
- **H. Mobile tests:** covered via the repository/model layer; UI:
  `BadgesScreen` (earned-only grid) and `AchievementsScreen` (progress +
  unlock state).
- **I. Admin status:** Backend only.
- **J. Remaining limitations:** No locked/"not yet earned" badges shown in
  the mobile Badges screen (earned-only, by design — avoids implying a
  fixed, guessable target list); no admin UI to browse the catalog visually
  (API only).

### 6. Leaderboards

- **A. TikTok behavior verified:** Daily Diamond ranking, weekly Creator
  League, in-stream Top Gifter list, Fan Club "Popular" ranking — all real,
  formula undisclosed.
- **B. XNAKView implementation:** Precomputed `LeaderboardSnapshot` +
  `LeaderboardEntry` rows (never a live full-table scan on every read) for
  five types (`CREATOR_DIAMONDS`, `LIVE_HOURS`, `GIFT_SENDERS`,
  `FAN_CLUB_XP`, `TEAM_PERFORMANCE`) across four periods
  (`DAILY`/`WEEKLY`/`MONTHLY`/`ALL_TIME`), deterministically ranked by real
  ledger/event aggregates. A snapshot recomputes lazily once stale (>15 min)
  on read, or on-demand via an admin endpoint — this codebase has no
  background job runner (a disclosed limitation shared with video
  processing, see `docs/ARCHITECTURE.md` §6), so this mirrors that existing,
  accepted posture rather than inventing a cron system.
- **C. Differences:** No in-stream "live" ranking overlay during an active
  LIVE broadcast yet (see limitations).
- **D. XNAKView-specific rules:** `TEAM_PERFORMANCE` score = LIVE minutes +
  `floor(giftCoins / 10)`, a disclosed, simple points formula (never claimed
  as TikTok's).
- **E. Anti-abuse:** Every non-team leaderboard excludes any subject
  currently fraud-held or with a recent risk score at/above
  `LEADERBOARD_SETTINGS.riskScoreExclusionThreshold` — verified by test
  (a sender placed on a `FraudHold` disappears from the `GIFT_SENDERS`
  leaderboard on the next recompute). Team-leaderboard inputs are already
  filtered at the source (`TeamActivityEntry.excludedAsFraud`).
- **F. Admin configuration:** `LEADERBOARD_SETTINGS` (risk-score threshold,
  lookback window) via config; `POST
  /admin/gamification/leaderboards/recompute` to force a refresh.
- **G. Backend tests:** ranks real Gift-sender data, admin-only recompute
  authorization, and fraud-hold exclusion taking effect on the next
  recompute (`gamification.test.ts`); team ranking from real aggregated
  activity (`teams.test.ts`).
- **H. Mobile tests:** enum→API-value mapping (`gamification_repository_test.dart`);
  UI: `LeaderboardScreen` (type chips × period tabs) and the Team Ranking tab.
- **I. Admin status:** Backend only (recompute trigger has no UI button yet).
- **J. Remaining limitations:** Leaderboard rows show a raw account/team id,
  not a resolved display name/avatar (no batch profile-lookup was added to
  this endpoint) — a disclosed, cosmetic follow-up, not a data-integrity gap.

### 7. Gamification notifications & the event pipeline

- **B. XNAKView implementation:** `lib/gamification/events.ts` is the single
  centralized pipeline every producer calls into (`onFollowCreated`,
  `onContentPublished`, `onLiveSessionStarted/Ended`, `onLiveWatchSession`,
  `onGiftTransaction`) — each wraps its real work in a `safely()` helper that
  logs and swallows any error, so a gamification bug can **never** surface
  as a failure of the follow/gift/LIVE action that triggered it, and never
  duplicates a financial ledger write (it only fires after the caller's own
  transaction has already fully committed). `GamificationNotification` is a
  dedicated model (deliberately separate from the existing
  `ActivityNotification`, which requires a distinct human actor and doesn't
  fit a system-generated "you leveled up" event) with the same durable-row +
  best-effort-realtime-push posture as the rest of the app.
- **G. Backend tests:** notification creation is exercised indirectly
  through every level-up/badge/achievement/team-target test above; a
  dedicated read/mark-read test was not written separately (low-risk,
  thin CRUD over an already-tested write path).
- **I. Admin status:** N/A (user-facing only).

---

## Backend tests

`npx vitest run` — **442 / 442 passing**, 24 test files, zero regressions
introduced. 23 of those tests are new for this step:
`routes/v1/__tests__/gamification.test.ts` (14) and
`routes/v1/__tests__/teams.test.ts` (9), both real integration tests against
the live Postgres/Redis/LiveKit stack (no mocks), matching this codebase's
established testing philosophy for anything ledger/economy-adjacent.

`npx tsc --noEmit` — clean. `npx eslint src` — clean.

## Mobile tests

`flutter test` — **69 / 69 passing**, zero regressions; 8 new tests in
`test/features/gamification/` (`gamification_repository_test.dart`,
`teams_repository_test.dart`), covering progress-bar math (including the
max-level divide-by-zero guard), Fan Club existence/membership shape, and
that every outgoing request uses the server's own enum strings rather than a
Dart enum name.

`flutter analyze` — 0 issues in any file this step touched (the 3
pre-existing `info`-level issues in `features/safety/` predate this step and
are unrelated to it).

## Prisma migrations

One new migration, `20260908010000_step11_gamification_levels_teams`,
adding 16 enums and 20 models (see `prisma/schema.prisma`'s Step 11 block).
Applied cleanly to the local dev database and verified via
`npx prisma migrate status` ("Database schema is up to date").

**Disclosed, pre-existing issue found (not introduced by this step):** the
migration history's shadow-database replay fails at an older migration
(`20260906133145_remove_dating_matching`, `P1014` — "the underlying table
for model `dating_decisions` does not exist") from a prior step's squash/
edit. This step's own migration was generated as a direct schema diff
against the real dev database (verified to match `schema.prisma` exactly)
and applied + recorded via `prisma migrate resolve --applied` to avoid
touching that unrelated, pre-existing history problem. A future step should
repair the full migration chain (e.g. `prisma migrate diff` a fresh baseline)
so `prisma migrate dev` works end-to-end again from scratch.

## Admin UI

No dedicated Next.js admin page was added for Step 11, matching this
codebase's own established precedent: Steps 7–10 (Coins/Gifts/Diamonds,
Monetization, Payouts, Trust & Safety) likewise shipped a complete backend
admin API with **no** corresponding admin UI page — the admin sidebar
(`admin/src/components/sidebar.tsx`) still lists only Dashboard/Videos/
Reports/LIVE/LIVE Reports, with an explicit comment that further sections
"mount here as their domains ship." Building a gamification-only admin page
while four higher-priority economic/safety domains still have none would be
an inconsistent, cosmetic use of effort; the backend admin API
(`/admin/gamification/*`) is complete, tested, and ready for whenever admin
UI work resumes across all of these domains together.

## Full regression

- Backend: `npx tsc --noEmit` clean · `npx eslint src` clean ·
  `npx vitest run` 442/442 passing.
- Mobile: `flutter analyze` clean (only 3 pre-existing, unrelated infos) ·
  `flutter test` 69/69 passing.
- Admin: unchanged this step (no code touched) — not re-run.
- Prisma: migration applied and verified against the real dev database.
