import { unlink } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { onLiveSessionEnded, onLiveSessionStarted, onLiveWatchSession } from '@/lib/gamification/events';
import { probeImage } from '@/lib/imageValidation';
import { checkLiveEligibility } from '@/lib/liveEligibility';
import { emitToLiveSession } from '@/lib/realtime';
import { assertModerationAllowsCreation, moderateText } from '@/lib/moderation/moderationPipeline';
import { liveRoomName, liveStreamingProvider } from '@/lib/liveStreaming';
import { serializeLiveSession } from '@/lib/liveAccess';
import {
  canModerate,
  containsBlockedWord,
  isUserBlockedFromSession,
  isUserMutedInSession,
} from '@/lib/liveModeration';
import { streamAsset } from '@/lib/mediaStreaming';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { liveThumbnailKey, storage } from '@/lib/storage';
import { fetchAuthorSummaries } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { uploadSingleImage } from '@/middleware/upload';
import { validate } from '@/middleware/validate';
import {
  assignModeratorSchema,
  liveChatMessageSchema,
  liveReactionSchema,
  listLiveChatQuerySchema,
  listLiveQuerySchema,
  reportLiveChatMessageSchema,
  reportLiveSchema,
  reportLiveViewerSchema,
  restrictViewerSchema,
  startLiveSchema,
} from '@/schemas/live.schema';
import { AppError } from '@/utils/AppError';

export const liveRouter = Router();

const startLimiter = createAuthRateLimiter(60 * 60 * 1000, 5, 'live-start');
const joinLeaveLimiter = createAuthRateLimiter(60 * 1000, 60, 'live-join-leave');
const chatLimiter = createAuthRateLimiter(60 * 1000, 30, 'live-chat');
const reactionLimiter = createAuthRateLimiter(60 * 1000, 60, 'live-reaction');
const reportLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'live-report');

async function loadLiveSessionOrThrow(id: string) {
  const liveSession = await prisma.liveSession.findUnique({ where: { id } });
  if (!liveSession) {
    throw new AppError('NOT_FOUND', 'LIVE session not found');
  }
  return liveSession;
}

async function withHost(liveSessionId: string) {
  const liveSession = await loadLiveSessionOrThrow(liveSessionId);
  const authors = await fetchAuthorSummaries([liveSession.hostId]);
  return { liveSession, host: authors.get(liveSession.hostId) };
}

// -----------------------------------------------------------------------
// Start / discovery / detail
// -----------------------------------------------------------------------

liveRouter.post(
  '/live',
  requireAuth,
  startLimiter,
  uploadSingleImage('thumbnail'),
  validate({ body: startLiveSchema }),
  async (req, res, next) => {
    const file = req.file;
    try {
      const eligibility = checkLiveEligibility({
        ageVerified: req.user!.ageVerified,
        accountCreatedAt: req.user!.createdAt,
      });
      if (!eligibility.eligible) {
        if (file) await unlink(file.path).catch(() => {});
        throw new AppError('FORBIDDEN', eligibility.reason ?? 'You are not eligible to go LIVE');
      }

      let thumbnailKey: string | undefined;
      if (file) {
        try {
          await probeImage(file.path);
        } catch (probeError) {
          await unlink(file.path).catch(() => {});
          throw new AppError(
            'BAD_REQUEST',
            `Uploaded thumbnail is not a valid image: ${probeError instanceof Error ? probeError.message : 'unknown error'}`,
          );
        }
      }

      const { title, category, maxGuestSlots, subscriberOnlyChat, replayEnabled, goalTitle, goalTargetCoins, isVoiceOnly } = req.body;

      // Never trust a client-supplied host/id — the host is always the
      // authenticated requester, and the id is always server-generated.
      const liveSession = await prisma.liveSession.create({
        data: {
          hostId: req.user!.id,
          title,
          category,
          status: 'LIVE',
          maxGuestSlots,
          subscriberOnlyChat,
          replayEnabled,
          replayStatus: replayEnabled ? 'NOT_AVAILABLE' : 'NONE',
          goalEnabled: goalTargetCoins !== undefined,
          goalTitle: goalTargetCoins !== undefined ? goalTitle : undefined,
          goalTargetCoins,
          isVoiceOnly,
        },
      });

      if (file) {
        thumbnailKey = liveThumbnailKey(liveSession.id, path.extname(file.originalname) || '.jpg');
        await storage.putFromLocalPath(thumbnailKey, file.path);
        await prisma.liveSession.update({ where: { id: liveSession.id }, data: { thumbnailKey } });
      }

      const roomName = liveRoomName(liveSession.id);
      await liveStreamingProvider.createRoom(roomName);
      const token = await liveStreamingProvider.generateToken({
        roomName,
        identity: req.user!.id,
        canPublish: true,
      });

      onLiveSessionStarted(liveSession.hostId);

      const authors = await fetchAuthorSummaries([liveSession.hostId]);
      res.status(201).json({
        liveSession: serializeLiveSession({ ...liveSession, thumbnailKey: thumbnailKey ?? null }, {
          host: authors.get(liveSession.hostId),
          isOwnSession: true,
        }),
        token,
        wsUrl: liveStreamingProvider.wsUrl,
      });
    } catch (error) {
      next(error);
    }
  },
);

