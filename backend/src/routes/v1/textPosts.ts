import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { extractHashtags, syncTextPostHashtags } from '@/lib/hashtags';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { fetchAuthorSummaries } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { createTextPostSchema, flatCommentSchema, updateTextPostSchema } from '@/schemas/content.schema';
import { reportVideoSchema } from '@/schemas/video.schema';
import { AppError } from '@/utils/AppError';

/** Text posts (Step 6, brief B) — no media, so no processing pipeline and no separate file-serving route; the post row itself is the whole content. */
export const textPostsRouter = Router();

const createLimiter = createAuthRateLimiter(60 * 60 * 1000, 20, 'text-post-create');
const editLimiter = createAuthRateLimiter(60 * 1000, 20, 'text-post-edit');
const likeLimiter = createAuthRateLimiter(60 * 1000, 60, 'text-post-like');
const commentLimiter = createAuthRateLimiter(60 * 1000, 20, 'text-post-comment');
const reportLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'text-post-report');

function serializeTextPost(post: {
  id: string;
  userId: string;
  text: string;
  backgroundStyle: string | null;
  visibility: string;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  shareCount: number;
  createdAt: Date;
  updatedAt: Date;
}, extras: { author?: unknown; likedByMe?: boolean } = {}) {
  return {
    id: post.id,
    userId: post.userId,
    text: post.text,
    backgroundStyle: post.backgroundStyle,
    visibility: post.visibility,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    viewCount: post.viewCount,
    shareCount: post.shareCount,
    author: extras.author,
    likedByMe: extras.likedByMe,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function canViewTextPost(post: { userId: string; visibility: string; deletedAt: Date | null }, requesterId: string): boolean {
  if (post.deletedAt) return false;
  if (post.userId === requesterId) return true;
  return post.visibility === 'PUBLIC';
}

async function loadVisibleTextPost(id: string, requesterId: string) {
  const post = await prisma.textPost.findUnique({ where: { id } });
  if (!post || !canViewTextPost(post, requesterId)) {
    throw new AppError('NOT_FOUND', 'Text post not found');
  }
  return post;
}

textPostsRouter.post('/text-posts', requireAuth, createLimiter, validate({ body: createTextPostSchema }), async (req, res, next) => {
  try {
    const { text, backgroundStyle, visibility } = req.body;
    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.textPost.create({ data: { userId: req.user!.id, text, backgroundStyle, visibility } });
      await syncTextPostHashtags(tx, created.id, extractHashtags(text));
      return created;
    });
    res.status(201).json(serializeTextPost(post));
  } catch (error) {
    next(error);
  }
});

textPostsRouter.get('/text-posts/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await loadVisibleTextPost(req.params.id!, req.user!.id);
    const [author, like] = await Promise.all([
      fetchAuthorSummaries([post.userId]).then((m) => m.get(post.userId)),
      prisma.textPostLike.findUnique({ where: { textPostId_userId: { textPostId: post.id, userId: req.user!.id } } }),
    ]);
    res.status(200).json(serializeTextPost(post, { author, likedByMe: Boolean(like) }));
  } catch (error) {
    next(error);
  }
});

textPostsRouter.patch('/text-posts/:id', requireAuth, editLimiter, validate({ body: updateTextPostSchema }), async (req, res, next) => {
  try {
    const post = await prisma.textPost.findUnique({ where: { id: req.params.id! } });
    if (!post || post.deletedAt) {
      throw new AppError('NOT_FOUND', 'Text post not found');
    }
    if (post.userId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only edit your own text posts');
    }
    const updated = await prisma.textPost.update({ where: { id: post.id }, data: req.body });
    res.status(200).json(serializeTextPost(updated));
  } catch (error) {
    next(error);
  }
});

textPostsRouter.delete('/text-posts/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await prisma.textPost.findUnique({ where: { id: req.params.id! } });
    if (!post || post.deletedAt) {
      throw new AppError('NOT_FOUND', 'Text post not found');
    }
    if (post.userId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only delete your own text posts');
    }
    await prisma.textPost.update({ where: { id: post.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

textPostsRouter.post('/text-posts/:id/like', requireAuth, likeLimiter, async (req, res, next) => {
  try {
    const post = await loadVisibleTextPost(req.params.id!, req.user!.id);
    await prisma.$transaction([
      prisma.textPostLike.create({ data: { textPostId: post.id, userId: req.user!.id } }),
      prisma.textPost.update({ where: { id: post.id }, data: { likeCount: { increment: 1 } } }),
    ]);
    res.status(201).json({ liked: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('CONFLICT', 'You have already liked this text post'));
      return;
    }
    next(error);
  }
});

textPostsRouter.delete('/text-posts/:id/like', requireAuth, likeLimiter, async (req, res, next) => {
  try {
    const post = await loadVisibleTextPost(req.params.id!, req.user!.id);
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.textPostLike.deleteMany({ where: { textPostId: post.id, userId: req.user!.id } });
      if (deleted.count === 0) {
        throw new AppError('NOT_FOUND', 'You have not liked this text post');
      }
      await tx.textPost.update({ where: { id: post.id }, data: { likeCount: { decrement: 1 } } });
    });
    res.status(200).json({ liked: false });
  } catch (error) {
    next(error);
  }
});

textPostsRouter.get('/text-posts/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const post = await loadVisibleTextPost(req.params.id!, req.user!.id);
    const comments = await prisma.textPostComment.findMany({
      where: { textPostId: post.id },
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

textPostsRouter.post(
  '/text-posts/:id/comments',
  requireAuth,
  commentLimiter,
  validate({ body: flatCommentSchema }),
  async (req, res, next) => {
    try {
      const post = await loadVisibleTextPost(req.params.id!, req.user!.id);
      const comment = await prisma.$transaction(async (tx) => {
        const created = await tx.textPostComment.create({ data: { textPostId: post.id, userId: req.user!.id, text: req.body.text } });
        await tx.textPost.update({ where: { id: post.id }, data: { commentCount: { increment: 1 } } });
        return created;
      });
      res.status(201).json({ id: comment.id, textPostId: comment.textPostId, userId: comment.userId, text: comment.text, createdAt: comment.createdAt });
    } catch (error) {
      next(error);
    }
  },
);

textPostsRouter.post(
  '/text-posts/:id/report',
  requireAuth,
  reportLimiter,
  validate({ body: reportVideoSchema }),
  async (req, res, next) => {
    try {
      const post = await loadVisibleTextPost(req.params.id!, req.user!.id);
      const report = await prisma.textPostReport.create({
        data: { textPostId: post.id, reporterId: req.user!.id, reason: req.body.reason, description: req.body.description },
      });
      res.status(201).json({ id: report.id, textPostId: report.textPostId, status: report.status });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'You have already reported this text post'));
        return;
      }
      next(error);
    }
  },
);

textPostsRouter.get('/users/:id/text-posts', requireAuth, async (req, res, next) => {
  try {
    const targetId = req.params.id!;
    const isSelf = targetId === req.user!.id;
    const { cursor, limit: rawLimit } = req.query as { cursor?: string; limit?: string };
    const limit = Math.min(Math.max(Number(rawLimit) || 12, 1), 50);
    const decoded = cursor ? decodeCursor(cursor) : null;

    const posts = await prisma.textPost.findMany({
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
    });

    const hasMore = posts.length > limit;
    const page = hasMore ? posts.slice(0, limit) : posts;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
    const author = (await fetchAuthorSummaries([targetId])).get(targetId);

    res.status(200).json({ textPosts: page.map((p) => serializeTextPost(p, { author })), nextCursor });
  } catch (error) {
    next(error);
  }
});
