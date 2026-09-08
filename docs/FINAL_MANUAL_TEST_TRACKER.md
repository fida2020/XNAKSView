# XNAKView — Final Manual Test Tracker

Build under test: **XNAKView FINAL-MANUAL-TEST BUILD** (debug APK, not production
signed). Built from `mobile/`, `flutter build apk --debug`, pointed at a LAN
backend for physical-device testing. Not final; not production-ready until
explicitly approved.

Status legend: `NOT YET APPROVED` (default) → `IN PROGRESS` → `FIXED —
AWAITING RETEST` → `USER APPROVED`. Only the user may set `USER APPROVED`.

| Feature | Status | Issue | Fix | Retested | User approval |
|---|---|---|---|---|---|
| Signup / email / OTP | NOT YET APPROVED | | | | |
| Login / logout | NOT YET APPROVED | | | | |
| 18+ enforcement | NOT YET APPROVED | | | | |
| Google / Facebook sign-in | FIXED — AWAITING RETEST | Google sign-up failed: the installed test APK was built without `--dart-define=GOOGLE_OAUTH_SERVER_CLIENT_ID=...`, so `AppConfig.googleServerClientId` was empty and `GoogleSignIn(serverClientId: '')` could never produce a backend-verifiable ID token. Backend's `GOOGLE_OAUTH_SERVER_CLIENT_ID` was already correctly configured — only the mobile build flag was missing. | Rebuilt+reinstalled the debug APK with the server client ID passed in. If it still fails after retest, the debug keystore's SHA-1 (`C3:AB:E0:D6:E9:1B:EA:5A:38:10:82:28:7D:5D:B2:37:64:9B:F0:25`) needs to be registered against an Android OAuth client for `com.balochsahab.xnakview` in Google Cloud Console — that's a console-side config only the project owner can check, not a code fix. | Awaiting user retest | |
| Account restrictions | NOT YET APPROVED | | | | |
| Profile setup (avatar/bio/username) | NOT YET APPROVED | | | | |
| Home — For You | NOT YET APPROVED | | | | |
| Home — Following | NOT YET APPROVED | | | | |
| Video playback | NOT YET APPROVED | | | | |
| Like / comment / reply | NOT YET APPROVED | | | | |
| Share / repost / favorite | NOT YET APPROVED | | | | |
| Follow / unfollow | NOT YET APPROVED | | | | |
| Search / hashtags / mentions / sounds | NOT YET APPROVED | | | | |
| Create — video upload | NOT YET APPROVED | | | | |
| Create — Duet | NOT YET APPROVED | | | | |
| Create — Stitch | NOT YET APPROVED | | | | |
| Create — photo post | NOT YET APPROVED | | | | |
| Create — text post | NOT YET APPROVED | | | | |
| Stories — create/view/reply/report | NOT YET APPROVED | | | | |
| Profile — followers/following/videos | NOT YET APPROVED | | | | |
| Profile — playlists | NOT YET APPROVED | | | | |
| Profile — Level / Badges / Achievements | NOT YET APPROVED | | | | |
| Profile — Team (home/members/activity/targets/ranking) | NOT YET APPROVED | | | | |
| Inbox — Activity | NOT YET APPROVED | | | | |
| Chat — text messages | NOT YET APPROVED | | | | |
| Chat — voice message | NOT YET APPROVED | | | | |
| Chat — delivered/read, typing/presence | NOT YET APPROVED | | | | |
| Chat — block/report/unsend/mute/pin | NOT YET APPROVED | | | | |
| Voice call — initiate/accept/decline/end | NOT YET APPROVED | | | | |
| Call history | NOT YET APPROVED | | | | |
| LIVE — go LIVE (title/category/thumbnail) | NOT YET APPROVED | | | | |
| LIVE — camera/mic/flip | NOT YET APPROVED | | | | |
| LIVE — viewer join, chat, viewer count | NOT YET APPROVED | | | | |
| LIVE — guests / multi-guest / co-host | NOT YET APPROVED | | | | |
| LIVE — Match/Battle (SOLO/TEAM) | NOT YET APPROVED | | | | |
| LIVE — moderator/mute/block/report | NOT YET APPROVED | | | | |
| LIVE — Gifts + host/guest attribution | NOT YET APPROVED | | | | |
| LIVE — Fan Club | NOT YET APPROVED | | | | |
| LIVE — ending / replay | NOT YET APPROVED | | | | |
| Coins — balance / buy / packages / history | NOT YET APPROVED | | | | |
| Gifts — catalog / send / self-gift block / daily limit | NOT YET APPROVED | | | | |
| Diamonds — balance / LIVE rewards | NOT YET APPROVED | | | | |
| Creator Studio — earnings / monetization status | NOT YET APPROVED | | | | |
| Withdraw — bank account / KYC / history | NOT YET APPROVED | | | | |
| Leaderboards — daily/weekly/monthly/all-time | NOT YET APPROVED | | | | |
| Safety — report video/comment/account/LIVE | NOT YET APPROVED | | | | |
| Safety — Account Status / appeals | NOT YET APPROVED | | | | |
| Settings — privacy / blocked accounts | NOT YET APPROVED | | | | |
| Settings — logout / account deletion | NOT YET APPROVED | | | | |

## How this tracker is used

1. User tests a feature on the physical device and reports what's wrong.
2. Claude identifies the exact feature/file, fixes it, runs the relevant
   regression tests (backend `vitest`, mobile `flutter test`/`analyze`), and
   updates this row's Issue/Fix/Retested columns.
3. Status only moves to `USER APPROVED` when the user says so explicitly.
4. No unrelated functionality is changed while working through a reported
   issue.
