import { afterAll, beforeAll } from 'vitest';

import { connectDatabase, disconnectDatabase, prisma } from '@/lib/prisma';
import { connectRedis, disconnectRedis, redis } from '@/lib/redis';

beforeAll(async () => {
  await connectDatabase();
  await connectRedis();
  // Start each test run from a clean slate against the real dev database/Redis.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
      live_subscriptions, live_matches, live_guest_slots, live_blocked_words,
      live_viewer_restrictions, live_moderators, live_event_reminders, live_events,
      live_chat_message_reports, live_viewer_reports, live_reports, live_chat_messages,
      live_viewers, live_sessions,
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
