import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import path from 'path';

import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { env } from '@/config/env';
import {
  isBlockedEitherDirection,
  loadConversationForParticipant,
  otherParticipantId,
  serializeMessage,
} from '@/lib/messagingAccess';
import { streamAsset } from '@/lib/mediaStreaming';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { notificationDispatcher } from '@/lib/notifications';
import { emitToConversation, emitToUser, isOnline } from '@/lib/realtime';
import { storage, voiceMessageKey } from '@/lib/storage';
import { probeAudioContainer, validateVoiceMessage } from '@/lib/voiceValidation';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { uploadSingleAudio } from '@/middleware/upload';
import { validate } from '@/middleware/validate';
import {
  listMessagesQuerySchema,
  reportMessageSchema,
  sendTextMessageSchema,
  sendVoiceMessageSchema,
} from '@/schemas/messaging.schema';
import { AppError } from '@/utils/AppError';

export const messagesRouter = Router();

const sendLimiter = createAuthRateLimiter(60 * 1000, 60, 'message-send');
const voiceLimiter = createAuthRateLimiter(60 * 1000, 20, 'message-voice');
const reportLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'message-report');

async function loadMessageOrThrow(id: string) {
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) {
    throw new AppError('NOT_FOUND', 'Message not found');
  }
  return message;
}

/** After creating a message: bump the conversation's denormalized last-message pointer, the recipient's unread count, and auto-accept a pending request the recipient just replied to. */
async function afterMessageCreated(
  conversationId: string,
  senderId: string,
  recipientId: string,
  messageId: string,
  createdAt: Date,
) {
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });
  const shouldAutoAccept =
    conversation.status === 'PENDING' && conversation.initiatedById !== senderId;

  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageId: messageId,
        lastMessageAt: createdAt,
        ...(shouldAutoAccept ? { status: 'ACCEPTED' } : {}),
      },
    }),
    prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: recipientId } },
      data: { unreadCount: { increment: 1 } },
    }),
  ]);

  const delivered = await isOnline(recipientId);
  if (delivered) {
    await prisma.messageReceipt.upsert({
      where: { messageId_userId: { messageId, userId: recipientId } },
      create: { messageId, userId: recipientId, deliveredAt: new Date() },
      update: { deliveredAt: new Date() },
    });
  }

  if (shouldAutoAccept) {
    emitToUser(senderId, 'conversation:accepted', { conversationId });
  }

  const isFirstMessageOfAStillPendingRequest = conversation.status === 'PENDING' && !shouldAutoAccept;
  notificationDispatcher.notify(recipientId, isFirstMessageOfAStillPendingRequest ? 'MESSAGE_REQUEST' : 'NEW_MESSAGE', {
    conversationId,
    messageId,
    senderId,
  });
}

messagesRouter.get(
  '/conversations/:id/messages',
  requireAuth,
  validate({ query: listMessagesQuerySchema }),
  async (req, res, next) => {
    try {
      const conversation = await loadConversationForParticipant(req.params.id!, req.user!.id);
      const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
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
        include: { receipts: true },
      });

      const hasMore = messages.length > limit;
      const page = hasMore ? messages.slice(0, limit) : messages;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null;

      // Lazily mark "delivered" for anything addressed to the viewer that
      // hasn't been so far — fetching your own inbox is itself a delivery
      // signal, same as the socket push is for an online recipient.
      const undelivered = page.filter(
        (m) =>
          m.senderId !== req.user!.id &&
          !m.receipts.some((r) => r.userId === req.user!.id && r.deliveredAt),
      );
      if (undelivered.length > 0) {
        const now = new Date();
        await prisma.$transaction(
          undelivered.map((m) =>
            prisma.messageReceipt.upsert({
              where: { messageId_userId: { messageId: m.id, userId: req.user!.id } },
              create: { messageId: m.id, userId: req.user!.id, deliveredAt: now },
              update: { deliveredAt: now },
            }),
          ),
        );
      }

      res.status(200).json({
        messages: page.map((m) => serializeMessage(m)),
        nextCursor,
      });
    } catch (error) {
      next(error);
    }
  },
);

messagesRouter.post(
  '/conversations/:id/messages',
  requireAuth,
  sendLimiter,
  validate({ body: sendTextMessageSchema }),
  async (req, res, next) => {
    try {
      const conversation = await loadConversationForParticipant(req.params.id!, req.user!.id);
      const recipientId = otherParticipantId(conversation, req.user!.id);

      const existing = await prisma.message.findUnique({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId: conversation.id,
            senderId: req.user!.id,
            clientMessageId: req.body.clientMessageId,
          },
        },
        include: { receipts: true },
      });
      if (existing) {
        res.status(200).json(serializeMessage(existing));
        return;
      }

      if (await isBlockedEitherDirection(req.user!.id, recipientId)) {
        throw new AppError('FORBIDDEN', 'You cannot message this user right now');
      }

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: req.user!.id,
          type: 'TEXT',
          text: req.body.text,
          clientMessageId: req.body.clientMessageId,
        },
      });

      await afterMessageCreated(
        conversation.id,
        req.user!.id,
        recipientId,
        message.id,
        message.createdAt,
      );

      const payload = serializeMessage(message);
      emitToConversation(conversation.id, 'message:new', payload);
      emitToUser(recipientId, 'message:new', payload);

      res.status(201).json(payload);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Lost a race with our own retry — fetch-and-return, not an error:
        // idempotent send means the caller gets the same result either way.
        const conversation = await loadConversationForParticipant(
          req.params.id!,
          req.user!.id,
        ).catch(() => null);
        const existing = conversation
          ? await prisma.message.findUnique({
              where: {
                conversationId_senderId_clientMessageId: {
                  conversationId: conversation.id,
                  senderId: req.user!.id,
                  clientMessageId: req.body.clientMessageId,
                },
              },
            })
          : null;
        if (existing) {
          res.status(200).json(serializeMessage(existing));
          return;
        }
      }
      next(error);
    }
  },
);

