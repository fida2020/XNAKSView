import { Router } from 'express';

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
import { validate } from '@/middleware/validate';
import { feedQuerySchema } from '@/schemas/video.schema';
import { AppError } from '@/utils/AppError';

export const feedRouter = Router();

/**
 * Newest-first, cursor-paginated feed of publicly visible, fully-processed
 * videos. Cursor is an opaque (createdAt, id) pair rather than an OFFSET —
 * offset pagination re-numbers every row whenever a new video is inserted
 * ahead of the page you're on, which either duplicates or skips videos
 * across page fetches; a cursor tied to a specific row doesn't have that
 * problem. `id` breaks ties between videos with an identical `createdAt`.
 */
feedRouter.get('/feed', requireAuth, validate({ query: feedQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };

    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const videos = await prisma.video.findMany({
      where: {
        status: 'READY',
        visibility: 'PUBLIC',
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
    });

    const hasMore = videos.length > limit;
    const page = hasMore ? videos.slice(0, limit) : videos;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    const videoIds = page.map((video) => video.id);
    const authorIds = [...new Set(page.map((video) => video.userId))];
    const [likedVideoIds, authors, followingIds, repostedVideoIds, favoritedVideoIds] = await Promise.all([
      fetchLikedVideoIds(req.user!.id, videoIds),
      fetchAuthorSummaries(authorIds),
      fetchFollowingIds(req.user!.id, authorIds),
      fetchRepostedVideoIds(req.user!.id, videoIds),
      fetchFavoritedVideoIds(req.user!.id, videoIds),
    ]);

    res.status(200).json({
      videos: page.map((video) =>
        serializeVideo(video, {
          likedByMe: likedVideoIds.has(video.id),
          author: authors.get(video.userId),
          isFollowedByMe: followingIds.has(video.userId),
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
