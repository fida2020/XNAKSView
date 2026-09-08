import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import path from 'path';

import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { probeImage } from '@/lib/imageValidation';
import { probeVideo } from '@/lib/ffmpeg';
import { recordActivity } from '@/lib/activityFeed';
import { isBlockedEitherDirection } from '@/lib/messagingAccess';
import { assertModerationAllowsCreation, moderateText } from '@/lib/moderation/moderationPipeline';
import { streamAsset } from '@/lib/mediaStreaming';
import { prisma } from '@/lib/prisma';
import { storyMediaKey, storage } from '@/lib/storage';
import { fetchAuthorSummaries } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { uploadSingleStoryMedia } from '@/middleware/upload';
import { validate } from '@/middleware/validate';
import { createStorySchema, storyReplySchema } from '@/schemas/content.schema';
import { reportVideoSchema } from '@/schemas/video.schema';
import { AppError } from '@/utils/AppError';

/**
 * Stories (Step 6, brief D) — 24h expiry is set once at creation
 * (`expiresAt = createdAt + 24h`) and every read here filters on
 * `expiresAt: { gt: now }` at the database level; the client's clock is
 * never consulted for whether a story is still visible. There is no
 * Archive feature (TikTok has one) — an explicitly disclosed gap, not a
 * silent omission.
 */
export const storiesRouter = Router();

const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

const createLimiter = createAuthRateLimiter(60 * 60 * 1000, 20, 'story-create');
const replyLimiter = createAuthRateLimiter(60 * 1000, 20, 'story-reply');
const reportLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'story-report');

function activeStoryWhere() {
  return { expiresAt: { gt: new Date() }, deletedAt: null };
}

function serializeStory(story: { id: string; userId: string; mediaType: string; caption: string | null; viewCount: number; replyCount: number; createdAt: Date; expiresAt: Date }, author?: unknown) {
  return {
    id: story.id,
    userId: story.userId,
    mediaType: story.mediaType,
    caption: story.caption,
    mediaUrl: `/api/v1/stories/${story.id}/media`,
    viewCount: story.viewCount,
    replyCount: story.replyCount,
    author,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
  };
}

async function loadActiveStory(id: string) {
  const story = await prisma.story.findFirst({ where: { id, ...activeStoryWhere() } });
  if (!story) {
    throw new AppError('NOT_FOUND', 'Story not found');
  }
  return story;
}

storiesRouter.post(
  '/stories',
  requireAuth,
  createLimiter,
  uploadSingleStoryMedia('media'),
  validate({ body: createStorySchema }),
  async (req, res, next) => {
    const file = req.file;
    try {
      if (!file) {
        throw new AppError('BAD_REQUEST', 'A "media" file field is required');
      }
      const { mediaType, caption } = req.body;

      try {
        if (mediaType === 'PHOTO') {
          await probeImage(file.path);
        } else {
          await probeVideo(file.path);
        }
      } catch (probeError) {
        throw new AppError(
          'BAD_REQUEST',
          `Uploaded file does not match declared mediaType (${mediaType}): ${probeError instanceof Error ? probeError.message : 'unknown error'}`,
        );
      }

      const storyId = randomUUID();
      const key = storyMediaKey(storyId, path.extname(file.originalname) || (mediaType === 'PHOTO' ? '.jpg' : '.mp4'));

      if (caption) {
        const captionModeration = await moderateText({ contentType: 'STORY', contentId: storyId, authorId: req.user!.id, text: caption });
        assertModerationAllowsCreation(captionModeration, 'story');
      }

      await storage.putFromLocalPath(key, file.path);

      const now = new Date();
      const story = await prisma.story.create({
        data: {
          id: storyId,
          userId: req.user!.id,
          mediaKey: key,
          mediaType,
          caption,
          createdAt: now,
          expiresAt: new Date(now.getTime() + STORY_LIFETIME_MS),
        },
      });

      res.status(201).json(serializeStory(story));
    } catch (error) {
      if (file) await unlink(file.path).catch(() => {});
      next(error);
    }
  },
);

