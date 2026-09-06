import { Router } from 'express';

import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { fetchAuthorSummaries } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { feedQuerySchema } from '@/schemas/video.schema';
import { AppError } from '@/utils/AppError';

export const activityRouter = Router();

/** The persisted Activity tab (brief O) — reads never expose another user's activity, only the caller's own. */
activityRouter.get('/activity', requireAuth, validate({ query: feedQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const items = await prisma.activityNotification.findMany({
      where: {
        recipientId: req.user!.id,
        ...(decoded
          ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    const actors = await fetchAuthorSummaries([...new Set(page.map((i) => i.actorId))]);

    res.status(200).json({
      activity: page.map((item) => ({
        id: item.id,
        type: item.type,
        actor: actors.get(item.actorId),
        videoId: item.videoId,
        commentId: item.commentId,
        read: item.readAt !== null,
        createdAt: item.createdAt,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

activityRouter.post('/activity/:id/read', requireAuth, async (req, res, next) => {
  try {
    const updated = await prisma.activityNotification.updateMany({
      where: { id: req.params.id!, recipientId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) {
      const exists = await prisma.activityNotification.findFirst({ where: { id: req.params.id!, recipientId: req.user!.id } });
      if (!exists) {
        throw new AppError('NOT_FOUND', 'Activity item not found');
      }
    }
    res.status(200).json({ read: true });
  } catch (error) {
    next(error);
  }
});

activityRouter.post('/activity/read-all', requireAuth, async (req, res, next) => {
  try {
    await prisma.activityNotification.updateMany({
      where: { recipientId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(200).json({ read: true });
  } catch (error) {
    next(error);
  }
});
