import { Router } from 'express';

import { sendGift, type GiftTarget } from '@/lib/giftService';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { listGiftsQuerySchema, listGiftTransactionsQuerySchema, sendGiftSchema } from '@/schemas/gifts.schema';
import { AppError } from '@/utils/AppError';

export const giftsRouter = Router();

const sendGiftLimiter = createAuthRateLimiter(60 * 1000, 60, 'gift-send');

giftsRouter.get('/gifts', requireAuth, validate({ query: listGiftsQuerySchema }), async (req, res, next) => {
  try {
    const { category } = req.query as { category?: string };
    const gifts = await prisma.gift.findMany({
      where: { active: true, ...(category ? { category: category as never } : {}) },
      orderBy: { sortOrder: 'asc' },
    });
    res.status(200).json({
      gifts: gifts.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        coinCost: g.coinCost,
        thumbnailKey: g.thumbnailKey,
        animationAssetKey: g.animationAssetKey,
        category: g.category,
        maxQuantityPerSend: g.maxQuantityPerSend,
        sortOrder: g.sortOrder,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * The only endpoint that ever spends a user's Coins on a Gift. 18+ is
 * re-checked here (account ACTIVE is already guaranteed by `requireAuth`)
 * — a Gift, like LIVE, is an eligibility-gated action, not just an
 * authenticated one. Every other rule (recipient resolution, blocking,
 * insufficient balance, LIVE attribution, Diamond conversion, platform
 * revenue split) lives in `lib/giftService.ts`, not here.
 */
giftsRouter.post('/gifts/send', requireAuth, sendGiftLimiter, validate({ body: sendGiftSchema }), async (req, res, next) => {
  try {
    if (!req.user!.ageVerified) {
      throw new AppError('FORBIDDEN', 'Age verification is required to send Gifts');
    }

    const body = req.body as {
      giftSlug: string;
      quantity: number;
      idempotencyKey: string;
      liveSessionId?: string;
      targetParticipantId?: string;
      videoId?: string;
      photoPostId?: string;
      textPostId?: string;
    };

    let target: GiftTarget;
    if (body.liveSessionId) {
      target = { type: 'LIVE', liveSessionId: body.liveSessionId, targetParticipantId: body.targetParticipantId };
    } else if (body.videoId) {
      target = { type: 'VIDEO', videoId: body.videoId };
    } else if (body.photoPostId) {
      target = { type: 'PHOTO_POST', photoPostId: body.photoPostId };
    } else {
      target = { type: 'TEXT_POST', textPostId: body.textPostId! };
    }

    const result = await sendGift({
      senderId: req.user!.id,
      giftSlug: body.giftSlug,
      quantity: body.quantity,
      target,
      idempotencyKey: body.idempotencyKey,
    });

    res.status(result.alreadyProcessed ? 200 : 201).json({
      giftTransactionId: result.transaction.id,
      recipientId: result.recipientId,
      participantRole: result.participantRole,
      totalCoins: result.transaction.totalCoins,
      diamondsCredited: result.diamondsCredited,
      platformSharePercent: result.platformSharePercent,
      senderBalance: result.senderBalance,
    });
  } catch (error) {
    next(error);
  }
});

giftsRouter.get('/gifts/sent', requireAuth, validate({ query: listGiftTransactionsQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const transactions = await prisma.giftTransaction.findMany({
      where: {
        senderId: req.user!.id,
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      include: { gift: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = transactions.length > limit;
    const page = hasMore ? transactions.slice(0, limit) : transactions;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    res.status(200).json({
      transactions: page.map((t) => ({
        id: t.id,
        recipientId: t.recipientId,
        giftName: t.gift.name,
        giftSlug: t.gift.slug,
        quantity: t.quantity,
        totalCoins: t.totalCoins,
        contentType: t.contentType,
        contentId: t.contentId,
        liveSessionId: t.liveSessionId,
        createdAt: t.createdAt,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

giftsRouter.get('/gifts/received', requireAuth, validate({ query: listGiftTransactionsQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const transactions = await prisma.giftTransaction.findMany({
      where: {
        recipientId: req.user!.id,
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      include: { gift: true, diamondLedgerEntry: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = transactions.length > limit;
    const page = hasMore ? transactions.slice(0, limit) : transactions;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    res.status(200).json({
      // Never expose the sender's wallet/payment data — only the public
      // Gift-sending fact + this creator's own Diamond credit.
      transactions: page.map((t) => ({
        id: t.id,
        senderId: t.senderId,
        giftName: t.gift.name,
        giftSlug: t.gift.slug,
        quantity: t.quantity,
        diamondsCredited: t.diamondLedgerEntry?.diamonds ?? 0,
        contentType: t.contentType,
        contentId: t.contentId,
        liveSessionId: t.liveSessionId,
        createdAt: t.createdAt,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});