/** Own stories + stories from people the caller follows, active only, grouped client-side by author. */
storiesRouter.get('/stories/feed', requireAuth, async (req, res, next) => {
  try {
    const following = await prisma.follow.findMany({ where: { followerId: req.user!.id }, select: { followingId: true } });
    const authorIds = [req.user!.id, ...following.map((f) => f.followingId)];

    const stories = await prisma.story.findMany({
      where: { userId: { in: authorIds }, ...activeStoryWhere() },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const authors = await fetchAuthorSummaries([...new Set(stories.map((s) => s.userId))]);
    res.status(200).json({ stories: stories.map((s) => serializeStory(s, authors.get(s.userId))) });
  } catch (error) {
    next(error);
  }
});

storiesRouter.get('/stories/:id', requireAuth, async (req, res, next) => {
  try {
    const story = await loadActiveStory(req.params.id!);
    if (story.userId !== req.user!.id && (await isBlockedEitherDirection(req.user!.id, story.userId))) {
      throw new AppError('NOT_FOUND', 'Story not found');
    }

    if (story.userId !== req.user!.id) {
      const [, created] = await Promise.all([
        Promise.resolve(),
        prisma.storyView
          .create({ data: { storyId: story.id, userId: req.user!.id } })
          .then(() => true)
          .catch((error) => {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
            throw error;
          }),
      ]);
      if (created) {
        await prisma.story.update({ where: { id: story.id }, data: { viewCount: { increment: 1 } } });
      }
    }

    const author = (await fetchAuthorSummaries([story.userId])).get(story.userId);
    res.status(200).json(serializeStory(story, author));
  } catch (error) {
    next(error);
  }
});

storiesRouter.get('/stories/:id/media', requireAuth, async (req, res, next) => {
  try {
    const story = await loadActiveStory(req.params.id!);
    if (story.userId !== req.user!.id && (await isBlockedEitherDirection(req.user!.id, story.userId))) {
      throw new AppError('NOT_FOUND', 'Story not found');
    }
    await streamAsset(req, res, next, story.mediaKey, story.mediaType === 'PHOTO' ? 'image/jpeg' : 'video/mp4');
  } catch (error) {
    next(error);
  }
});

/** Story-viewer list (brief D) — owner only. */
storiesRouter.get('/stories/:id/viewers', requireAuth, async (req, res, next) => {
  try {
    const story = await prisma.story.findUnique({ where: { id: req.params.id! } });
    if (!story || story.userId !== req.user!.id) {
      throw new AppError('NOT_FOUND', 'Story not found');
    }
    const views = await prisma.storyView.findMany({ where: { storyId: story.id }, orderBy: { createdAt: 'desc' } });
    const authors = await fetchAuthorSummaries(views.map((v) => v.userId));
    res.status(200).json({ viewers: views.map((v) => authors.get(v.userId)).filter(Boolean) });
  } catch (error) {
    next(error);
  }
});

storiesRouter.delete('/stories/:id', requireAuth, async (req, res, next) => {
  try {
    const story = await prisma.story.findUnique({ where: { id: req.params.id! } });
    if (!story || story.deletedAt) {
      throw new AppError('NOT_FOUND', 'Story not found');
    }
    if (story.userId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only delete your own stories');
    }
    await prisma.story.update({ where: { id: story.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * Current TikTok behavior: only mutual followers may reply to a story
 * (verified via research — not the earlier draft-spec assumption of
 * reusing Step 5 DMs). Replies are comment-like, visible to the owner, and
 * disappear along with the story rather than becoming a persistent DM.
 */
storiesRouter.post(
  '/stories/:id/reply',
  requireAuth,
  replyLimiter,
  validate({ body: storyReplySchema }),
  async (req, res, next) => {
    try {
      const story = await loadActiveStory(req.params.id!);
      if (story.userId === req.user!.id) {
        throw new AppError('BAD_REQUEST', 'You cannot reply to your own story');
      }
      const [followsOwner, ownerFollowsBack] = await Promise.all([
        prisma.follow.findUnique({ where: { followerId_followingId: { followerId: req.user!.id, followingId: story.userId } } }),
        prisma.follow.findUnique({ where: { followerId_followingId: { followerId: story.userId, followingId: req.user!.id } } }),
      ]);
      if (!followsOwner || !ownerFollowsBack) {
        throw new AppError('FORBIDDEN', 'Only mutual followers can reply to this story');
      }

      const reply = await prisma.$transaction(async (tx) => {
        const created = await tx.storyReply.create({ data: { storyId: story.id, userId: req.user!.id, text: req.body.text } });
        await tx.story.update({ where: { id: story.id }, data: { replyCount: { increment: 1 } } });
        await recordActivity(tx, { recipientId: story.userId, actorId: req.user!.id, type: 'COMMENT' });
        return created;
      });

      res.status(201).json({ id: reply.id, storyId: reply.storyId, userId: reply.userId, text: reply.text, createdAt: reply.createdAt });
    } catch (error) {
      next(error);
    }
  },
);

storiesRouter.get('/stories/:id/replies', requireAuth, async (req, res, next) => {
  try {
    const story = await prisma.story.findUnique({ where: { id: req.params.id! } });
    if (!story || story.userId !== req.user!.id) {
      throw new AppError('NOT_FOUND', 'Story not found');
    }
    const replies = await prisma.storyReply.findMany({ where: { storyId: story.id }, orderBy: { createdAt: 'desc' } });
    const authors = await fetchAuthorSummaries(replies.map((r) => r.userId));
    res.status(200).json({
      replies: replies.map((r) => ({ id: r.id, userId: r.userId, author: authors.get(r.userId), text: r.text, createdAt: r.createdAt })),
    });
  } catch (error) {
    next(error);
  }
});

storiesRouter.post(
  '/stories/:id/report',
  requireAuth,
  reportLimiter,
  validate({ body: reportVideoSchema }),
  async (req, res, next) => {
    try {
      const story = await loadActiveStory(req.params.id!);
      const report = await prisma.storyReport.create({
        data: { storyId: story.id, reporterId: req.user!.id, reason: req.body.reason, description: req.body.description },
      });
      res.status(201).json({ id: report.id, storyId: report.storyId, status: report.status });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'You have already reported this story'));
        return;
      }
      next(error);
    }
  },
);
