import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { fetchAuthorSummaries, fetchFollowingIds, fetchLikedVideoIds, serializeVideo } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { feedQuerySchema } from '@/schemas/video.schema';
import { AppError } from '@/utils/AppError';

export const followRouter = Router();

const followLimiter = createAuthRateLimiter(60 * 1000, 30, 'follow');

/** Public profile summary for any user — needed to show a creator's profile header (username/avatar/follow counts) from the feed, not just the caller's own via /me. */
followRouter.get('/users/:id', requireAuth, async (req, res, next) => {
  try {
    const targetId = req.params.id!;
    const target = await prisma.user.findUnique({ where: { id: targetId }, include: { profile: true } });
    if (!target) {
      throw new AppError('NOT_FOUND', 'User not found');
    }

    const isFollowedByMe =
      targetId === req.user!.id ? undefined : (await fetchFollowingIds(req.user!.id, [targetId])).has(targetId);

    res.status(200).json({
      id: target.id,
      username: target.profile?.username ?? null,
      displayName: target.profile?.displayName ?? null,
      bio: target.profile?.bio ?? null,
      avatarUrl: target.profile?.avatarUrl ?? null,
      followerCount: target.followerCount,
      followingCount: target.followingCount,
      isFollowedByMe,
      isSelf: targetId === req.user!.id,
    });
  } catch (error) {
    next(error);
  }
});

followRouter.post('/users/:id/follow', requireAuth, followLimiter, async (req, res, next) => {
  try {
    const targetId = req.params.id!;
    if (targetId === req.user!.id) {
      throw new AppError('BAD_REQUEST', 'You cannot follow yourself');
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new AppError('NOT_FOUND', 'User not found');
    }

    await prisma.$transaction([
      prisma.follow.create({ data: { followerId: req.user!.id, followingId: targetId } }),
      prisma.user.update({ where: { id: req.user!.id }, data: { followingCount: { increment: 1 } } }),
      prisma.user.update({ where: { id: targetId }, data: { followerCount: { increment: 1 } } }),
    ]);

    res.status(201).json({ following: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('CONFLICT', 'Already following this user'));
      return;
    }
    next(error);
  }
});

followRouter.delete('/users/:id/follow', requireAuth, followLimiter, async (req, res, next) => {
  try {
    const targetId = req.params.id!;

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.follow.deleteMany({ where: { followerId: req.user!.id, followingId: targetId } });
      if (deleted.count === 0) {
        throw new AppError('NOT_FOUND', 'You are not following this user');
      }
      await tx.user.update({ where: { id: req.user!.id }, data: { followingCount: { decrement: 1 } } });
      await tx.user.update({ where: { id: targetId }, data: { followerCount: { decrement: 1 } } });
    });

    res.status(200).json({ following: false });
  } catch (error) {
    next(error);
  }
});

/** Creator profile video listing: the owner sees all of their own videos (any status/visibility); anyone else sees only READY+PUBLIC. */
followRouter.get('/users/:id/videos', requireAuth, validate({ query: feedQuerySchema }), async (req, res, next) => {
  try {
    const targetId = req.params.id!;
    const isSelf = targetId === req.user!.id;

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new AppError('NOT_FOUND', 'User not found');
    }

    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const cursorFilter = decoded
      ? {
          OR: [
            { createdAt: { lt: new Date(decoded.createdAt) } },
            { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
          ],
        }
      : {};

    const videos = await prisma.video.findMany({
      where: {
        userId: targetId,
        ...(isSelf ? { status: { not: 'DELETED' } } : { status: 'READY', visibility: 'PUBLIC' }),
        ...cursorFilter,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = videos.length > limit;
    const page = hasMore ? videos.slice(0, limit) : videos;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    // Every video on this page has the same author (the profile owner), so
    // the author/follow lookups only need to run once, not once per video.
    const [likedVideoIds, authors, followingIds] = await Promise.all([
      fetchLikedVideoIds(
        req.user!.id,
        page.map((video) => video.id),
      ),
      fetchAuthorSummaries([targetId]),
      fetchFollowingIds(req.user!.id, [targetId]),
    ]);
    const author = authors.get(targetId);
    const isFollowedByMe = followingIds.has(targetId);

    res.status(200).json({
      videos: page.map((video) =>
        serializeVideo(video, { likedByMe: likedVideoIds.has(video.id), author, isFollowedByMe }),
      ),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});
