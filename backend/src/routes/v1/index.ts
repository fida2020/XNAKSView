import { Router } from 'express';

import { healthRouter } from '@/routes/v1/health';
import { authRouter } from '@/routes/v1/auth';
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
import { liveEventsRouter } from '@/routes/v1/liveEvents';
import { liveGuestsRouter } from '@/routes/v1/liveGuests';
import { liveMatchesRouter } from '@/routes/v1/liveMatches';
import { liveRouter } from '@/routes/v1/live';
import { blocksRouter } from '@/routes/v1/blocks';
import { messagingSettingsRouter } from '@/routes/v1/messagingSettings';
import { conversationsRouter } from '@/routes/v1/conversations';
import { messagesRouter } from '@/routes/v1/messages';
import { callsRouter } from '@/routes/v1/calls';
import { adminRouter } from '@/routes/v1/admin';

export const v1Router = Router();

v1Router.use(healthRouter);
v1Router.use(authRouter);
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
v1Router.use(adminRouter);
