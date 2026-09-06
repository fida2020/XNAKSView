import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { recordActivity } from '@/lib/activityFeed';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import {
  fetchAuthorSummaries,
  fetchFavoritedVideoIds,
  fetchFollowingIds,
  fetchLikedVideoIds,
  fetchRepostedVideoIds,
  serializeVideo,
} from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { feedQuerySchema } from '@/schemas/video.schema';
import { AppError } from '@/utils/AppError';

export const followRouter = Router();

const followLimiter = createAuthRateLimiter(60 * 1000, 30, 'follow');

/**
 * Deterministic suggestions — most-followed accounts the caller doesn't
 * already follow, excluding themselves. No AI/ML ranking (out of scope).
 * Registered before `/users/:id` — otherwise that route's `:id` param would
 * greedily match the literal "suggested" segment first.
 */
followRouter.get('/users/suggested', requireAuth, async (req, res, next) => {
  try {
    const following = await prisma.follow.findMany({ where: { followerId: req.user!.id }, select: { followingId: true } });
    const excludeIds = [req.user!.id, ...following.map((f) => f.followingId)];

    const suggestions = await prisma.user.findMany({
      where: { id: { notIn: excludeIds }, status: 'ACTIVE' },
      orderBy: { followerCount: 'desc' },
      take: 20,
      select: { id: true },
    });

    const authors = await fetchAuthorSummaries(suggestions.map((s) => s.id));
    res.status(200).json({ users: suggestions.map((s) => authors.get(s.id)).filter(Boolean) });
  } catch (error) {
    next(error);
  }
});

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

    await prisma.$transaction(async (tx) => {
      await tx.follow.create({ data: { followerId: req.user!.id, followingId: targetId } });
      await tx.user.update({ where: { id: req.user!.id }, data: { followingCount: { increment: 1 } } });
      await tx.user.update({ where: { id: targetId }, data: { followerCount: { increment: 1 } } });
      await recordActivity(tx, { recipientId: targetId, actorId: req.user!.id, type: 'FOLLOW' });
    });

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

/** Lets a profile owner remove someone from their own followers list — the other side's `followingCount` drops too, same as if they'd unfollowed themselves. */
followRouter.delete('/users/:id/followers/:followerId', requireAuth, followLimiter, async (req, res, next) => {
  try {
    if (req.params.id !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only manage your own followers');
    }
    const followerId = req.params.followerId!;

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.follow.deleteMany({ where: { followerId, followingId: req.user!.id } });
      if (deleted.count === 0) {
        throw new AppError('NOT_FOUND', 'That account does not follow you');
      }
      await tx.user.update({ where: { id: followerId }, data: { followingCount: { decrement: 1 } } });
      await tx.user.update({ where: { id: req.user!.id }, data: { followerCount: { decrement: 1 } } });
    });

    res.status(200).json({ removed: true });
  } catch (error) {
    next(error);
  }
});

followRouter.get('/users/:id/followers', requireAuth, validate({ query: feedQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const follows = await prisma.follow.findMany({
      where: {
        followingId: req.params.id!,
        ...(decoded
          ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = follows.length > limit;
    const page = hasMore ? follows.slice(0, limit) : follows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    const authors = await fetchAuthorSummaries(page.map((f) => f.followerId));
    res.status(200).json({ users: page.map((f) => authors.get(f.followerId)).filter(Boolean), nextCursor });
  } catch (error) {
    next(error);
  }
});

followRouter.get('/users/:id/following', requireAuth, validate({ query: feedQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const follows = await prisma.follow.findMany({
      where: {
        followerId: req.params.id!,
        ...(decoded
          ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = follows.length > limit;
    const page = hasMore ? follows.slice(0, limit) : follows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    const authors = await fetchAuthorSummaries(page.map((f) => f.followingId));
    res.status(200).json({ users: page.map((f) => authors.get(f.followingId)).filter(Boolean), nextCursor });
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
    const videoIds = page.map((video) => video.id);
    const [likedVideoIds, authors, followingIds, repostedVideoIds, favoritedVideoIds] = await Promise.all([
      fetchLikedVideoIds(req.user!.id, videoIds),
      fetchAuthorSummaries([targetId]),
      fetchFollowingIds(req.user!.id, [targetId]),
      fetchRepostedVideoIds(req.user!.id, videoIds),
      fetchFavoritedVideoIds(req.user!.id, videoIds),
    ]);
    const author = authors.get(targetId);
    const isFollowedByMe = followingIds.has(targetId);

    res.status(200).json({
      videos: page.map((video) =>
        serializeVideo(video, {
          likedByMe: likedVideoIds.has(video.id),
          author,
          isFollowedByMe,
          repostedByMe: repostedVideoIds.has(video.id),
          favoritedByMe: favoritedVideoIds.has(video.id),
        }),
      ),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});
