import type { Server as HttpServer } from 'http';

import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server as SocketIOServer, type Socket } from 'socket.io';

import { corsOrigins, env, isTest } from '@/config/env';
import { resolveAuth } from '@/middleware/auth';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

/**
 * The real-time transport, abstracted behind a small set of functions
 * (`emitToUser`, `emitToConversation`, `isOnline`) rather than callers
 * reaching for a Socket.IO server directly — the same shape as
 * `LiveStreamingProvider` in Step 4. Socket.IO (with a Redis adapter for
 * cross-instance pub/sub) is the only implementation today; swapping
 * transports later means reimplementing this module, not touching routes.
 *
 * Messages/calls are never *created* over the socket — the REST endpoints
 * (routes/v1/messages.ts, routes/v1/calls.ts) are the only place data is
 * written, and they call into this module afterwards to notify. That is
 * what makes duplicate delivery harmless: a client that receives the same
 * `message:new` event twice (a reconnect racing a fresh emit, say) is just
 * re-rendering a message it already has by id — nothing is re-created,
 * because creation only ever happened once, in the database, guarded by
 * `Message`'s `[conversationId, senderId, clientMessageId]` unique
 * constraint.
 */

const PRESENCE_TTL_SECONDS = 75;
const PRESENCE_REFRESH_MS = 25_000;
const CONNECTION_ATTEMPTS_PER_MINUTE = 30;
const TYPING_EVENT_MIN_INTERVAL_MS = 2000;

let io: SocketIOServer | null = null;
/** Per-process socket count per user — used only to detect "this process's last socket for this user closed," not as the source of truth for presence (Redis is). */
const localSocketCounts = new Map<string, number>();
const presenceTimers = new Map<string, ReturnType<typeof setInterval>>();
const lastTypingEmitAt = new Map<string, number>();

function presenceKey(userId: string): string {
  return `presence:online:${userId}`;
}

export async function isOnline(userId: string): Promise<boolean> {
  const value = await redis.get(presenceKey(userId));
  return value !== null;
}

/** Conversation partners this user should be allowed to see presence/typing events from — ACCEPTED conversations, minus any blocked-either-direction relationship. */
async function findVisibleContactIds(userId: string): Promise<string[]> {
  const conversations = await prisma.conversation.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ participantOneId: userId }, { participantTwoId: userId }],
    },
    select: { participantOneId: true, participantTwoId: true },
  });
  const partnerIds = conversations.map((c) => (c.participantOneId === userId ? c.participantTwoId : c.participantOneId));
  if (partnerIds.length === 0) return [];

  const blocks = await prisma.userBlock.findMany({
    where: {
      OR: [
        { blockerId: userId, blockedId: { in: partnerIds } },
        { blockedId: userId, blockerId: { in: partnerIds } },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  const blockedIds = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== userId));

  return partnerIds.filter((id) => !blockedIds.has(id));
}

async function broadcastPresence(userId: string, online: boolean): Promise<void> {
  try {
    const settings = await prisma.messagingPrivacySettings.findUnique({ where: { userId } });
    if (settings && settings.showActivityStatus === false) return;

    const contactIds = await findVisibleContactIds(userId);
    if (contactIds.length === 0) return;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastActiveAt: true } });
    for (const contactId of contactIds) {
      emitToUser(contactId, 'presence:update', { userId, online, lastActiveAt: user?.lastActiveAt ?? null });
    }
  } catch (error) {
    logger.error({ err: error, userId }, 'Failed to broadcast presence update');
  }
}

async function handleConnect(socket: Socket, userId: string): Promise<void> {
  await socket.join(`user:${userId}`);

  const count = (localSocketCounts.get(userId) ?? 0) + 1;
  localSocketCounts.set(userId, count);

  await redis.set(presenceKey(userId), '1', 'EX', PRESENCE_TTL_SECONDS);
  if (count === 1) {
    if (!presenceTimers.has(userId)) {
      presenceTimers.set(
        userId,
        setInterval(() => {
          void redis.set(presenceKey(userId), '1', 'EX', PRESENCE_TTL_SECONDS);
        }, PRESENCE_REFRESH_MS),
      );
    }
    void broadcastPresence(userId, true);
  }
}

async function handleDisconnect(userId: string): Promise<void> {
  const count = Math.max(0, (localSocketCounts.get(userId) ?? 1) - 1);
  if (count === 0) {
    localSocketCounts.delete(userId);
    const timer = presenceTimers.get(userId);
    if (timer) {
      clearInterval(timer);
      presenceTimers.delete(userId);
    }
    await redis.del(presenceKey(userId));
    await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } }).catch(() => {});
    void broadcastPresence(userId, false);
  } else {
    localSocketCounts.set(userId, count);
  }
}

