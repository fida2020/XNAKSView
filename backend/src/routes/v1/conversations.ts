import { Prisma } from '@prisma/client';
import { Router } from 'express';

import {
  findOrCreateConversation,
  loadConversationForParticipant,
  otherParticipantId,
  serializeConversationDetail,
  serializeConversations,
} from '@/lib/messagingAccess';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { emitToUser } from '@/lib/realtime';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { createConversationSchema, listConversationsQuerySchema, reportConversationSchema } from '@/schemas/messaging.schema';
import { AppError } from '@/utils/AppError';

export const conversationsRouter = Router();

const createLimiter = createAuthRateLimiter(60 * 60 * 1000, 30, 'conversation-create');
const actionLimiter = createAuthRateLimiter(60 * 1000, 60, 'conversation-action');
const reportLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'conversation-report');

conversationsRouter.post(
  '/conversations',
  requireAuth,
  createLimiter,
  validate({ body: createConversationSchema }),
  async (req, res, next) => {
    try {
      const conversation = await findOrCreateConversation(req.user!.id, req.body.userId);
      res.status(201).json(await serializeConversationDetail(conversation, req.user!.id));
    } catch (error) {
      next(error);
    }
  },
);

conversationsRouter.get(
  '/conversations',
  requireAuth,
  validate({ query: listConversationsQuerySchema }),
  async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      // Pinned conversations are shown separately, always at the top,
      // unpaginated (there are only ever a handful) — see
      // lib/messagingAccess.ts's module doc for why this sidesteps mixing
      // NULL-able `lastMessageAt` ordering into cursor pagination.
      const pinnedParticipantRows = await prisma.conversationParticipant.findMany({
        where: { userId, pinned: true },
        select: { conversationId: true },
      });
      const pinnedIds = new Set(pinnedParticipantRows.map((r) => r.conversationId));

      const baseWhere: Prisma.ConversationWhereInput = {
        OR: [{ participantOneId: userId }, { participantTwoId: userId }],
        lastMessageAt: { not: null },
        ...(status ? { status: status as never } : {}),
      };

      const [pinnedConversations, page] = await Promise.all([
        pinnedIds.size > 0
          ? prisma.conversation.findMany({
              where: { ...baseWhere, id: { in: [...pinnedIds] } },
              orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
              include: { lastMessage: { select: { text: true, type: true, deletedAt: true } } },
            })
          : Promise.resolve([]),
        prisma.conversation.findMany({
          where: {
            ...baseWhere,
            id: { notIn: [...pinnedIds] },
            ...(decoded
              ? {
                  OR: [
                    { lastMessageAt: { lt: new Date(decoded.createdAt) } },
                    { lastMessageAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          include: { lastMessage: { select: { text: true, type: true, deletedAt: true } } },
        }),
      ]);

      const hasMore = page.length > limit;
      const pageItems = hasMore ? page.slice(0, limit) : page;
      const last = pageItems[pageItems.length - 1];
      const nextCursor =
        hasMore && last?.lastMessageAt ? encodeCursor({ createdAt: last.lastMessageAt.toISOString(), id: last.id }) : null;

      res.status(200).json({
        pinned: await serializeConversations(pinnedConversations, userId),
        conversations: await serializeConversations(pageItems, userId),
        nextCursor,
      });
    } catch (error) {
      next(error);
    }
  },
);

conversationsRouter.get('/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    const conversation = await loadConversationForParticipant(req.params.id!, req.user!.id);
    res.status(200).json(await serializeConversationDetail(conversation, req.user!.id));
  } catch (error) {
    next(error);
  }
});

conversationsRouter.post('/conversations/:id/accept', requireAuth, actionLimiter, async (req, res, next) => {
  try {
    const conversation = await loadConversationForParticipant(req.params.id!, req.user!.id);
    if (conversation.initiatedById === req.user!.id) {
      throw new AppError('FORBIDDEN', 'Only the recipient can accept a message request');
    }
    if (conversation.status !== 'PENDING') {
      res.status(200).json(await serializeConversationDetail(conversation, req.user!.id));
      return;
    }

    const updated = await prisma.conversation.update({ where: { id: conversation.id }, data: { status: 'ACCEPTED' } });
    emitToUser(otherParticipantId(updated, req.user!.id), 'conversation:accepted', { conversationId: updated.id });
    res.status(200).json(await serializeConversationDetail(updated, req.user!.id));
  } catch (error) {
    next(error);
  }
});

async function setParticipantFlag(
  conversationId: string,
  userId: string,
  data: { muted?: boolean; pinned?: boolean; pinnedAt?: Date | null },
) {
  return prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId } },
    data,
  });
}

conversationsRouter.post('/conversations/:id/mute', requireAuth, actionLimiter, async (req, res, next) => {
  try {
    await loadConversationForParticipant(req.params.id!, req.user!.id);
    await setParticipantFlag(req.params.id!, req.user!.id, { muted: true });
    res.status(200).json({ conversationId: req.params.id, muted: true });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.delete('/conversations/:id/mute', requireAuth, actionLimiter, async (req, res, next) => {
  try {
    await loadConversationForParticipant(req.params.id!, req.user!.id);
    await setParticipantFlag(req.params.id!, req.user!.id, { muted: false });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

conversationsRouter.post('/conversations/:id/pin', requireAuth, actionLimiter, async (req, res, next) => {
  try {
    await loadConversationForParticipant(req.params.id!, req.user!.id);
    await setParticipantFlag(req.params.id!, req.user!.id, { pinned: true, pinnedAt: new Date() });
    res.status(200).json({ conversationId: req.params.id, pinned: true });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.delete('/conversations/:id/pin', requireAuth, actionLimiter, async (req, res, next) => {
  try {
    await loadConversationForParticipant(req.params.id!, req.user!.id);
    await setParticipantFlag(req.params.id!, req.user!.id, { pinned: false, pinnedAt: null });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

conversationsRouter.post('/conversations/:id/read', requireAuth, actionLimiter, async (req, res, next) => {
  try {
    const conversation = await loadConversationForParticipant(req.params.id!, req.user!.id);
    const otherId = otherParticipantId(conversation, req.user!.id);
    const now = new Date();

    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: conversation.id, userId: req.user!.id } },
      data: { unreadCount: 0, lastReadAt: now },
    });

    const unreadMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id, senderId: otherId, createdAt: { lte: now } },
      select: { id: true },
    });

    if (unreadMessages.length > 0) {
      await prisma.$transaction(
        unreadMessages.map((m) =>
          prisma.messageReceipt.upsert({
            where: { messageId_userId: { messageId: m.id, userId: req.user!.id } },
            create: { messageId: m.id, userId: req.user!.id, deliveredAt: now, readAt: now },
            update: { readAt: now, deliveredAt: now },
          }),
        ),
      );
      emitToUser(otherId, 'message:read', { conversationId: conversation.id, readerId: req.user!.id, readAt: now.toISOString() });
    }

    res.status(200).json({ conversationId: conversation.id, unreadCount: 0 });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.post(
  '/conversations/:id/report',
  requireAuth,
  reportLimiter,
  validate({ body: reportConversationSchema }),
  async (req, res, next) => {
    try {
      const conversation = await loadConversationForParticipant(req.params.id!, req.user!.id);
      const report = await prisma.conversationReport.create({
        data: {
          conversationId: conversation.id,
          reporterId: req.user!.id,
          reason: req.body.reason,
          description: req.body.description,
        },
      });
      res.status(201).json({ id: report.id, conversationId: report.conversationId, status: report.status });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'You have already reported this conversation'));
        return;
      }
      next(error);
    }
  },
);
