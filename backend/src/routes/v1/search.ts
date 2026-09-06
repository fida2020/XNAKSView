import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { normalizeHashtag } from '@/lib/hashtags';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { fetchAuthorSummaries, fetchFollowingIds, fetchLikedVideoIds, serializeVideo } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { searchQuerySchema } from '@/schemas/discovery.schema';
import { AppError } from '@/utils/AppError';

export const searchRouter = Router();

const searchLimiter = createAuthRateLimiter(60 * 1000, 60, 'search');

/**
 * A single endpoint with a `type` discriminator rather than three separate
 * routes — matches how the mobile search UI actually works (one search bar,
 * tabs for result category), and keeps the "record this as a recent
 * search" side effect in exactly one place.
 */
searchRouter.get('/search', requireAuth, searchLimiter, validate({ query: searchQuerySchema }), async (req, res, next) => {
  try {
    const { q, type, cursor, limit } = req.query as unknown as { q: string; type: 'users' | 'videos' | 'hashtags'; cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    await prisma.recentSearch.upsert({
      where: { userId_query: { userId: req.user!.id, query: q } },
      create: { userId: req.user!.id, query: q },
      update: { createdAt: new Date() },
    });

    if (type === 'hashtags') {
      const hashtags = await prisma.hashtag.findMany({
        where: { tag: { contains: normalizeHashtag(q), mode: 'insensitive' } },
        orderBy: { postCount: 'desc' },
        take: limit,
      });
      res.status(200).json({ hashtags: hashtags.map((h) => ({ tag: h.tag, postCount: h.postCount })), nextCursor: null });
      return;
    }

    if (type === 'users') {
      const profiles = await prisma.profile.findMany({
        where: {
          OR: [{ username: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }],
        },
        take: limit,
        include: { user: { select: { id: true, followerCount: true } } },
      });
      const followingIds = await fetchFollowingIds(req.user!.id, profiles.map((p) => p.userId));
      res.status(200).json({
        users: profiles.map((p) => ({
          id: p.userId,
          username: p.username,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          followerCount: p.user.followerCount,
          isFollowedByMe: followingIds.has(p.userId),
        })),
        nextCursor: null,
      });
      return;
    }

    // type === 'videos': matches on caption text — no full-text search
    // engine yet (architecture kept swappable per brief §11, not built now).
    const videos = await prisma.video.findMany({
      where: {
        status: 'READY',
        visibility: 'PUBLIC',
        caption: { contains: q, mode: 'insensitive' },
        ...(decoded
          ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = videos.length > limit;
    const page = hasMore ? videos.slice(0, limit) : videos;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    const [likedVideoIds, authors, followingIds] = await Promise.all([
      fetchLikedVideoIds(req.user!.id, page.map((v) => v.id)),
      fetchAuthorSummaries([...new Set(page.map((v) => v.userId))]),
      fetchFollowingIds(req.user!.id, [...new Set(page.map((v) => v.userId))]),
    ]);

    res.status(200).json({
      videos: page.map((video) =>
        serializeVideo(video, {
          likedByMe: likedVideoIds.has(video.id),
          author: authors.get(video.userId),
          isFollowedByMe: followingIds.has(video.userId),
        }),
      ),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

searchRouter.get('/search/recent', requireAuth, async (req, res, next) => {
  try {
    const recent = await prisma.recentSearch.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.status(200).json({ recent: recent.map((r) => ({ id: r.id, query: r.query, createdAt: r.createdAt })) });
  } catch (error) {
    next(error);
  }
});

searchRouter.delete('/search/recent', requireAuth, async (req, res, next) => {
  try {
    await prisma.recentSearch.deleteMany({ where: { userId: req.user!.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

searchRouter.delete('/search/recent/:id', requireAuth, async (req, res, next) => {
  try {
    const deleted = await prisma.recentSearch.deleteMany({ where: { id: req.params.id!, userId: req.user!.id } });
    if (deleted.count === 0) {
      throw new AppError('NOT_FOUND', 'Recent search not found');
    }
    res.status(204).send();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      next(new AppError('BAD_REQUEST', 'Invalid id'));
      return;
    }
    next(error);
  }
});
