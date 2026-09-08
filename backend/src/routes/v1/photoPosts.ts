import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import path from 'path';

import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { onContentPublished } from '@/lib/gamification/events';
import { extractHashtags, syncPhotoPostHashtags } from '@/lib/hashtags';
import { probeImage } from '@/lib/imageValidation';
import { assertModerationAllowsCreation, moderateImage, moderateText } from '@/lib/moderation/moderationPipeline';
import { streamAsset } from '@/lib/mediaStreaming';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { photoPostAssetKey, storage } from '@/lib/storage';
import { fetchAuthorSummaries } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { uploadMultipleImages } from '@/middleware/upload';
import { validate } from '@/middleware/validate';
import { createPhotoPostSchema, flatCommentSchema, updatePhotoPostSchema } from '@/schemas/content.schema';
import { reportVideoSchema } from '@/schemas/video.schema';
import { AppError } from '@/utils/AppError';

/**
 * Photo posts / carousels (Step 6, brief A) — TikTok's current "Photo Mode":
 * 2-35 swipeable images sharing one caption/sound, manually swiped (not
 * auto-playing like the old slideshow format). A separate content type from
 * Video, not a Video with an image "playback" — there is no transcoding
 * pipeline here, so images are validated (real magic bytes, never trusting
 * the client mimetype) and stored directly.
 */
export const photoPostsRouter = Router();

const MIN_PHOTOS = 2;
const MAX_PHOTOS = 35;

const uploadLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'photo-post-upload');
const editLimiter = createAuthRateLimiter(60 * 1000, 20, 'photo-post-edit');
const likeLimiter = createAuthRateLimiter(60 * 1000, 60, 'photo-post-like');
const commentLimiter = createAuthRateLimiter(60 * 1000, 20, 'photo-post-comment');
const reportLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'photo-post-report');

function serializePhotoPost(post: {
  id: string;
  userId: string;
  caption: string | null;
  visibility: string;
  allowDownload: boolean;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  shareCount: number;
  createdAt: Date;
  updatedAt: Date;
}, extras: { author?: unknown; likedByMe?: boolean; photos?: { id: string; position: number }[] } = {}) {
  return {
    id: post.id,
    userId: post.userId,
    caption: post.caption,
    visibility: post.visibility,
    allowDownload: post.allowDownload,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    viewCount: post.viewCount,
    shareCount: post.shareCount,
    photos: extras.photos?.map((p) => ({ id: p.id, url: `/api/v1/photo-posts/${post.id}/photos/${p.id}` })),
    author: extras.author,
    likedByMe: extras.likedByMe,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function canViewPhotoPost(post: { userId: string; visibility: string; deletedAt: Date | null }, requesterId: string): boolean {
  if (post.deletedAt) return false;
  if (post.userId === requesterId) return true;
  return post.visibility === 'PUBLIC';
}

async function loadVisiblePhotoPost(id: string, requesterId: string) {
  const post = await prisma.photoPost.findUnique({ where: { id }, include: { photos: { orderBy: { position: 'asc' } } } });
  if (!post || !canViewPhotoPost(post, requesterId)) {
    throw new AppError('NOT_FOUND', 'Photo post not found');
  }
  return post;
}

photoPostsRouter.post(
  '/photo-posts',
  requireAuth,
  uploadLimiter,
  uploadMultipleImages('photos', MAX_PHOTOS),
  validate({ body: createPhotoPostSchema }),
  async (req, res, next) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
      if (files.length < MIN_PHOTOS || files.length > MAX_PHOTOS) {
        throw new AppError('BAD_REQUEST', `A photo post needs between ${MIN_PHOTOS} and ${MAX_PHOTOS} images`);
      }

      for (const file of files) {
        try {
          await probeImage(file.path);
        } catch (probeError) {
          throw new AppError('BAD_REQUEST', `One of the uploaded files is not a valid image: ${probeError instanceof Error ? probeError.message : 'unknown error'}`);
        }
      }

      const { caption, visibility, allowDownload } = req.body;
      const postId = randomUUID();
      const keys = await Promise.all(
        files.map(async (file, index) => {
          const assetId = randomUUID();
          const key = photoPostAssetKey(postId, assetId, path.extname(file.originalname) || '.jpg');
          await storage.putFromLocalPath(key, file.path);
          return { assetId, key, position: index };
        }),
      );

      // Step 10 — caption text + per-image moderation, before the row
      // exists. Image moderation needs a real, vendor-fetchable URL
      // (production object storage with a public/signed URL); this local
      // dev storage's key is passed as a placeholder reference so the
      // audit trail is still honest ("UNCONFIGURED"/not analyzed) rather
      // than silently skipped — see moderationPipeline.ts's doc comment.
      if (caption) {
        const captionModeration = await moderateText({ contentType: 'PHOTO_POST', contentId: postId, authorId: req.user!.id, text: caption });
        assertModerationAllowsCreation(captionModeration, 'post');
      }
      for (const { key } of keys) {
        const imageModeration = await moderateImage({ contentType: 'PHOTO_POST', contentId: postId, authorId: req.user!.id, imageUrl: key });
        assertModerationAllowsCreation(imageModeration, 'post');
      }

      const post = await prisma.$transaction(async (tx) => {
        const created = await tx.photoPost.create({
          data: { id: postId, userId: req.user!.id, caption, visibility, allowDownload },
        });
        await tx.photoPostAsset.createMany({
          data: keys.map(({ assetId, key, position }) => ({ id: assetId, photoPostId: postId, key, position })),
        });
        await syncPhotoPostHashtags(tx, postId, extractHashtags(caption));
        return created;
      });

      if (post.visibility === 'PUBLIC') onContentPublished(post.userId, 'PHOTO_POST', post.id);

      const photos = await prisma.photoPostAsset.findMany({ where: { photoPostId: post.id }, orderBy: { position: 'asc' } });
      res.status(201).json(serializePhotoPost(post, { photos }));
    } catch (error) {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
      next(error);
    }
  },
);

