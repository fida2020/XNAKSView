import { afterAll, beforeAll } from 'vitest';

import { connectDatabase, disconnectDatabase, prisma } from '@/lib/prisma';
import { connectRedis, disconnectRedis, redis } from '@/lib/redis';

import { parseDatabaseName } from './dbGuard';

beforeAll(async () => {
  await connectDatabase();
  await connectRedis();

  // Layer 2 safety guard (layer 1 is env.setup.ts, which runs before this
  // file's imports resolve at all). Re-verify, using the LIVE connection
  // itself, that we are actually talking to the dedicated test database
  // before running the destructive TRUNCATE below — never trust
  // process.env alone twice. Aborts loudly instead of truncating if this
  // is ever wrong (e.g. env.setup.ts was skipped, or someone edited
  // vitest.config.ts's setupFiles order).
  const expectedTestDbName = parseDatabaseName(process.env.DATABASE_URL);
  const devDbName = parseDatabaseName(process.env.DEV_DATABASE_URL_SNAPSHOT);
  const [{ current_database: actualDbName } = { current_database: undefined }] = await prisma.$queryRawUnsafe<
    { current_database: string }[]
  >('SELECT current_database()');

  const isVerifiedTestDb =
    !!expectedTestDbName &&
    expectedTestDbName.toLowerCase().includes('test') &&
    actualDbName === expectedTestDbName &&
    (!devDbName || actualDbName !== devDbName);

  if (!isVerifiedTestDb) {
    throw new Error(
      `Refusing to run destructive tests: the live database connection ("${actualDbName ?? 'unknown'}") is not a ` +
        'verified test database. TEST_DATABASE_URL is required. Refusing to run destructive tests against DATABASE_URL.',
    );
  }

  // Start each test run from a clean slate against the dedicated TEST
  // database/Redis ONLY — never the shared dev database, verified above.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
      call_reports, calls,
      message_reports, message_receipts, messages, conversation_reports,
      conversation_participants, conversations, user_blocks, messaging_privacy_settings,
      live_subscriptions, live_matches, live_guest_slots, live_blocked_words,
      live_viewer_restrictions, live_moderators, live_event_reminders, live_events,
      live_chat_message_reports, live_viewer_reports, live_reports, live_chat_messages,
      live_viewers, live_sessions,
      creator_playlist_items, creator_playlists, recent_searches, activity_notifications,
      favorites, reposts,
      story_reports, story_replies, story_views, stories,
      text_post_reports, text_post_comments, text_post_likes, text_post_hashtags, text_posts,
      photo_post_reports, photo_post_comments, photo_post_likes, photo_post_hashtags, photo_post_assets, photo_posts,
      sounds,
      mentions, video_hashtags, hashtags,
      video_comment_reports, video_comment_likes,
      video_reports, video_views, video_comments, video_likes, videos, follows,
      sessions, devices, verifications, profiles, users
     RESTART IDENTITY CASCADE`,
  );
  await redis.flushdb();
});

afterAll(async () => {
  await disconnectDatabase();
  await disconnectRedis();
});
