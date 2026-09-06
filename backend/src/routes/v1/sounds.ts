import { Router } from 'express';

import { getOrCreateSoundForVideo } from '@/lib/sounds';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { canViewVideo, fetchAuthorSummaries, serializeVideo } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { AppError } from '@/utils/AppError';

/**
 * Sounds foundation (Step 6, brief C) — never a bundled copyrighted
 * catalog. Every video's own audio is implicitly usable; a `Sound` row is
 * only materialized lazily, the first time "use this sound" is actually
 * invoked on a video (see lib/sounds.ts). Attribution always traces back
 * to the original video's author.
 */
export const soundsRouter = Router();

/** Exposes a video's own audio as a reusable Sound ("use this sound") — idempotent, lazily creates the Sound row on first call. */
soundsRouter.post('/videos/:id/sound', requireAuth, async (req, res, next) => {
  try {
    const video = await prisma.video.findUnique({ where: { id: req.params.id! } });
    if (!video || !canViewVideo(video, req.user!.id) || video.status !== 'READY') {
      throw new AppError('NOT_FOUND', 'Video not found');
    }
    const sound = await getOrCreateSoundForVideo(prisma, video.id);
    res.status(200).json({ id: sound.id });
  } catch (error) {
    next(error);
  }
});

soundsRouter.get('/sounds/:id', requireAuth, async (req, res, next) => {
  try {
    const sound = await prisma.sound.findUnique({ where: { id: req.params.id! }, include: { sourceVideo: true } });
    if (!sound || !canViewVideo(sound.sourceVideo, req.user!.id)) {
      throw new AppError('NOT_FOUND', 'Sound not found');
    }
    const author = (await fetchAuthorSummaries([sound.sourceVideo.userId])).get(sound.sourceVideo.userId);
    res.status(200).json({
      id: sound.id,
      title: sound.title ?? (author ? `Original sound - ${author.displayName ?? author.username ?? 'creator'}` : 'Original sound'),
      sourceVideoId: sound.sourceVideoId,
      author,
      usageCount: sound.usageCount,
      createdAt: sound.createdAt,
    });
  } catch (error) {
    next(error);
  }
});

soundsRouter.get('/sounds/:id/videos', requireAuth, async (req, res, next) => {
  try {
    const sound = await prisma.sound.findUnique({ where: { id: req.params.id! } });
    if (!sound) {
      throw new AppError('NOT_FOUND', 'Sound not found');
    }
    const { cursor, limit: rawLimit } = req.query as { cursor?: string; limit?: string };
    const limit = Math.min(Math.max(Number(rawLimit) || 20, 1), 50);
    const decoded = cursor ? decodeCursor(cursor) : null;

    const videos = await prisma.video.findMany({
      where: {
        soundId: sound.id,
        status: 'READY',
        visibility: 'PUBLIC',
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
    const authors = await fetchAuthorSummaries([...new Set(page.map((v) => v.userId))]);

    res.status(200).json({ videos: page.map((v) => serializeVideo(v, { author: authors.get(v.userId) })), nextCursor });
  } catch (error) {
    next(error);
  }
});