photoPostsRouter.get('/photo-posts/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await loadVisiblePhotoPost(req.params.id!, req.user!.id);
    const [author, like] = await Promise.all([
      fetchAuthorSummaries([post.userId]).then((m) => m.get(post.userId)),
      prisma.photoPostLike.findUnique({ where: { photoPostId_userId: { photoPostId: post.id, userId: req.user!.id } } }),
    ]);
    res.status(200).json(serializePhotoPost(post, { author, likedByMe: Boolean(like), photos: post.photos }));
  } catch (error) {
    next(error);
  }
});

photoPostsRouter.get('/photo-posts/:id/photos/:assetId', requireAuth, async (req, res, next) => {
  try {
    const post = await loadVisiblePhotoPost(req.params.id!, req.user!.id);
    const asset = post.photos.find((p) => p.id === req.params.assetId);
    if (!asset) {
      throw new AppError('NOT_FOUND', 'Photo not found');
    }
    await streamAsset(req, res, next, asset.key, 'image/jpeg');
  } catch (error) {
    next(error);
  }
});

photoPostsRouter.patch(
  '/photo-posts/:id',
  requireAuth,
  editLimiter,
  validate({ body: updatePhotoPostSchema }),
  async (req, res, next) => {
    try {
      const post = await prisma.photoPost.findUnique({ where: { id: req.params.id! } });
      if (!post || post.deletedAt) {
        throw new AppError('NOT_FOUND', 'Photo post not found');
      }
      if (post.userId !== req.user!.id) {
        throw new AppError('FORBIDDEN', 'You can only edit your own photo posts');
      }
      const updated = await prisma.photoPost.update({ where: { id: post.id }, data: req.body });
      res.status(200).json(serializePhotoPost(updated));
    } catch (error) {
      next(error);
    }
  },
);

