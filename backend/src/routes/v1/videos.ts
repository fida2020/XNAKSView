import { randomUUID } from 'crypto';
import path from 'path';

import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { probeVideo } from '@/lib/ffmpeg';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { storage, videoOriginalKey } from '@/lib/storage';
import { streamAsset } from '@/lib/mediaStreaming';
import { canViewVideo, fetchAuthorSummaries, fetchFollowingIds, fetchLikedVideoIds, serializeVideo } from '@/lib/videoAccess';
import { processVideo } from '@/lib/videoProcessing';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { uploadSingleVideo } from '@/middleware/upload';
import { validate } from '@/middleware/validate';
import {
  commentSchema,
  createVideoSchema,
  listCommentsQuerySchema,
  reportVideoSchema,
} from '@/schemas/video.schema';
import { AppError } from '@/utils/AppError';

export const videosRouter = Router();

const uploadLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'video-upload');
const likeLimiter = createAuthRateLimiter(60 * 1000, 60, 'video-like');
const commentLimiter = createAuthRateLimiter(60 * 1000, 20, 'video-comment');
const shareLimiter = createAuthRateLimiter(60 * 1000, 30, 'video-share');
const viewLimiter = createAuthRateLimiter(60 * 1000, 120, 'video-view');
const reportLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'video-report');

const VIEW_DEDUPE_WINDOW_SECONDS = 60;
const SHARE_DEDUPE_WINDOW_SECONDS = 3;

async function loadVisibleVideo(videoId: string, requesterId: string) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video || video.status === 'DELETED' || !canViewVideo(video, requesterId)) {
    throw new AppError('NOT_FOUND', 'Video not found');
  }
  return video;
}

// -----------------------------------------------------------------------
// Upload
// -----------------------------------------------------------------------

videosRouter.post(
  '/videos',
  requireAuth,
  uploadLimiter,
  uploadSingleVideo('video'),
  validate({ body: createVideoSchema }),
  async (req, res, next) => {
    const file = req.file;
    try {
      if (!file) {
        throw new AppError('BAD_REQUEST', 'A "video" file field is required');
      }

      // Real validation, not just trusting the extension/mimetype: this
      // actually decodes the file. A malformed or non-video upload is
      // rejected here, before a Video row is ever created.
      try {
        await probeVideo(file.path);
      } catch (probeError) {
        const { unlink } = await import('fs/promises');
        await unlink(file.path).catch(() => {});
        throw new AppError(
          'BAD_REQUEST',
          `Uploaded file is not a valid video: ${probeError instanceof Error ? probeError.message : 'unknown error'}`,
        );
      }

      const { caption, visibility } = req.body;
      const videoId = randomUUID();
      const originalKey = videoOriginalKey(videoId, path.extname(file.originalname) || '.mp4');

      // Never trust a client-supplied owner/id — the owner is always the
      // authenticated requester, and the id is always server-generated.
      await storage.putFromLocalPath(originalKey, file.path);
      const video = await prisma.video.create({
        data: {
          id: videoId,
          userId: req.user!.id,
          caption,
          visibility,
          originalKey,
          status: 'PROCESSING',
        },
      });

      // Fire-and-forget: the HTTP response doesn't wait on transcoding.
      // Errors are captured inside processVideo itself (-> status FAILED),
      // this catch is only a last-resort safety net.
      void processVideo(video.id, video.originalKey).catch((error: unknown) => {
        logger.error({ err: error, videoId: video.id }, 'Unhandled error kicking off video processing');
      });

      res.status(202).json(serializeVideo(video));
    } catch (error) {
      next(error);
    }
  },
);

// -----------------------------------------------------------------------
// Detail / delete
// -----------------------------------------------------------------------

