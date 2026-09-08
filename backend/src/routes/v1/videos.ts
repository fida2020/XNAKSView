import { randomUUID } from 'crypto';
import path from 'path';

import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { recordActivity } from '@/lib/activityFeed';
import { extractHashtags, extractMentionUsernames, syncVideoHashtags, syncVideoMentions } from '@/lib/hashtags';
import { isBlockedEitherDirection } from '@/lib/messagingAccess';
import { assertModerationAllowsCreation, moderateText } from '@/lib/moderation/moderationPipeline';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { probeAudio, probeVideo } from '@/lib/ffmpeg';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { storage, videoOriginalKey, videoVoiceoverKey } from '@/lib/storage';
import { streamAsset } from '@/lib/mediaStreaming';
import {
  canViewVideo,
  fetchAuthorSummaries,
  fetchFavoritedVideoIds,
  fetchFollowingIds,
  fetchLikedVideoIds,
  fetchRepostedVideoIds,
  serializeVideo,
} from '@/lib/videoAccess';
import { processVideo } from '@/lib/videoProcessing';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { uploadSingleVideo, uploadVideoWithVoiceover } from '@/middleware/upload';
import { validate } from '@/middleware/validate';
import { createAddYoursSchema } from '@/schemas/content.schema';
import {
  commentReportSchema,
  commentSchema,
  createDuetSchema,
  createStitchSchema,
  createVideoSchema,
  feedQuerySchema,
  listCommentsQuerySchema,
  parseVideoEditSpec,
  reportVideoSchema,
  updateVideoSchema,
  videoEditSpecSchema,
} from '@/schemas/video.schema';
import { isEpidemicSoundConfigured } from '@/lib/epidemicSound';
import { AppError } from '@/utils/AppError';

export const videosRouter = Router();

const uploadLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'video-upload');
const duetStitchLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'video-duet-stitch');
const likeLimiter = createAuthRateLimiter(60 * 1000, 60, 'video-like');
const commentLimiter = createAuthRateLimiter(60 * 1000, 20, 'video-comment');
const commentLikeLimiter = createAuthRateLimiter(60 * 1000, 60, 'video-comment-like');
const commentReportLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'video-comment-report');
const shareLimiter = createAuthRateLimiter(60 * 1000, 30, 'video-share');
const viewLimiter = createAuthRateLimiter(60 * 1000, 120, 'video-view');
const reportLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'video-report');
const editLimiter = createAuthRateLimiter(60 * 1000, 20, 'video-edit');

// TikTok caps a Stitch to (at most) the first 5 seconds of the source video.
const MAX_STITCH_SOURCE_MS = 5000;

