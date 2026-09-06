import { Router } from 'express';

import { normalizeHashtag } from '@/lib/hashtags';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { fetchAuthorSummaries, fetchFollowingIds, fetchLikedVideoIds, serializeVideo } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { feedQuerySchema } from '@/schemas/video.schema';
import { searchHashtagsQuerySchema } from '@/schemas/discovery.schema';
import { AppError } from '@/utils/AppError';

export const hashtagsRouter = Router();

hashtagsRouter.get('/hashtags/search', requireAuth, validate({ query: searchHashtagsQuerySchema }), async (req, res, next) => {
  try {
    const { q, limit } = req.query as unknown as { q: string; limit: number };
    const hashtags = await prisma.hashtag.findMany({
      where: { tag: { contains: normalizeHashtag(q), mode: 'insensitive' } },
      orderBy: { postCount: 'desc' },
      take: limit,
    });
    res.status(200).json({ hashtags: hashtags.map((h) => ({ tag: h.tag, postCount: h.postCount })) });
  } catch (error) {
    next(error);
  }
});

hashtagsRouter.get('/hashtags/:tag', requireAuth, async (req, res, next) => {
  try {
    const tag = normalizeHashtag(req.params.tag!);
    const hashtag = await prisma.hashtag.findUnique({ where: { tag } });
    if (!hashtag) {
      res.status(200).json({ tag, postCount: 0, exists: false });
      return;
    }
    res.status(200).json({ tag: hashtag.tag, postCount: hashtag.postCount, exists: true });
  } catch (error) {
    next(error);
  }
});

hashtagsRouter.get(
  '/hashtags/:tag/videos',
  requireAuth,
  validate({ query: feedQuerySchema }),
  async (req, res, next) => {
    try {
      const tag = normalizeHashtag(req.params.tag!);
      const hashtag = await prisma.hashtag.findUnique({ where: { tag } });
      if (!hashtag) {
        res.status(200).json({ videos: [], nextCursor: null });
        return;
      }

      const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      const links = await prisma.videoHashtag.findMany({
        where: {
          hashtagId: hashtag.id,
          video: { status: 'READY', visibility: 'PUBLIC' },
          ...(decoded
            ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { video: true },
      });

      const hasMore = links.length > limit;
      const page = hasMore ? links.slice(0, limit) : links;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      const videos = page.map((l) => l.video);
      const [likedVideoIds, authors, followingIds] = await Promise.all([
        fetchLikedVideoIds(req.user!.id, videos.map((v) => v.id)),
        fetchAuthorSummaries([...new Set(videos.map((v) => v.userId))]),
        fetchFollowingIds(req.user!.id, [...new Set(videos.map((v) => v.userId))]),
      ]);

      res.status(200).json({
        videos: videos.map((video) =>
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
  },
);