messagesRouter.post(
  '/conversations/:id/messages/voice',
  requireAuth,
  voiceLimiter,
  uploadSingleAudio('audio'),
  validate({ body: sendVoiceMessageSchema }),
  async (req, res, next) => {
    const file = req.file;
    try {
      const conversation = await loadConversationForParticipant(req.params.id!, req.user!.id);
      const recipientId = otherParticipantId(conversation, req.user!.id);

      const existing = await prisma.message.findUnique({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId: conversation.id,
            senderId: req.user!.id,
            clientMessageId: req.body.clientMessageId,
          },
        },
      });
      if (existing) {
        if (file) await unlink(file.path).catch(() => {});
        res.status(200).json(serializeMessage(existing));
        return;
      }

      if (!file) {
        throw new AppError('BAD_REQUEST', 'An audio file is required');
      }

      if (await isBlockedEitherDirection(req.user!.id, recipientId)) {
        throw new AppError('FORBIDDEN', 'You cannot message this user right now');
      }

      let validated;
      try {
        validated = await validateVoiceMessage(file.path, env.MAX_VOICE_MESSAGE_SECONDS * 1000);
      } catch (validationError) {
        await unlink(file.path).catch(() => {});
        throw new AppError(
          'BAD_REQUEST',
          validationError instanceof Error ? validationError.message : 'Invalid voice message',
        );
      }

      const messageId = randomUUID();
      const extension = path.extname(file.originalname) || '.m4a';
      const key = voiceMessageKey(messageId, extension);
      await storage.putFromLocalPath(key, file.path);

      const message = await prisma.message.create({
        data: {
          id: messageId,
          conversationId: conversation.id,
          senderId: req.user!.id,
          type: 'VOICE',
          voiceKey: key,
          voiceDurationMs: validated.durationMs,
          voiceMimeType: validated.mimeType,
          clientMessageId: req.body.clientMessageId,
        },
      });

      await afterMessageCreated(
        conversation.id,
        req.user!.id,
        recipientId,
        message.id,
        message.createdAt,
      );

      const payload = serializeMessage(message);
      emitToConversation(conversation.id, 'message:new', payload);
      emitToUser(recipientId, 'message:new', payload);

      res.status(201).json(payload);
    } catch (error) {
      if (file) await unlink(file.path).catch(() => {});
      next(error);
    }
  },
);

messagesRouter.delete('/messages/:id', requireAuth, async (req, res, next) => {
  try {
    const message = await loadMessageOrThrow(req.params.id!);
    await loadConversationForParticipant(message.conversationId, req.user!.id);

    if (message.senderId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only unsend your own message');
    }
    if (message.deletedAt) {
      res.status(204).send();
      return;
    }
    const windowMs = env.MESSAGE_UNSEND_WINDOW_MINUTES * 60 * 1000;
    if (Date.now() - message.createdAt.getTime() > windowMs) {
      throw new AppError(
        'FORBIDDEN',
        `Messages can only be unsent within ${env.MESSAGE_UNSEND_WINDOW_MINUTES} minutes of sending`,
      );
    }

    if (message.voiceKey) {
      await storage.delete(message.voiceKey).catch(() => {});
    }
    await prisma.message.update({
      where: { id: message.id },
      data: { deletedAt: new Date(), text: null, voiceKey: null },
    });

    emitToConversation(message.conversationId, 'message:deleted', {
      conversationId: message.conversationId,
      messageId: message.id,
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

messagesRouter.get('/messages/:id/voice', requireAuth, async (req, res, next) => {
  try {
    const message = await loadMessageOrThrow(req.params.id!);
    await loadConversationForParticipant(message.conversationId, req.user!.id);
    if (message.deletedAt) {
      throw new AppError('NOT_FOUND', 'Voice message not available');
    }
    const mimeType =
      message.voiceMimeType ??
      (await probeAudioContainer(message.voiceKey!).catch(() => null))?.mimeType ??
      'audio/mp4';
    await streamAsset(req, res, next, message.voiceKey, mimeType);
  } catch (error) {
    next(error);
  }
});

messagesRouter.post(
  '/messages/:id/report',
  requireAuth,
  reportLimiter,
  validate({ body: reportMessageSchema }),
  async (req, res, next) => {
    try {
      const message = await loadMessageOrThrow(req.params.id!);
      await loadConversationForParticipant(message.conversationId, req.user!.id);
      if (message.senderId === req.user!.id) {
        throw new AppError('BAD_REQUEST', 'You cannot report your own message');
      }

      const report = await prisma.messageReport.create({
        data: {
          messageId: message.id,
          reporterId: req.user!.id,
          reason: req.body.reason,
          description: req.body.description,
        },
      });
      res.status(201).json({ id: report.id, messageId: report.messageId, status: report.status });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'You have already reported this message'));
        return;
      }
      next(error);
    }
  },
);