photoPostsRouter.delete('/photo-posts/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await prisma.photoPost.findUnique({ where: { id: req.params.id! } });
    if (!post || post.deletedAt) {
      throw new AppError('NOT_FOUND', 'Photo post not found');
    }
    if (post.userId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only delete your own photo posts');
    }
    await prisma.photoPost.update({ where: { id: post.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

photoPostsRouter.post('/photo-posts/:id/like', requireAuth, likeLimiter, async (req, res, next) => {
  try {
    const post = await loadVisiblePhotoPost(req.params.id!, req.user!.id);
    await prisma.$transaction([
      prisma.photoPostLike.create({ data: { photoPostId: post.id, userId: req.user!.id } }),
      prisma.photoPost.update({ where: { id: post.id }, data: { likeCount: { increment: 1 } } }),
    ]);
    res.status(201).json({ liked: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('CONFLICT', 'You have already liked this photo post'));
      return;
    }
    next(error);
  }
});

photoPostsRouter.delete('/photo-posts/:id/like', requireAuth, likeLimiter, async (req, res, next) => {
  try {
    const post = await loadVisiblePhotoPost(req.params.id!, req.user!.id);
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.photoPostLike.deleteMany({ where: { photoPostId: post.id, userId: req.user!.id } });
      if (deleted.count === 0) {
        throw new AppError('NOT_FOUND', 'You have not liked this photo post');
      }
      await tx.photoPost.update({ where: { id: post.id }, data: { likeCount: { decrement: 1 } } });
    });
    res.status(200).json({ liked: false });
  } catch (error) {
    next(error);
  }
});

photoPostsRouter.get('/photo-posts/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const post = await loadVisiblePhotoPost(req.params.id!, req.user!.id);
    const comments = await prisma.photoPostComment.findMany({
      where: { photoPostId: post.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { profile: { select: { username: true, displayName: true, avatarUrl: true } } } } },
    });
    res.status(200).json({
      comments: comments.map((c) => ({
        id: c.id,
        userId: c.userId,
        username: c.user.profile?.username ?? null,
        displayName: c.user.profile?.displayName ?? null,
        avatarUrl: c.user.profile?.avatarUrl ?? null,
        text: c.text,
        createdAt: c.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

photoPostsRouter.post(
  '/photo-posts/:id/comments',
  requireAuth,
  commentLimiter,
  validate({ body: flatCommentSchema }),
  async (req, res, next) => {
    try {
      const post = await loadVisiblePhotoPost(req.params.id!, req.user!.id);

      const commentId = randomUUID();
      const moderation = await moderateText({ contentType: 'PHOTO_POST_COMMENT', contentId: commentId, authorId: req.user!.id, text: req.body.text });
      assertModerationAllowsCreation(moderation, 'comment');

      const comment = await prisma.$transaction(async (tx) => {
        const created = await tx.photoPostComment.create({ data: { id: commentId, photoPostId: post.id, userId: req.user!.id, text: req.body.text } });
        await tx.photoPost.update({ where: { id: post.id }, data: { commentCount: { increment: 1 } } });
        return created;
      });
      res.status(201).json({ id: comment.id, photoPostId: comment.photoPostId, userId: comment.userId, text: comment.text, createdAt: comment.createdAt });
    } catch (error) {
      next(error);
    }
  },
);

photoPostsRouter.post(
  '/photo-posts/:id/report',
  requireAuth,
  reportLimiter,
  validate({ body: reportVideoSchema }),
  async (req, res, next) => {
    try {
      const post = await loadVisiblePhotoPost(req.params.id!, req.user!.id);
      const report = await prisma.photoPostReport.create({
        data: { photoPostId: post.id, reporterId: req.user!.id, reason: req.body.reason, description: req.body.description },
      });
      res.status(201).json({ id: report.id, photoPostId: report.photoPostId, status: report.status });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'You have already reported this photo post'));
        return;
      }
      next(error);
    }
  },
);

photoPostsRouter.get(
  '/users/:id/photo-posts',
  requireAuth,
  async (req, res, next) => {
    try {
      const targetId = req.params.id!;
      const isSelf = targetId === req.user!.id;
      const { cursor, limit: rawLimit } = req.query as { cursor?: string; limit?: string };
      const limit = Math.min(Math.max(Number(rawLimit) || 12, 1), 50);
      const decoded = cursor ? decodeCursor(cursor) : null;

      const posts = await prisma.photoPost.findMany({
        where: {
          userId: targetId,
          deletedAt: null,
          ...(isSelf ? {} : { visibility: 'PUBLIC' }),
          ...(decoded
            ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { photos: { orderBy: { position: 'asc' } } },
      });

      const hasMore = posts.length > limit;
      const page = hasMore ? posts.slice(0, limit) : posts;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
      const author = (await fetchAuthorSummaries([targetId])).get(targetId);

      res.status(200).json({ photoPosts: page.map((p) => serializePhotoPost(p, { author, photos: p.photos })), nextCursor });
    } catch (error) {
      next(error);
    }
  },
);
