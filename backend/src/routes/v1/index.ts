import { Router } from 'express';

import { healthRouter } from '@/routes/v1/health';
import { authRouter } from '@/routes/v1/auth';
import { oauthRouter } from '@/routes/v1/oauth';
import { meRouter } from '@/routes/v1/me';
import { profileRouter } from '@/routes/v1/profile';
import { videosRouter } from '@/routes/v1/videos';
import { feedRouter } from '@/routes/v1/feed';
import { followRouter } from '@/routes/v1/follow';
import { hashtagsRouter } from '@/routes/v1/hashtags';
import { searchRouter } from '@/routes/v1/search';
import { activityRouter } from '@/routes/v1/activity';
import { playlistsRouter } from '@/routes/v1/playlists';
import { photoPostsRouter } from '@/routes/v1/photoPosts';
import { textPostsRouter } from '@/routes/v1/textPosts';
import { storiesRouter } from '@/routes/v1/stories';
import { soundsRouter } from '@/routes/v1/sounds';
import { epidemicSoundsRouter } from '@/routes/v1/epidemicSounds';
import { liveEventsRouter } from '@/routes/v1/liveEvents';
import { liveGuestsRouter } from '@/routes/v1/liveGuests';
import { liveMatchesRouter } from '@/routes/v1/liveMatches';
import { liveRouter } from '@/routes/v1/live';
import { blocksRouter } from '@/routes/v1/blocks';
import { messagingSettingsRouter } from '@/routes/v1/messagingSettings';
import { conversationsRouter } from '@/routes/v1/conversations';
import { messagesRouter } from '@/routes/v1/messages';
import { callsRouter } from '@/routes/v1/calls';
import { coinsRouter } from '@/routes/v1/coins';
import { giftsRouter } from '@/routes/v1/gifts';
import { creatorRouter } from '@/routes/v1/creator';
import { payoutMethodsRouter } from '@/routes/v1/payoutMethods';
import { identityVerificationRouter } from '@/routes/v1/identityVerification';
import { payoutWebhooksRouter } from '@/routes/v1/payoutWebhooks';
import { adminRouter } from '@/routes/v1/admin';
import { adminEconomyRouter } from '@/routes/v1/adminEconomy';
import { adminMonetizationRouter } from '@/routes/v1/adminMonetization';
import { monetizationRouter } from '@/routes/v1/monetization';
import { safetyReportsRouter } from '@/routes/v1/safetyReports';
import { accountStatusRouter } from '@/routes/v1/accountStatus';
import { appealsRouter } from '@/routes/v1/appeals';
import { adminTrustSafetyRouter } from '@/routes/v1/adminTrustSafety';
import { gamificationRouter } from '@/routes/v1/gamification';
import { teamsRouter } from '@/routes/v1/teams';
import { adminGamificationRouter } from '@/routes/v1/adminGamification';

export const v1Router = Router();

v1Router.use(healthRouter);
v1Router.use(authRouter);
v1Router.use(oauthRouter);
v1Router.use(meRouter);
v1Router.use(profileRouter);
v1Router.use(videosRouter);
v1Router.use(feedRouter);
v1Router.use(followRouter);
// Step 6 TikTok-parity social + creation features.
v1Router.use(hashtagsRouter);
v1Router.use(searchRouter);
v1Router.use(activityRouter);
v1Router.use(playlistsRouter);
v1Router.use(photoPostsRouter);
v1Router.use(textPostsRouter);
v1Router.use(storiesRouter);
v1Router.use(soundsRouter);
v1Router.use(epidemicSoundsRouter);
// More specific /live/* paths (events, matches) must be registered before
// liveRouter's `GET /live/:id` — otherwise `:id` would greedily swallow
// literal segments like "events" or "matches".
v1Router.use(liveEventsRouter);
v1Router.use(liveGuestsRouter);
v1Router.use(liveMatchesRouter);
v1Router.use(liveRouter);
// Step 5 chat + calls. `/me/...` and `/users/:id/...` (block/presence) paths
// are deliberately shaped to never collide with followRouter's `/users/:id`
// regardless of mount order — see routes/v1/blocks.ts.
v1Router.use(blocksRouter);
v1Router.use(messagingSettingsRouter);
v1Router.use(conversationsRouter);
v1Router.use(messagesRouter);
v1Router.use(callsRouter);
// Step 7: Coins, Gifts, Diamonds & creator monetization foundation.
v1Router.use(coinsRouter);
v1Router.use(giftsRouter);
v1Router.use(creatorRouter);
// Step 9: automated global creator payouts — payoutMethodsRouter/
// identityVerificationRouter (per-route requireAuth, same as creatorRouter)
// and the public, signature-verified payoutWebhooksRouter must all be
// mounted before adminRouter/adminEconomyRouter for the same blanket-
// requireAdmin-via-bare-.use() reason documented below.
v1Router.use(payoutMethodsRouter);
v1Router.use(identityVerificationRouter);
v1Router.use(payoutWebhooksRouter);
// monetizationRouter (creator-facing + the public ad-revenue webhook) and
// adminMonetizationRouter MUST both be mounted before adminRouter/
// adminEconomyRouter — those two apply `requireAuth`/`requireAdmin` via
// `.use()` with no path, which (an Express gotcha) runs for ANY request
// that reaches that router, not just requests matching one of its own
// routes. Mounted first, they would silently reject every request bound
// for a router mounted later that doesn't happen to match anything in
// them first — exactly what happened here in testing (401s on paths that
// don't even exist in adminRouter/adminEconomyRouter). Order between
// monetizationRouter and adminMonetizationRouter matters too, for the same
// reason: the public webhook must reach monetizationRouter before
// adminMonetizationRouter's blanket admin check ever sees it.
v1Router.use(monetizationRouter);
// Step 10 — Trust & Safety. safetyReportsRouter/accountStatusRouter/
// appealsRouter apply requireAuth per-route (same as payoutMethodsRouter
// above), so order relative to them doesn't matter. adminTrustSafetyRouter
// applies requireAuth/requireAdmin via a blanket `.use()` like
// adminRouter/adminEconomyRouter below — see this file's own comment on
// why that means it MUST be mounted last, after every other router.
v1Router.use(safetyReportsRouter);
v1Router.use(accountStatusRouter);
v1Router.use(appealsRouter);
// Step 11 — Levels, Teams & Gamification. gamificationRouter/teamsRouter
// apply requireAuth per-route (same as payoutMethodsRouter above), so order
// relative to them doesn't matter. adminGamificationRouter applies
// requireAuth/requireAdmin via a blanket `.use()` like adminRouter/
// adminEconomyRouter/adminTrustSafetyRouter — same "must be mounted last"
// reason documented above.
v1Router.use(gamificationRouter);
v1Router.use(teamsRouter);
v1Router.use(adminMonetizationRouter);
v1Router.use(adminRouter);
v1Router.use(adminEconomyRouter);
v1Router.use(adminTrustSafetyRouter);
v1Router.use(adminGamificationRouter);