videosRouter.get('/videos/:id', requireAuth, async (req, res, next) => {
  try {
    const video = await loadVisibleVideo(req.params.id!, req.user!.id);
    const [likedVideoIds, authors, followingIds] = await Promise.all([
      fetchLikedVideoIds(req.user!.id, [video.id]),
      fetchAuthorSummaries([video.userId]),
      fetchFollowingIds(req.user!.id, [video.userId]),
    ]);
    res.status(200).json(
      serializeVideo(video, {
        likedByMe: likedVideoIds.has(video.id),
        author: authors.get(video.userId),
        isFollowedByMe: followingIds.has(video.userId),
      }),
    );
  } catch (error) {
    next(error);
  }
});

videosRouter.delete('/videos/:id', requireAuth, async (req, res, next) => {
  try {
    const video = await prisma.video.findUnique({ where: { id: req.params.id! } });
    if (!video || video.status === 'DELETED') {
      throw new AppError('NOT_FOUND', 'Video not found');
    }
    if (video.userId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only delete your own videos');
    }

    await prisma.video.update({ where: { id: video.id }, data: { status: 'DELETED' } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// File serving (local storage is proxied through the API; a future
// object-storage driver would instead redirect to `storage.getPublicUrl`)
// -----------------------------------------------------------------------

videosRouter.get('/videos/:id/file', requireAuth, async (req, res, next) => {
  try {
    const video = await loadVisibleVideo(req.params.id!, req.user!.id);
    await streamAsset(req, res, next, video.playbackKey, 'video/mp4');
  } catch (error) {
    next(error);
  }
});

videosRouter.get('/videos/:id/thumbnail', requireAuth, async (req, res, next) => {
  try {
    const video = await loadVisibleVideo(req.params.id!, req.user!.id);
    await streamAsset(req, res, next, video.thumbnailKey, 'image/jpeg');
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Likes
// -----------------------------------------------------------------------

videosRouter.post('/videos/:id/like', requireAuth, likeLimiter, async (req, res, next) => {
  try {
    const video = await loadVisibleVideo(req.params.id!, req.user!.id);

    await prisma.$transaction(async (tx) => {
      await tx.videoLike.create({ data: { videoId: video.id, userId: req.user!.id } });
      await tx.video.update({ where: { id: video.id }, data: { likeCount: { increment: 1 } } });
    });

    res.status(201).json({ liked: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('CONFLICT', 'You have already liked this video'));
      return;
    }
    next(error);
  }
});

videosRouter.delete('/videos/:id/like', requireAuth, likeLimiter, async (req, res, next) => {
  try {
    const video = await loadVisibleVideo(req.params.id!, req.user!.id);

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.videoLike.deleteMany({ where: { videoId: video.id, userId: req.user!.id } });
      if (deleted.count === 0) {
        throw new AppError('NOT_FOUND', 'You have not liked this video');
      }
      await tx.video.update({ where: { id: video.id }, data: { likeCount: { decrement: 1 } } });
    });

    res.status(200).json({ liked: false });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------

videosRouter.get(
  '/videos/:id/comments',
  requireAuth,
  validate({ query: listCommentsQuerySchema }),
  async (req, res, next) => {
    try {
      const video = await loadVisibleVideo(req.params.id!, req.user!.id);
      const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };

      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      const comments = await prisma.videoComment.findMany({
        where: {
          videoId: video.id,
          ...(decoded
            ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { user: { select: { id: true, profile: { select: { username: true, displayName: true, avatarUrl: true } } } } },
      });

      const hasMore = comments.length > limit;
      const page = hasMore ? comments.slice(0, limit) : comments;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      res.status(200).json({
        comments: page.map((comment) => ({
          id: comment.id,
          videoId: comment.videoId,
          userId: comment.userId,
          username: comment.user.profile?.username ?? null,
          displayName: comment.user.profile?.displayName ?? null,
          avatarUrl: comment.user.profile?.avatarUrl ?? null,
          text: comment.text,
          createdAt: comment.createdAt,
        })),
        nextCursor,
      });
    } catch (error) {
      next(error);
    }
  },
);

videosRouter.post(
  '/videos/:id/comments',
  requireAuth,
  commentLimiter,
  validate({ body: commentSchema }),
  async (req, res, next) => {
    try {
      const video = await loadVisibleVideo(req.params.id!, req.user!.id);

      const comment = await prisma.$transaction(async (tx) => {
        const created = await tx.videoComment.create({
          data: { videoId: video.id, userId: req.user!.id, text: req.body.text },
        });
        await tx.video.update({ where: { id: video.id }, data: { commentCount: { increment: 1 } } });
        return created;
      });

      res.status(201).json({
        id: comment.id,
        videoId: comment.videoId,
        userId: comment.userId,
        text: comment.text,
        createdAt: comment.createdAt,
      });
    } catch (error) {
      next(error);
    }
  },
);

videosRouter.delete('/comments/:id', requireAuth, async (req, res, next) => {
  try {
    const comment = await prisma.videoComment.findUnique({ where: { id: req.params.id! } });
    if (!comment) {
      throw new AppError('NOT_FOUND', 'Comment not found');
    }
    if (comment.userId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only delete your own comments');
    }

    await prisma.$transaction(async (tx) => {
      await tx.videoComment.delete({ where: { id: comment.id } });
      await tx.video.update({ where: { id: comment.videoId }, data: { commentCount: { decrement: 1 } } });
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Shares
// -----------------------------------------------------------------------

videosRouter.post('/videos/:id/share', requireAuth, shareLimiter, async (req, res, next) => {
  try {
    const video = await loadVisibleVideo(req.params.id!, req.user!.id);

    // Only guards against accidental duplicate requests (double-tap,
    // client retry) in a short window — deliberately not a per-user cap,
    // since repeatedly sharing the same video to different people over
    // time is legitimate and shouldn't be capped.
    const dedupeKey = `video:share:${video.id}:${req.user!.id}`;
    // SET ... NX returns null when the key already exists (i.e. this is a
    // duplicate within the dedupe window) and 'OK' when it didn't.
    const wasNewKey = await redis.set(dedupeKey, '1', 'EX', SHARE_DEDUPE_WINDOW_SECONDS, 'NX');
    if (wasNewKey === null) {
      const current = await prisma.video.findUniqueOrThrow({ where: { id: video.id }, select: { shareCount: true } });
      res.status(200).json({ shareCount: current.shareCount });
      return;
    }

    const updated = await prisma.video.update({
      where: { id: video.id },
      data: { shareCount: { increment: 1 } },
      select: { shareCount: true },
    });

    res.status(201).json({ shareCount: updated.shareCount });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Views
// -----------------------------------------------------------------------

videosRouter.post('/videos/:id/view', requireAuth, viewLimiter, async (req, res, next) => {
  try {
    const video = await loadVisibleVideo(req.params.id!, req.user!.id);

    const dedupeKey = `video:view:${video.id}:${req.user!.id}`;
    const wasNewKey = await redis.set(dedupeKey, '1', 'EX', VIEW_DEDUPE_WINDOW_SECONDS, 'NX');

    if (wasNewKey === null) {
      const current = await prisma.video.findUniqueOrThrow({ where: { id: video.id }, select: { viewCount: true } });
      res.status(200).json({ counted: false, viewCount: current.viewCount });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.videoView.create({ data: { videoId: video.id, userId: req.user!.id } });
      return tx.video.update({
        where: { id: video.id },
        data: { viewCount: { increment: 1 } },
        select: { viewCount: true },
      });
    });

    res.status(201).json({ counted: true, viewCount: updated.viewCount });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------

videosRouter.post(
  '/videos/:id/report',
  requireAuth,
  reportLimiter,
  validate({ body: reportVideoSchema }),
  async (req, res, next) => {
    try {
      const video = await prisma.video.findUnique({ where: { id: req.params.id! } });
      if (!video || video.status === 'DELETED') {
        throw new AppError('NOT_FOUND', 'Video not found');
      }

      const report = await prisma.videoReport.create({
        data: {
          videoId: video.id,
          reporterId: req.user!.id,
          reason: req.body.reason,
          description: req.body.description,
        },
      });

      res.status(201).json({
        id: report.id,
        videoId: report.videoId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'You have already reported this video'));
        return;
      }
      next(error);
    }
  },
);
