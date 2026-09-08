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

/**
 * Browse/search sounds (Create's "Add Sound" screen). Since a `Sound` row's
 * `title` is only ever explicitly set (most rows are `null`, displayed as
 * "Original sound - <creator>" only at read time — see `GET /sounds/:id`),
 * `query` can only match sounds that happen to have a real stored title;
 * this is a genuine, disclosed limitation of "reuse this video's own audio"
 * (brief C) rather than a licensed, richly-tagged music catalog. Default
 * (no query) order is "trending" — most-reused sounds first, this
 * codebase's own honest stand-in for a real trending chart.
 */
soundsRouter.get('/sounds', requireAuth, async (req, res, next) => {
  try {
    const { query, cursor, limit: rawLimit } = req.query as { query?: string; cursor?: string; limit?: string };
    const limit = Math.min(Math.max(Number(rawLimit) || 20, 1), 50);
    const decoded = cursor ? decodeSoundCursor(cursor) : null;

    const sounds = await prisma.sound.findMany({
      where: {
        ...(query ? { title: { contains: query, mode: 'insensitive' } } : {}),
        ...(decoded
          ? { OR: [{ usageCount: { lt: decoded.usageCount } }, { usageCount: decoded.usageCount, id: { lt: decoded.id } }] }
          : {}),
      },
      include: { sourceVideo: { select: { userId: true } } },
      orderBy: [{ usageCount: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = sounds.length > limit;
    const page = hasMore ? sounds.slice(0, limit) : sounds;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeSoundCursor({ usageCount: last.usageCount, id: last.id }) : null;

    const authors = await fetchAuthorSummaries([...new Set(page.map((s) => s.sourceVideo.userId))]);
    res.status(200).json({
      sounds: page.map((s) => {
        const author = authors.get(s.sourceVideo.userId);
        return {
          id: s.id,
          title: s.title ?? (author ? `Original sound - ${author.displayName ?? author.username ?? 'creator'}` : 'Original sound'),
          usageCount: s.usageCount,
          author,
        };
      }),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

function encodeSoundCursor(cursor: { usageCount: number; id: string }): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeSoundCursor(raw: string): { usageCount: number; id: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<{ usageCount: number; id: string }>;
    if (typeof decoded.usageCount === 'number' && typeof decoded.id === 'string') return { usageCount: decoded.usageCount, id: decoded.id };
    return null;
  } catch {
    return null;
  }
}

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