/** Applies a caption's hashtags/mentions to `videoId` and returns the mentioned user ids (for activity notifications) — used by create, Duet, and Stitch alike. */
async function applyHashtagsAndMentions(videoId: string, authorId: string, caption: string | null | undefined): Promise<string[]> {
  const tags = extractHashtags(caption);
  const usernames = extractMentionUsernames(caption);
  return prisma.$transaction(async (tx) => {
    await syncVideoHashtags(tx, videoId, tags);
    const mentionedUserIds = await syncVideoMentions(tx, videoId, authorId, usernames);
    for (const mentionedUserId of mentionedUserIds) {
      await recordActivity(tx, { recipientId: mentionedUserId, actorId: authorId, type: 'MENTION', videoId });
    }
    return mentionedUserIds;
  });
}

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
  uploadVideoWithVoiceover('video', 'voiceover'),
  validate({ body: createVideoSchema }),
  async (req, res, next) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const file = files?.video?.[0];
    const voiceoverFile = files?.voiceover?.[0];
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
        if (voiceoverFile) await unlink(voiceoverFile.path).catch(() => {});
        throw new AppError(
          'BAD_REQUEST',
          `Uploaded file is not a valid video: ${probeError instanceof Error ? probeError.message : 'unknown error'}`,
        );
      }

      // Video editor rebuild — the real trim/speed/filter/text/rotate/
      // cover/volume spec, if the client went through the editor rather
      // than posting a raw clip unedited.
      let editSpec;
      try {
        editSpec = parseVideoEditSpec(req.body.edit);
      } catch (specError) {
        const { unlink } = await import('fs/promises');
        await unlink(file.path).catch(() => {});
        if (voiceoverFile) await unlink(voiceoverFile.path).catch(() => {});
        throw new AppError('BAD_REQUEST', specError instanceof Error ? specError.message : 'Invalid edit spec');
      }

      if (voiceoverFile) {
        try {
          await probeAudio(voiceoverFile.path);
        } catch (probeError) {
          const { unlink } = await import('fs/promises');
          await unlink(file.path).catch(() => {});
          await unlink(voiceoverFile.path).catch(() => {});
          throw new AppError(
            'BAD_REQUEST',
            `Uploaded voice-over is not valid audio: ${probeError instanceof Error ? probeError.message : 'unknown error'}`,
          );
        }
      }

      const {
        caption,
        visibility,
        allowDuet,
        allowStitch,
        allowDownload,
        allowComments,
        addYoursPrompt,
        soundId,
        epidemicTrackId,
        epidemicTrackTitle,
        epidemicTrackArtist,
      } = req.body;
      const videoId = randomUUID();
      const originalKey = videoOriginalKey(videoId, path.extname(file.originalname) || '.mp4');

      let verifiedSoundId: string | undefined;
      if (soundId) {
        const sound = await prisma.sound.findUnique({ where: { id: soundId } });
        if (!sound) {
          const { unlink } = await import('fs/promises');
          await unlink(file.path).catch(() => {});
          if (voiceoverFile) await unlink(voiceoverFile.path).catch(() => {});
          throw new AppError('NOT_FOUND', 'Sound not found');
        }
        verifiedSoundId = sound.id;
      }
      if (epidemicTrackId && !isEpidemicSoundConfigured()) {
        const { unlink } = await import('fs/promises');
        await unlink(file.path).catch(() => {});
        if (voiceoverFile) await unlink(voiceoverFile.path).catch(() => {});
        throw new AppError('SERVICE_UNAVAILABLE', 'The real music catalog is not configured in this environment');
      }

      // Step 10 — moderate the caption before the row exists (video/audio-
      // frame moderation is architecture-only pending a real vendor; see
      // moderationPipeline.ts/videoAudioModerationProvider.ts).
      if (caption) {
        const captionModeration = await moderateText({ contentType: 'VIDEO', contentId: videoId, authorId: req.user!.id, text: caption });
        assertModerationAllowsCreation(captionModeration, 'video');
      }

      // Never trust a client-supplied owner/id — the owner is always the
      // authenticated requester, and the id is always server-generated.
      await storage.putFromLocalPath(originalKey, file.path);
      let voiceoverKey: string | undefined;
      if (voiceoverFile) {
        voiceoverKey = videoVoiceoverKey(videoId, path.extname(voiceoverFile.originalname) || '.m4a');
        await storage.putFromLocalPath(voiceoverKey, voiceoverFile.path);
      }

      // A real Epidemic Sound track or a recorded voice-over both need the
      // real render pipeline even if the user made no other edit — an
      // editSpec (defaulted) is synthesized here rather than left null so
      // videoProcessing.ts's `video.editSpec` branch actually runs and
      // really mixes the audio in, instead of silently plain-transcoding.
      const needsRenderPipeline = editSpec !== null || Boolean(voiceoverKey) || Boolean(epidemicTrackId);
      const finalEditSpec = needsRenderPipeline
        ? { ...(editSpec ?? videoEditSpecSchema.parse({})), voiceoverKey, epidemicTrackId }
        : undefined;

      const video = await prisma.video.create({
        data: {
          id: videoId,
          userId: req.user!.id,
          caption,
          visibility,
          allowDuet,
          allowStitch,
          allowDownload,
          allowComments,
          addYoursPrompt,
          soundId: verifiedSoundId,
          originalKey,
          status: 'PROCESSING',
          // Persisted (not just applied once) so a retried processing
          // attempt — see lib/videoProcessing.ts's MAX_ATTEMPTS retry —
          // reproduces the exact same edit instead of silently falling
          // back to a plain transcode.
          editSpec: finalEditSpec,
        },
      });
      if (verifiedSoundId) {
        await prisma.sound.update({ where: { id: verifiedSoundId }, data: { usageCount: { increment: 1 } } });
      }
      if (epidemicTrackId && epidemicTrackTitle && epidemicTrackArtist) {
        // Real usage-based "Recent" — written only now, when the track is
        // actually attached to a real post, never on mere preview/browse.
        await prisma.epidemicSoundRecent
          .upsert({
            where: { userId_trackId: { userId: req.user!.id, trackId: epidemicTrackId } },
            create: { userId: req.user!.id, trackId: epidemicTrackId, trackTitle: epidemicTrackTitle, trackArtist: epidemicTrackArtist },
            update: { usedAt: new Date(), trackTitle: epidemicTrackTitle, trackArtist: epidemicTrackArtist },
          })
          .catch((error: unknown) => logger.error({ err: error, videoId: video.id }, 'Failed to record Epidemic Sound recent usage'));
      }

      await applyHashtagsAndMentions(video.id, req.user!.id, caption);

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
    const [likedVideoIds, authors, followingIds, repostedVideoIds, favoritedVideoIds] = await Promise.all([
      fetchLikedVideoIds(req.user!.id, [video.id]),
      fetchAuthorSummaries([video.userId]),
      fetchFollowingIds(req.user!.id, [video.userId]),
      fetchRepostedVideoIds(req.user!.id, [video.id]),
      fetchFavoritedVideoIds(req.user!.id, [video.id]),
    ]);
    res.status(200).json(
      serializeVideo(video, {
        likedByMe: likedVideoIds.has(video.id),
        author: authors.get(video.userId),
        isFollowedByMe: followingIds.has(video.userId),
        repostedByMe: repostedVideoIds.has(video.id),
        favoritedByMe: favoritedVideoIds.has(video.id),
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

/** Current TikTok-supported post editing: caption, visibility, and content-reuse permissions after publish — never processing/media fields. */
videosRouter.patch(
  '/videos/:id',
  requireAuth,
  editLimiter,
  validate({ body: updateVideoSchema }),
  async (req, res, next) => {
    try {
      const video = await prisma.video.findUnique({ where: { id: req.params.id! } });
      if (!video || video.status === 'DELETED') {
        throw new AppError('NOT_FOUND', 'Video not found');
      }
      if (video.userId !== req.user!.id) {
        throw new AppError('FORBIDDEN', 'You can only edit your own videos');
      }

      const { caption, visibility, allowDuet, allowStitch, allowDownload, allowComments, allowGifts } = req.body;
      const updated = await prisma.video.update({
        where: { id: video.id },
        data: { caption, visibility, allowDuet, allowStitch, allowDownload, allowComments, allowGifts },
      });

      if (caption !== undefined && caption !== video.caption) {
        // Re-derive hashtag links from scratch rather than diffing — captions
        // are short and this route is rate-limited, so the simplicity is
        // worth more than avoiding a full re-sync.
        const oldTags = await prisma.videoHashtag.findMany({ where: { videoId: video.id }, select: { hashtagId: true } });
        await prisma.$transaction(async (tx) => {
          await tx.videoHashtag.deleteMany({ where: { videoId: video.id } });
          for (const { hashtagId } of oldTags) {
            await tx.hashtag.update({ where: { id: hashtagId }, data: { postCount: { decrement: 1 } } });
          }
        });
        await applyHashtagsAndMentions(video.id, req.user!.id, caption);
      }

      res.status(200).json(serializeVideo(updated));
    } catch (error) {
      next(error);
    }
  },
);

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
      await recordActivity(tx, { recipientId: video.userId, actorId: req.user!.id, type: 'LIKE', videoId: video.id });
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

function serializeComment(comment: {
  id: string;
  videoId: string;
  userId: string;
  parentId: string | null;
  text: string;
  likeCount: number;
  replyCount: number;
  pinnedAt: Date | null;
  createdAt: Date;
  user: { profile: { username: string | null; displayName: string | null; avatarUrl: string | null } | null };
}, likedByMe?: boolean) {
  return {
    id: comment.id,
    videoId: comment.videoId,
    userId: comment.userId,
    parentId: comment.parentId,
    username: comment.user.profile?.username ?? null,
    displayName: comment.user.profile?.displayName ?? null,
    avatarUrl: comment.user.profile?.avatarUrl ?? null,
    text: comment.text,
    likeCount: comment.likeCount,
    replyCount: comment.replyCount,
    isPinned: comment.pinnedAt !== null,
    likedByMe,
    createdAt: comment.createdAt,
  };
}

const commentInclude = { user: { select: { id: true, profile: { select: { username: true, displayName: true, avatarUrl: true } } } } } as const;

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

      // Top-level comments only — replies are fetched per-comment via
      // GET /comments/:id/replies, matching current TikTok's "load replies"
      // UX rather than a single flat list. The pinned comment (at most one,
      // brief K) always leads the very first page.
      const pinned = !decoded
        ? await prisma.videoComment.findFirst({ where: { videoId: video.id, parentId: null, pinnedAt: { not: null } }, include: commentInclude })
        : null;

      const comments = await prisma.videoComment.findMany({
        where: {
          videoId: video.id,
          parentId: null,
          ...(pinned ? { id: { not: pinned.id } } : {}),
          ...(decoded
            ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: commentInclude,
      });

      const hasMore = comments.length > limit;
      const page = hasMore ? comments.slice(0, limit) : comments;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      const allIds = [...(pinned ? [pinned.id] : []), ...page.map((c) => c.id)];
      const myLikes = new Set(
        (await prisma.videoCommentLike.findMany({ where: { userId: req.user!.id, commentId: { in: allIds } }, select: { commentId: true } })).map(
          (l) => l.commentId,
        ),
      );

      res.status(200).json({
        pinned: pinned ? serializeComment(pinned, myLikes.has(pinned.id)) : null,
        comments: page.map((comment) => serializeComment(comment, myLikes.has(comment.id))),
        nextCursor,
      });
    } catch (error) {
      next(error);
    }
  },
);

videosRouter.get('/comments/:id/replies', requireAuth, validate({ query: listCommentsQuerySchema }), async (req, res, next) => {
  try {
    const parent = await prisma.videoComment.findUnique({ where: { id: req.params.id! } });
    if (!parent) {
      throw new AppError('NOT_FOUND', 'Comment not found');
    }
    await loadVisibleVideo(parent.videoId, req.user!.id);
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const replies = await prisma.videoComment.findMany({
      where: {
        parentId: parent.id,
        ...(decoded
          ? { OR: [{ createdAt: { gt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { gt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: commentInclude,
    });

    const hasMore = replies.length > limit;
    const page = hasMore ? replies.slice(0, limit) : replies;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
    const myLikes = new Set(
      (await prisma.videoCommentLike.findMany({ where: { userId: req.user!.id, commentId: { in: page.map((r) => r.id) } }, select: { commentId: true } })).map(
        (l) => l.commentId,
      ),
    );

    res.status(200).json({ replies: page.map((r) => serializeComment(r, myLikes.has(r.id))), nextCursor });
  } catch (error) {
    next(error);
  }
});

videosRouter.post(
  '/videos/:id/comments',
  requireAuth,
  commentLimiter,
  validate({ body: commentSchema }),
  async (req, res, next) => {
    try {
      const video = await loadVisibleVideo(req.params.id!, req.user!.id);
      if (!video.allowComments && video.userId !== req.user!.id) {
        throw new AppError('FORBIDDEN', 'The creator has turned off comments for this video');
      }
      const { text, parentId } = req.body;

      let parent = null;
      if (parentId) {
        parent = await prisma.videoComment.findUnique({ where: { id: parentId } });
        if (!parent || parent.videoId !== video.id) {
          throw new AppError('NOT_FOUND', 'Comment not found');
        }
        if (parent.parentId !== null) {
          throw new AppError('BAD_REQUEST', 'Cannot reply to a reply');
        }
      }

      // Step 10 — unified AI moderation pipeline, checked BEFORE the comment
      // is ever persisted (a pre-generated id lets the moderation event
      // reference the eventual row without a create-then-delete race).
      // Video comments are one of the XNAKView Strict Abuse Rule's named
      // surfaces (brief §3).
      const commentId = randomUUID();
      const moderation = await moderateText({ contentType: 'VIDEO_COMMENT', contentId: commentId, authorId: req.user!.id, text });
      assertModerationAllowsCreation(moderation, 'comment');

      const comment = await prisma.$transaction(async (tx) => {
        const created = await tx.videoComment.create({
          data: { id: commentId, videoId: video.id, userId: req.user!.id, text, parentId },
          include: commentInclude,
        });
        await tx.video.update({ where: { id: video.id }, data: { commentCount: { increment: 1 } } });
        if (parent) {
          await tx.videoComment.update({ where: { id: parent.id }, data: { replyCount: { increment: 1 } } });
          await recordActivity(tx, { recipientId: parent.userId, actorId: req.user!.id, type: 'COMMENT_REPLY', videoId: video.id, commentId: created.id });
        } else {
          await recordActivity(tx, { recipientId: video.userId, actorId: req.user!.id, type: 'COMMENT', videoId: video.id, commentId: created.id });
        }
        const mentionedUserIds = await syncVideoMentions(tx, video.id, req.user!.id, extractMentionUsernames(text));
        for (const mentionedUserId of mentionedUserIds) {
          await recordActivity(tx, { recipientId: mentionedUserId, actorId: req.user!.id, type: 'MENTION', videoId: video.id, commentId: created.id });
        }
        return created;
      });

      res.status(201).json(serializeComment(comment));
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
      const replyCount = comment.parentId === null ? await tx.videoComment.count({ where: { parentId: comment.id } }) : 0;
      await tx.videoComment.delete({ where: { id: comment.id } });
      await tx.video.update({ where: { id: comment.videoId }, data: { commentCount: { decrement: 1 + replyCount } } });
      if (comment.parentId) {
        await tx.videoComment.update({ where: { id: comment.parentId }, data: { replyCount: { decrement: 1 } } }).catch(() => {});
      }
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

videosRouter.post('/comments/:id/like', requireAuth, commentLikeLimiter, async (req, res, next) => {
  try {
    const comment = await prisma.videoComment.findUnique({ where: { id: req.params.id! } });
    if (!comment) {
      throw new AppError('NOT_FOUND', 'Comment not found');
    }
    await loadVisibleVideo(comment.videoId, req.user!.id);

    await prisma.$transaction(async (tx) => {
      await tx.videoCommentLike.create({ data: { commentId: comment.id, userId: req.user!.id } });
      await tx.videoComment.update({ where: { id: comment.id }, data: { likeCount: { increment: 1 } } });
      await recordActivity(tx, { recipientId: comment.userId, actorId: req.user!.id, type: 'COMMENT_LIKE', videoId: comment.videoId, commentId: comment.id });
    });

    res.status(201).json({ liked: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('CONFLICT', 'You have already liked this comment'));
      return;
    }
    next(error);
  }
});

videosRouter.delete('/comments/:id/like', requireAuth, commentLikeLimiter, async (req, res, next) => {
  try {
    const comment = await prisma.videoComment.findUnique({ where: { id: req.params.id! } });
    if (!comment) {
      throw new AppError('NOT_FOUND', 'Comment not found');
    }

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.videoCommentLike.deleteMany({ where: { commentId: comment.id, userId: req.user!.id } });
      if (deleted.count === 0) {
        throw new AppError('NOT_FOUND', 'You have not liked this comment');
      }
      await tx.videoComment.update({ where: { id: comment.id }, data: { likeCount: { decrement: 1 } } });
    });

    res.status(200).json({ liked: false });
  } catch (error) {
    next(error);
  }
});

/** Only the video's owner may pin — matches current TikTok behavior (creator-only) — and at most one pinned comment per video (a second pin replaces the first, never fails). */
videosRouter.post('/comments/:id/pin', requireAuth, async (req, res, next) => {
  try {
    const comment = await prisma.videoComment.findUnique({ where: { id: req.params.id! } });
    if (!comment) {
      throw new AppError('NOT_FOUND', 'Comment not found');
    }
    const video = await prisma.video.findUnique({ where: { id: comment.videoId } });
    if (!video || video.userId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'Only the video owner can pin a comment');
    }
    if (comment.parentId !== null) {
      throw new AppError('BAD_REQUEST', 'Only a top-level comment can be pinned');
    }

    await prisma.$transaction([
      prisma.videoComment.updateMany({ where: { videoId: video.id, pinnedAt: { not: null } }, data: { pinnedAt: null } }),
      prisma.videoComment.update({ where: { id: comment.id }, data: { pinnedAt: new Date() } }),
    ]);

    res.status(200).json({ pinned: true });
  } catch (error) {
    next(error);
  }
});

videosRouter.delete('/comments/:id/pin', requireAuth, async (req, res, next) => {
  try {
    const comment = await prisma.videoComment.findUnique({ where: { id: req.params.id! } });
    if (!comment) {
      throw new AppError('NOT_FOUND', 'Comment not found');
    }
    const video = await prisma.video.findUnique({ where: { id: comment.videoId } });
    if (!video || video.userId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'Only the video owner can unpin a comment');
    }

    await prisma.videoComment.update({ where: { id: comment.id }, data: { pinnedAt: null } });
    res.status(200).json({ pinned: false });
  } catch (error) {
    next(error);
  }
});

videosRouter.post(
  '/comments/:id/report',
  requireAuth,
  commentReportLimiter,
  validate({ body: commentReportSchema }),
  async (req, res, next) => {
    try {
      const comment = await prisma.videoComment.findUnique({ where: { id: req.params.id! } });
      if (!comment) {
        throw new AppError('NOT_FOUND', 'Comment not found');
      }
      await loadVisibleVideo(comment.videoId, req.user!.id);

      const report = await prisma.videoCommentReport.create({
        data: { commentId: comment.id, reporterId: req.user!.id, reason: req.body.reason, description: req.body.description },
      });
      res.status(201).json({ id: report.id, commentId: report.commentId, status: report.status });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'You have already reported this comment'));
        return;
      }
      next(error);
    }
  },
);

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

// -----------------------------------------------------------------------
// Duet / Stitch
// -----------------------------------------------------------------------

/** Loads a source video and enforces every server-side eligibility check for reusing it (Duet/Stitch brief: never trust a client-asserted permission state). */
async function loadReusableSourceVideo(sourceId: string, requesterId: string, permission: 'allowDuet' | 'allowStitch') {
  const source = await loadVisibleVideo(sourceId, requesterId);
  if (source.status !== 'READY') {
    throw new AppError('CONFLICT', 'Source video is not ready yet');
  }
  if (source.userId !== requesterId && (await isBlockedEitherDirection(requesterId, source.userId))) {
    throw new AppError('NOT_FOUND', 'Video not found');
  }
  if (!source[permission]) {
    throw new AppError('FORBIDDEN', `The creator has disabled ${permission === 'allowDuet' ? 'Duet' : 'Stitch'} for this video`);
  }
  return source;
}

videosRouter.post(
  '/videos/:id/duet',
  requireAuth,
  duetStitchLimiter,
  uploadSingleVideo('video'),
  validate({ body: createDuetSchema }),
  async (req, res, next) => {
    const file = req.file;
    try {
      const source = await loadReusableSourceVideo(req.params.id!, req.user!.id, 'allowDuet');
      if (!file) {
        throw new AppError('BAD_REQUEST', 'A "video" file field is required');
      }
      try {
        await probeVideo(file.path);
      } catch (probeError) {
        const { unlink } = await import('fs/promises');
        await unlink(file.path).catch(() => {});
        throw new AppError('BAD_REQUEST', `Uploaded file is not a valid video: ${probeError instanceof Error ? probeError.message : 'unknown error'}`);
      }

      const { caption, visibility } = req.body;
      const videoId = randomUUID();
      const originalKey = videoOriginalKey(videoId, path.extname(file.originalname) || '.mp4');
      await storage.putFromLocalPath(originalKey, file.path);

      const video = await prisma.video.create({
        data: { id: videoId, userId: req.user!.id, caption, visibility, originalKey, status: 'PROCESSING', duetOfVideoId: source.id },
      });
      await applyHashtagsAndMentions(video.id, req.user!.id, caption);
      void processVideo(video.id, video.originalKey).catch((error: unknown) => {
        logger.error({ err: error, videoId: video.id }, 'Unhandled error kicking off video processing');
      });

      res.status(202).json(serializeVideo(video));
    } catch (error) {
      if (file) await import('fs/promises').then((fs) => fs.unlink(file.path).catch(() => {}));
      next(error);
    }
  },
);

videosRouter.post(
  '/videos/:id/stitch',
  requireAuth,
  duetStitchLimiter,
  uploadSingleVideo('video'),
  validate({ body: createStitchSchema }),
  async (req, res, next) => {
    const file = req.file;
    try {
      const source = await loadReusableSourceVideo(req.params.id!, req.user!.id, 'allowStitch');
      if (!file) {
        throw new AppError('BAD_REQUEST', 'A "video" file field is required');
      }
      const { sourceStartMs, sourceEndMs } = req.body;
      const clampedEndMs = Math.min(sourceEndMs, sourceStartMs + MAX_STITCH_SOURCE_MS, source.durationMs ?? sourceEndMs);
      if (clampedEndMs <= sourceStartMs) {
        const { unlink } = await import('fs/promises');
        await unlink(file.path).catch(() => {});
        throw new AppError('BAD_REQUEST', 'Invalid Stitch segment');
      }

      try {
        await probeVideo(file.path);
      } catch (probeError) {
        const { unlink } = await import('fs/promises');
        await unlink(file.path).catch(() => {});
        throw new AppError('BAD_REQUEST', `Uploaded file is not a valid video: ${probeError instanceof Error ? probeError.message : 'unknown error'}`);
      }

      const { caption, visibility } = req.body;
      const videoId = randomUUID();
      const originalKey = videoOriginalKey(videoId, path.extname(file.originalname) || '.mp4');
      await storage.putFromLocalPath(originalKey, file.path);

      const video = await prisma.video.create({
        data: {
          id: videoId,
          userId: req.user!.id,
          caption,
          visibility,
          originalKey,
          status: 'PROCESSING',
          stitchOfVideoId: source.id,
          stitchSourceStartMs: sourceStartMs,
          stitchSourceEndMs: clampedEndMs,
        },
      });
      await applyHashtagsAndMentions(video.id, req.user!.id, caption);
      void processVideo(video.id, video.originalKey).catch((error: unknown) => {
        logger.error({ err: error, videoId: video.id }, 'Unhandled error kicking off video processing');
      });

      res.status(202).json(serializeVideo(video));
    } catch (error) {
      if (file) await import('fs/promises').then((fs) => fs.unlink(file.path).catch(() => {}));
      next(error);
    }
  },
);

// -----------------------------------------------------------------------
// Add Yours
// -----------------------------------------------------------------------

/** Responding to another video's Add Yours prompt (brief G) is only possible if that video actually carries one — never inferred or client-asserted. */
videosRouter.post(
  '/videos/:id/add-yours',
  requireAuth,
  duetStitchLimiter,
  uploadSingleVideo('video'),
  validate({ body: createAddYoursSchema }),
  async (req, res, next) => {
    const file = req.file;
    try {
      const source = await loadVisibleVideo(req.params.id!, req.user!.id);
      if (!source.addYoursPrompt) {
        throw new AppError('BAD_REQUEST', 'This video does not have an Add Yours prompt');
      }
      if (source.userId !== req.user!.id && (await isBlockedEitherDirection(req.user!.id, source.userId))) {
        throw new AppError('NOT_FOUND', 'Video not found');
      }
      if (!file) {
        throw new AppError('BAD_REQUEST', 'A "video" file field is required');
      }
      try {
        await probeVideo(file.path);
      } catch (probeError) {
        const { unlink } = await import('fs/promises');
        await unlink(file.path).catch(() => {});
        throw new AppError('BAD_REQUEST', `Uploaded file is not a valid video: ${probeError instanceof Error ? probeError.message : 'unknown error'}`);
      }

      const { caption, visibility } = req.body;
      const videoId = randomUUID();
      const originalKey = videoOriginalKey(videoId, path.extname(file.originalname) || '.mp4');
      await storage.putFromLocalPath(originalKey, file.path);

      const video = await prisma.video.create({
        data: { id: videoId, userId: req.user!.id, caption, visibility, originalKey, status: 'PROCESSING', addYoursOfVideoId: source.id },
      });
      await applyHashtagsAndMentions(video.id, req.user!.id, caption);
      void processVideo(video.id, video.originalKey).catch((error: unknown) => {
        logger.error({ err: error, videoId: video.id }, 'Unhandled error kicking off video processing');
      });

      res.status(202).json(serializeVideo(video));
    } catch (error) {
      if (file) await import('fs/promises').then((fs) => fs.unlink(file.path).catch(() => {}));
      next(error);
    }
  },
);

videosRouter.get('/videos/:id/add-yours/responses', requireAuth, validate({ query: feedQuerySchema }), async (req, res, next) => {
  try {
    const source = await loadVisibleVideo(req.params.id!, req.user!.id);
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const responses = await prisma.video.findMany({
      where: {
        addYoursOfVideoId: source.id,
        status: 'READY',
        visibility: 'PUBLIC',
        ...(decoded
          ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = responses.length > limit;
    const page = hasMore ? responses.slice(0, limit) : responses;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
    const authors = await fetchAuthorSummaries([...new Set(page.map((v) => v.userId))]);

    res.status(200).json({ videos: page.map((v) => serializeVideo(v, { author: authors.get(v.userId) })), nextCursor });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Repost
// -----------------------------------------------------------------------

videosRouter.post('/videos/:id/repost', requireAuth, shareLimiter, async (req, res, next) => {
  try {
    const video = await loadVisibleVideo(req.params.id!, req.user!.id);
    if (video.userId !== req.user!.id && (await isBlockedEitherDirection(req.user!.id, video.userId))) {
      throw new AppError('NOT_FOUND', 'Video not found');
    }

    await prisma.$transaction(async (tx) => {
      await tx.repost.create({ data: { userId: req.user!.id, videoId: video.id } });
      await recordActivity(tx, { recipientId: video.userId, actorId: req.user!.id, type: 'REPOST', videoId: video.id });
    });

    res.status(201).json({ reposted: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('CONFLICT', 'You have already reposted this video'));
      return;
    }
    next(error);
  }
});

videosRouter.delete('/videos/:id/repost', requireAuth, async (req, res, next) => {
  try {
    const deleted = await prisma.repost.deleteMany({ where: { userId: req.user!.id, videoId: req.params.id! } });
    if (deleted.count === 0) {
      throw new AppError('NOT_FOUND', 'You have not reposted this video');
    }
    res.status(200).json({ reposted: false });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Favorites
// -----------------------------------------------------------------------

videosRouter.post('/videos/:id/favorite', requireAuth, likeLimiter, async (req, res, next) => {
  try {
    const video = await loadVisibleVideo(req.params.id!, req.user!.id);
    await prisma.favorite.create({ data: { userId: req.user!.id, videoId: video.id } });
    res.status(201).json({ favorited: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('CONFLICT', 'You have already favorited this video'));
      return;
    }
    next(error);
  }
});

videosRouter.delete('/videos/:id/favorite', requireAuth, likeLimiter, async (req, res, next) => {
  try {
    const deleted = await prisma.favorite.deleteMany({ where: { userId: req.user!.id, videoId: req.params.id! } });
    if (deleted.count === 0) {
      throw new AppError('NOT_FOUND', 'You have not favorited this video');
    }
    res.status(200).json({ favorited: false });
  } catch (error) {
    next(error);
  }
});

/** Private by default, per brief — only the owner can ever list their own Favorites (there is no public favorites endpoint). */
videosRouter.get('/me/favorites', requireAuth, validate({ query: listCommentsQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const favorites = await prisma.favorite.findMany({
      where: {
        userId: req.user!.id,
        ...(decoded
          ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { video: true },
    });

    const hasMore = favorites.length > limit;
    const page = hasMore ? favorites.slice(0, limit) : favorites;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    // A previously-favorited video may since have been deleted/made
    // private by its owner — filtered out here rather than 404ing the
    // whole page (brief I's "deleted/unavailable content handling").
    const visible = page.filter((f) => f.video.status !== 'DELETED' && (f.video.visibility === 'PUBLIC' || f.video.userId === req.user!.id));
    const authors = await fetchAuthorSummaries([...new Set(visible.map((f) => f.video.userId))]);

    res.status(200).json({
      videos: visible.map((f) => serializeVideo(f.video, { author: authors.get(f.video.userId) })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

/** Anyone's Repost tab is public, matching current TikTok profile behavior. */
videosRouter.get('/users/:id/reposts', requireAuth, validate({ query: listCommentsQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const reposts = await prisma.repost.findMany({
      where: {
        userId: req.params.id!,
        ...(decoded
          ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { video: true },
    });

    const hasMore = reposts.length > limit;
    const page = hasMore ? reposts.slice(0, limit) : reposts;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    const visible = page.filter((r) => r.video.status === 'READY' && (r.video.visibility === 'PUBLIC' || r.video.userId === req.user!.id));
    const authors = await fetchAuthorSummaries([...new Set(visible.map((r) => r.video.userId))]);

    res.status(200).json({
      videos: visible.map((r) => serializeVideo(r.video, { author: authors.get(r.video.userId) })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});