/** A socket may only join a conversation's room if it's genuinely a participant — checked fresh on every join, not cached from the handshake. */
async function canJoinConversation(userId: string, conversationId: string): Promise<boolean> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { participantOneId: true, participantTwoId: true },
  });
  if (!conversation) return false;
  return conversation.participantOneId === userId || conversation.participantTwoId === userId;
}

/** Any authenticated user may join a currently-LIVE session's room to receive real-time Gift events — same "anyone can view" posture as LIVE itself. */
async function canJoinLiveSession(liveSessionId: string): Promise<boolean> {
  const session = await prisma.liveSession.findUnique({ where: { id: liveSessionId }, select: { status: true } });
  return session?.status === 'LIVE';
}

export function initRealtime(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    // Defaults (25s ping interval / 20s ping timeout) already give us a real
    // heartbeat + dead-connection detection; not overridden here.
  });

  if (env.NODE_ENV !== 'test') {
    const pubClient = new Redis(env.REDIS_URL);
    const subClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
  }

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    resolveAuth(token)
      .then(async ({ user }) => {
        // Connection-attempt rate limit — the same Redis INCR+EXPIRE shape
        // createAuthRateLimiter uses for HTTP, applied here because Express
        // rate-limit middleware never sees a WebSocket upgrade. Caps
        // reconnect-storm / connection-flood abuse per account.
        if (!isTest) {
          const key = `ratelimit:socket-connect:${user.id}`;
          const count = await redis.incr(key);
          if (count === 1) await redis.expire(key, 60);
          if (count > CONNECTION_ATTEMPTS_PER_MINUTE) {
            next(new Error('RATE_LIMITED'));
            return;
          }
        }
        socket.data.userId = user.id;
        next();
      })
      .catch(() => next(new Error('UNAUTHORIZED')));
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    void handleConnect(socket, userId);

    socket.on('conversation:join', (conversationId: unknown) => {
      if (typeof conversationId !== 'string') return;
      void canJoinConversation(userId, conversationId).then((allowed) => {
        if (allowed) void socket.join(`conversation:${conversationId}`);
      });
    });

    socket.on('conversation:leave', (conversationId: unknown) => {
      if (typeof conversationId !== 'string') return;
      void socket.leave(`conversation:${conversationId}`);
    });

    socket.on('conversation:typing', (payload: unknown) => {
      const conversationId = (payload as { conversationId?: unknown })?.conversationId;
      if (typeof conversationId !== 'string') return;

      // Server-side throttle, not just a client-side courtesy: a modified
      // client could otherwise flood a conversation room with events.
      const throttleKey = `${userId}:${conversationId}`;
      const now = Date.now();
      const lastEmit = lastTypingEmitAt.get(throttleKey) ?? 0;
      if (now - lastEmit < TYPING_EVENT_MIN_INTERVAL_MS) return;
      lastTypingEmitAt.set(throttleKey, now);

      void canJoinConversation(userId, conversationId).then((allowed) => {
        if (!allowed) return;
        socket.to(`conversation:${conversationId}`).emit('conversation:typing', { conversationId, userId });
      });
    });

    socket.on('live:join', (liveSessionId: unknown) => {
      if (typeof liveSessionId !== 'string') return;
      void canJoinLiveSession(liveSessionId).then((allowed) => {
        if (allowed) void socket.join(`live:${liveSessionId}`);
      });
    });

    socket.on('live:leave', (liveSessionId: unknown) => {
      if (typeof liveSessionId !== 'string') return;
      void socket.leave(`live:${liveSessionId}`);
    });

    socket.on('disconnect', () => {
      void handleDisconnect(userId);
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Realtime gateway not initialized — call initRealtime() first');
  }
  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!io) return; // realtime is additive — never block a REST response on it being up
  io.to(`user:${userId}`).emit(event, payload);
}

export function emitToConversation(conversationId: string, event: string, payload: unknown): void {
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit(event, payload);
}

/** Broadcasts a real-time event (e.g. a Gift) to every socket currently in a LIVE session's room — never includes private wallet/payment data, only what brief §8 allows (sender, Gift, quantity, animation metadata). */
export function emitToLiveSession(liveSessionId: string, event: string, payload: unknown): void {
  if (!io) return;
  io.to(`live:${liveSessionId}`).emit(event, payload);
}