liveRouter.get('/live', requireAuth, validate({ query: listLiveQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const liveSessions = await prisma.liveSession.findMany({
      where: {
        status: 'LIVE',
        ...(decoded
          ? {
              OR: [
                { startedAt: { lt: new Date(decoded.createdAt) } },
                { startedAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = liveSessions.length > limit;
    const page = hasMore ? liveSessions.slice(0, limit) : liveSessions;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.startedAt.toISOString(), id: last.id }) : null;

    const authors = await fetchAuthorSummaries([...new Set(page.map((session) => session.hostId))]);

    res.status(200).json({
      liveSessions: page.map((session) =>
        serializeLiveSession(session, {
          host: authors.get(session.hostId),
          isOwnSession: session.hostId === req.user!.id,
        }),
      ),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

liveRouter.get('/live/:id', requireAuth, async (req, res, next) => {
  try {
    const { liveSession, host } = await withHost(req.params.id!);
    res.status(200).json(serializeLiveSession(liveSession, { host, isOwnSession: liveSession.hostId === req.user!.id }));
  } catch (error) {
    next(error);
  }
});

liveRouter.get('/live/:id/thumbnail', requireAuth, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    await streamAsset(req, res, next, liveSession.thumbnailKey, 'image/jpeg');
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Host lifecycle: reconnect, end
// -----------------------------------------------------------------------

liveRouter.post('/live/:id/reconnect', requireAuth, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    if (liveSession.hostId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'Only the host can reconnect as host');
    }
    if (liveSession.status !== 'LIVE') {
      throw new AppError('CONFLICT', 'This LIVE session has already ended');
    }

    const token = await liveStreamingProvider.generateToken({
      roomName: liveRoomName(liveSession.id),
      identity: req.user!.id,
      canPublish: true,
    });

    res.status(200).json({ token, wsUrl: liveStreamingProvider.wsUrl });
  } catch (error) {
    next(error);
  }
});

liveRouter.post('/live/:id/end', requireAuth, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    if (liveSession.hostId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only end your own LIVE session');
    }
    if (liveSession.status !== 'LIVE') {
      res.status(200).json(serializeLiveSession(liveSession, { isOwnSession: true }));
      return;
    }

    // Read still-active viewers BEFORE force-closing them below — needed to
    // credit each one's watch-time gamification event with a real duration.
    const stillWatching = await prisma.liveViewer.findMany({
      where: { liveSessionId: liveSession.id, leftAt: null },
      select: { userId: true, joinedAt: true },
    });

    const endedAt = new Date();
    const [updated] = await prisma.$transaction([
      prisma.liveSession.update({
        where: { id: liveSession.id },
        data: { status: 'ENDED', endedAt },
      }),
      // Proper session cleanup: nobody is left "actively viewing" a session
      // that no longer exists, regardless of whether every viewer's client
      // called /leave before disconnecting.
      prisma.liveViewer.updateMany({
        where: { liveSessionId: liveSession.id, leftAt: null },
        data: { leftAt: endedAt },
      }),
    ]);

    await liveStreamingProvider.deleteRoom(liveRoomName(liveSession.id));

    const hostDurationMinutes = Math.max(0, Math.round((endedAt.getTime() - liveSession.startedAt.getTime()) / 60_000));
    onLiveSessionEnded(liveSession.hostId, liveSession.id, hostDurationMinutes);
    for (const viewer of stillWatching) {
      const minutes = Math.max(0, Math.round((endedAt.getTime() - viewer.joinedAt.getTime()) / 60_000));
      onLiveWatchSession(viewer.userId, liveSession.hostId, liveSession.id, minutes);
    }

    res.status(200).json(serializeLiveSession(updated, { isOwnSession: true }));
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Viewer lifecycle: join, leave
// -----------------------------------------------------------------------

liveRouter.post('/live/:id/join', requireAuth, joinLeaveLimiter, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    if (liveSession.status !== 'LIVE') {
      throw new AppError('CONFLICT', 'This LIVE session has ended');
    }

    if (await isUserBlockedFromSession(liveSession.id, req.user!.id)) {
      throw new AppError('FORBIDDEN', 'You have been blocked from this LIVE session');
    }

    const existing = await prisma.liveViewer.findUnique({
      where: { liveSessionId_userId: { liveSessionId: liveSession.id, userId: req.user!.id } },
    });

    // Idempotent "duplicate join protection": a viewer reconnecting while
    // already active gets a fresh token without the viewer count being
    // incremented a second time for the same person.
    if (existing && existing.leftAt === null) {
      const token = await liveStreamingProvider.generateToken({
        roomName: liveRoomName(liveSession.id),
        identity: req.user!.id,
        canPublish: false,
      });
      res.status(200).json({ token, wsUrl: liveStreamingProvider.wsUrl, viewerCount: liveSession.viewerCount });
      return;
    }

    const updatedSession = await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.liveViewer.update({
          where: { id: existing.id },
          data: { joinedAt: new Date(), leftAt: null },
        });
      } else {
        await tx.liveViewer.create({
          data: { liveSessionId: liveSession.id, userId: req.user!.id },
        });
      }

      const session = await tx.liveSession.update({
        where: { id: liveSession.id },
        data: { viewerCount: { increment: 1 } },
      });

      if (session.viewerCount > session.peakViewerCount) {
        return tx.liveSession.update({
          where: { id: liveSession.id },
          data: { peakViewerCount: session.viewerCount },
        });
      }
      return session;
    });

    const token = await liveStreamingProvider.generateToken({
      roomName: liveRoomName(liveSession.id),
      identity: req.user!.id,
      canPublish: false,
    });

    res.status(201).json({ token, wsUrl: liveStreamingProvider.wsUrl, viewerCount: updatedSession.viewerCount });
  } catch (error) {
    next(error);
  }
});

liveRouter.post('/live/:id/leave', requireAuth, joinLeaveLimiter, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    const leftAt = new Date();

    const { updatedSession, joinedAt } = await prisma.$transaction(async (tx) => {
      const activeViewer = await tx.liveViewer.findFirst({
        where: { liveSessionId: liveSession.id, userId: req.user!.id, leftAt: null },
        select: { joinedAt: true },
      });
      if (!activeViewer) {
        throw new AppError('NOT_FOUND', 'You are not currently viewing this LIVE session');
      }

      await tx.liveViewer.updateMany({
        where: { liveSessionId: liveSession.id, userId: req.user!.id, leftAt: null },
        data: { leftAt },
      });

      const session = await tx.liveSession.update({
        where: { id: liveSession.id },
        data: { viewerCount: { decrement: 1 } },
      });
      return { updatedSession: session, joinedAt: activeViewer.joinedAt };
    });

    const minutes = Math.max(0, Math.round((leftAt.getTime() - joinedAt.getTime()) / 60_000));
    onLiveWatchSession(req.user!.id, liveSession.hostId, liveSession.id, minutes);

    res.status(200).json({ viewerCount: updatedSession.viewerCount });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Chat
// -----------------------------------------------------------------------

async function isSessionParticipant(liveSessionId: string, userId: string, hostId: string): Promise<boolean> {
  if (userId === hostId) return true;
  const activeViewer = await prisma.liveViewer.findFirst({
    where: { liveSessionId, userId, leftAt: null },
    select: { id: true },
  });
  return Boolean(activeViewer);
}

liveRouter.get(
  '/live/:id/chat',
  requireAuth,
  validate({ query: listLiveChatQuerySchema }),
  async (req, res, next) => {
    try {
      const liveSession = await loadLiveSessionOrThrow(req.params.id!);
      const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };

      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      const messages = await prisma.liveChatMessage.findMany({
        where: {
          liveSessionId: liveSession.id,
          ...(decoded
            ? {
                OR: [
                  { createdAt: { lt: new Date(decoded.createdAt) } },
                  { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { user: { select: { id: true, profile: { select: { username: true, displayName: true, avatarUrl: true } } } } },
      });

      const hasMore = messages.length > limit;
      const page = hasMore ? messages.slice(0, limit) : messages;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      res.status(200).json({
        messages: page.map((message) => ({
          id: message.id,
          liveSessionId: message.liveSessionId,
          userId: message.userId,
          username: message.user.profile?.username ?? null,
          displayName: message.user.profile?.displayName ?? null,
          avatarUrl: message.user.profile?.avatarUrl ?? null,
          text: message.text,
          createdAt: message.createdAt,
        })),
        nextCursor,
      });
    } catch (error) {
      next(error);
    }
  },
);

liveRouter.post(
  '/live/:id/chat',
  requireAuth,
  chatLimiter,
  validate({ body: liveChatMessageSchema }),
  async (req, res, next) => {
    try {
      const liveSession = await loadLiveSessionOrThrow(req.params.id!);
      if (liveSession.status !== 'LIVE') {
        throw new AppError('CONFLICT', 'This LIVE session has ended');
      }

      // Chat authorization: only the host or a currently-active viewer can
      // post — not just any authenticated user, and never after leaving.
      const canChat = await isSessionParticipant(liveSession.id, req.user!.id, liveSession.hostId);
      if (!canChat) {
        throw new AppError('FORBIDDEN', 'Join this LIVE session before chatting');
      }

      if (await isUserBlockedFromSession(liveSession.id, req.user!.id)) {
        throw new AppError('FORBIDDEN', 'You have been blocked from this LIVE session');
      }
      if (req.user!.id !== liveSession.hostId && (await isUserMutedInSession(liveSession.id, req.user!.id))) {
        throw new AppError('FORBIDDEN', 'You have been muted in this LIVE session');
      }

      if (liveSession.subscriberOnlyChat && req.user!.id !== liveSession.hostId) {
        const subscription = await prisma.liveSubscription.findUnique({
          where: { creatorId_fanId: { creatorId: liveSession.hostId, fanId: req.user!.id } },
        });
        if (!subscription || subscription.status !== 'ACTIVE') {
          throw new AppError('FORBIDDEN', 'Chat is limited to subscribers for this LIVE session');
        }
      }

      const blockedWord = await containsBlockedWord(req.body.text);
      if (blockedWord) {
        throw new AppError('BAD_REQUEST', 'Your message was blocked for containing prohibited language');
      }

      // Step 10 — the unified AI moderation pipeline, on top of the
      // host-managed blocked-word filter above. LIVE chat is one of the
      // XNAKView Strict Abuse Rule's named surfaces (brief §3/§4): a
      // context-aware, high-confidence severe match here can permanently
      // ban immediately. Moderated BEFORE the row is created (using a
      // pre-generated id) so a removed message is never even persisted.
      const messageId = randomUUID();
      const moderation = await moderateText({ contentType: 'LIVE_CHAT_MESSAGE', contentId: messageId, authorId: req.user!.id, text: req.body.text });
      assertModerationAllowsCreation(moderation, 'LIVE comment');

      const message = await prisma.liveChatMessage.create({
        data: { id: messageId, liveSessionId: liveSession.id, userId: req.user!.id, text: req.body.text },
      });

      res.status(201).json({
        id: message.id,
        liveSessionId: message.liveSessionId,
        userId: message.userId,
        text: message.text,
        createdAt: message.createdAt,
      });
    } catch (error) {
      next(error);
    }
  },
);

// -----------------------------------------------------------------------
// Reactions — real-time, ephemeral (no DB row; a reaction burst is
// transient by nature, same as every real short-video platform's LIVE
// reactions). Authorization mirrors chat: only the host or a currently
// active viewer, never a blocked/muted user.
// -----------------------------------------------------------------------

liveRouter.post(
  '/live/:id/reactions',
  requireAuth,
  reactionLimiter,
  validate({ body: liveReactionSchema }),
  async (req, res, next) => {
    try {
      const liveSession = await loadLiveSessionOrThrow(req.params.id!);
      if (liveSession.status !== 'LIVE') {
        throw new AppError('CONFLICT', 'This LIVE session has ended');
      }
      const canReact = await isSessionParticipant(liveSession.id, req.user!.id, liveSession.hostId);
      if (!canReact) {
        throw new AppError('FORBIDDEN', 'Join this LIVE session before reacting');
      }
      if (await isUserBlockedFromSession(liveSession.id, req.user!.id)) {
        throw new AppError('FORBIDDEN', 'You have been blocked from this LIVE session');
      }

      emitToLiveSession(liveSession.id, 'live:reaction', { emoji: req.body.emoji, senderId: req.user!.id });
      res.status(200).json({ sent: true });
    } catch (error) {
      next(error);
    }
  },
);

// -----------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------

liveRouter.post(
  '/live/:id/report',
  requireAuth,
  reportLimiter,
  validate({ body: reportLiveSchema }),
  async (req, res, next) => {
    try {
      const liveSession = await loadLiveSessionOrThrow(req.params.id!);

      const report = await prisma.liveReport.create({
        data: {
          liveSessionId: liveSession.id,
          reporterId: req.user!.id,
          reason: req.body.reason,
          description: req.body.description,
        },
      });

      res.status(201).json({
        id: report.id,
        liveSessionId: report.liveSessionId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'You have already reported this LIVE session'));
        return;
      }
      next(error);
    }
  },
);

liveRouter.post(
  '/live/:id/report-viewer',
  requireAuth,
  reportLimiter,
  validate({ body: reportLiveViewerSchema }),
  async (req, res, next) => {
    try {
      const liveSession = await loadLiveSessionOrThrow(req.params.id!);
      const { reportedUserId, reason, description } = req.body;

      if (reportedUserId === req.user!.id) {
        throw new AppError('BAD_REQUEST', 'You cannot report yourself');
      }

      // Reject reporting someone who was never actually in this LIVE
      // session — the host, a viewer (any time, not just currently active),
      // or a co-host/guest who actually joined (not merely invited).
      const participated =
        reportedUserId === liveSession.hostId ||
        (await prisma.liveViewer.findUnique({
          where: { liveSessionId_userId: { liveSessionId: liveSession.id, userId: reportedUserId } },
          select: { id: true },
        })) ||
        (await prisma.liveGuestSlot.findFirst({
          where: { liveSessionId: liveSession.id, userId: reportedUserId, status: { in: ['ACTIVE', 'LEFT', 'REMOVED'] } },
          select: { id: true },
        }));
      if (!participated) {
        throw new AppError('BAD_REQUEST', 'This user did not participate in this LIVE session');
      }

      const report = await prisma.liveViewerReport.create({
        data: { liveSessionId: liveSession.id, reportedUserId, reporterId: req.user!.id, reason, description },
      });

      res.status(201).json({
        id: report.id,
        liveSessionId: report.liveSessionId,
        reportedUserId: report.reportedUserId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'You have already reported this viewer'));
        return;
      }
      next(error);
    }
  },
);

liveRouter.post(
  '/live/:id/chat/:messageId/report',
  requireAuth,
  reportLimiter,
  validate({ body: reportLiveChatMessageSchema }),
  async (req, res, next) => {
    try {
      await loadLiveSessionOrThrow(req.params.id!);
      const message = await prisma.liveChatMessage.findUnique({ where: { id: req.params.messageId! } });
      if (!message || message.liveSessionId !== req.params.id) {
        throw new AppError('NOT_FOUND', 'Chat message not found');
      }

      const report = await prisma.liveChatMessageReport.create({
        data: {
          liveChatMessageId: message.id,
          reporterId: req.user!.id,
          reason: req.body.reason,
          description: req.body.description,
        },
      });

      res.status(201).json({
        id: report.id,
        liveChatMessageId: report.liveChatMessageId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'You have already reported this message'));
        return;
      }
      next(error);
    }
  },
);

// -----------------------------------------------------------------------
// Moderation: moderators, mute/block, remove message
// -----------------------------------------------------------------------

liveRouter.post(
  '/live/:id/moderators',
  requireAuth,
  validate({ body: assignModeratorSchema }),
  async (req, res, next) => {
    try {
      const liveSession = await loadLiveSessionOrThrow(req.params.id!);
      if (liveSession.hostId !== req.user!.id) {
        throw new AppError('FORBIDDEN', 'Only the host can assign moderators');
      }
      const { userId } = req.body;
      if (userId === liveSession.hostId) {
        throw new AppError('BAD_REQUEST', 'The host is already the top-level moderator');
      }

      const moderator = await prisma.liveModerator.upsert({
        where: { liveSessionId_userId: { liveSessionId: liveSession.id, userId } },
        create: { liveSessionId: liveSession.id, userId, assignedById: req.user!.id },
        update: {},
      });

      res.status(201).json({ id: moderator.id, liveSessionId: moderator.liveSessionId, userId: moderator.userId });
    } catch (error) {
      next(error);
    }
  },
);

liveRouter.delete('/live/:id/moderators/:userId', requireAuth, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    if (liveSession.hostId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'Only the host can remove moderators');
    }

    await prisma.liveModerator.deleteMany({
      where: { liveSessionId: liveSession.id, userId: req.params.userId! },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

liveRouter.post(
  '/live/:id/mute',
  requireAuth,
  validate({ body: restrictViewerSchema }),
  async (req, res, next) => {
    try {
      const liveSession = await loadLiveSessionOrThrow(req.params.id!);
      if (!(await canModerate(liveSession.id, req.user!.id, liveSession.hostId))) {
        throw new AppError('FORBIDDEN', 'Only the host or a moderator can mute a viewer');
      }
      const { userId } = req.body;
      if (userId === liveSession.hostId) {
        throw new AppError('BAD_REQUEST', 'You cannot mute the host');
      }

      await prisma.liveViewerRestriction.upsert({
        where: { liveSessionId_userId_type: { liveSessionId: liveSession.id, userId, type: 'MUTED' } },
        create: { liveSessionId: liveSession.id, userId, type: 'MUTED', createdById: req.user!.id },
        update: {},
      });

      res.status(201).json({ liveSessionId: liveSession.id, userId, type: 'MUTED' });
    } catch (error) {
      next(error);
    }
  },
);

liveRouter.delete('/live/:id/mute/:userId', requireAuth, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    if (!(await canModerate(liveSession.id, req.user!.id, liveSession.hostId))) {
      throw new AppError('FORBIDDEN', 'Only the host or a moderator can unmute a viewer');
    }

    await prisma.liveViewerRestriction.deleteMany({
      where: { liveSessionId: liveSession.id, userId: req.params.userId!, type: 'MUTED' },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

liveRouter.post(
  '/live/:id/block',
  requireAuth,
  validate({ body: restrictViewerSchema }),
  async (req, res, next) => {
    try {
      const liveSession = await loadLiveSessionOrThrow(req.params.id!);
      if (!(await canModerate(liveSession.id, req.user!.id, liveSession.hostId))) {
        throw new AppError('FORBIDDEN', 'Only the host or a moderator can block a viewer');
      }
      const { userId } = req.body;
      if (userId === liveSession.hostId) {
        throw new AppError('BAD_REQUEST', 'You cannot block the host');
      }

      await prisma.$transaction([
        prisma.liveViewerRestriction.upsert({
          where: { liveSessionId_userId_type: { liveSessionId: liveSession.id, userId, type: 'BLOCKED' } },
          create: { liveSessionId: liveSession.id, userId, type: 'BLOCKED', createdById: req.user!.id },
          update: {},
        }),
        prisma.liveViewer.updateMany({
          where: { liveSessionId: liveSession.id, userId, leftAt: null },
          data: { leftAt: new Date() },
        }),
      ]);

      res.status(201).json({ liveSessionId: liveSession.id, userId, type: 'BLOCKED' });
    } catch (error) {
      next(error);
    }
  },
);

liveRouter.delete('/live/:id/block/:userId', requireAuth, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    if (!(await canModerate(liveSession.id, req.user!.id, liveSession.hostId))) {
      throw new AppError('FORBIDDEN', 'Only the host or a moderator can unblock a viewer');
    }

    await prisma.liveViewerRestriction.deleteMany({
      where: { liveSessionId: liveSession.id, userId: req.params.userId!, type: 'BLOCKED' },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

liveRouter.delete('/live/:id/chat/:messageId', requireAuth, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    if (!(await canModerate(liveSession.id, req.user!.id, liveSession.hostId))) {
      throw new AppError('FORBIDDEN', 'Only the host or a moderator can remove a chat message');
    }

    const message = await prisma.liveChatMessage.findUnique({ where: { id: req.params.messageId! } });
    if (!message || message.liveSessionId !== liveSession.id) {
      throw new AppError('NOT_FOUND', 'Chat message not found');
    }

    await prisma.liveChatMessage.delete({ where: { id: message.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Replay (metadata/status only — see docs/STEP4_PROGRESS.md for why the
// actual recording pipeline is not implemented in Step 4)
// -----------------------------------------------------------------------

liveRouter.get('/live/:id/replay', requireAuth, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    res.status(200).json({
      liveSessionId: liveSession.id,
      replayEnabled: liveSession.replayEnabled,
      replayStatus: liveSession.replayStatus,
      replayUrl: liveSession.replayStatus === 'AVAILABLE' ? `/api/v1/live/${liveSession.id}/replay/file` : null,
    });
  } catch (error) {
    next(error);
  }
});

liveRouter.delete('/live/:id/replay', requireAuth, async (req, res, next) => {
  try {
    const liveSession = await loadLiveSessionOrThrow(req.params.id!);
    if (liveSession.hostId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'Only the host can delete their LIVE replay');
    }
    if (liveSession.replayStatus === 'AVAILABLE' && liveSession.replayKey) {
      await storage.delete(liveSession.replayKey).catch(() => {});
    }

    const updated = await prisma.liveSession.update({
      where: { id: liveSession.id },
      data: { replayStatus: 'DELETED', replayKey: null },
    });

    res.status(200).json({ liveSessionId: updated.id, replayStatus: updated.replayStatus });
  } catch (error) {
    next(error);
  }
});
