import { afterAll, beforeAll } from 'vitest';

import { connectDatabase, disconnectDatabase, prisma } from '@/lib/prisma';
import { connectRedis, disconnectRedis, redis } from '@/lib/redis';

beforeAll(async () => {
  await connectDatabase();
  await connectRedis();
  // Start each test run from a clean slate against the real dev database/Redis.
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
