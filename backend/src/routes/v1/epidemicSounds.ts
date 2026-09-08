import { Router } from 'express';
import { z } from 'zod';

import { browseEpidemicTracks, isEpidemicSoundConfigured, searchEpidemicTracks, getEpidemicPreviewUrl } from '@/lib/epidemicSound';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { AppError } from '@/utils/AppError';

export const epidemicSoundsRouter = Router();

const listLimiter = createAuthRateLimiter(60 * 1000, 60, 'epidemic-sound-list');
const favoriteLimiter = createAuthRateLimiter(60 * 1000, 60, 'epidemic-sound-favorite');

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const searchQuerySchema = listQuerySchema.extend({
  term: z.string().trim().min(1).max(100),
});

function assertConfigured(): void {
  if (!isEpidemicSoundConfigured()) {
    throw new AppError('SERVICE_UNAVAILABLE', 'The real music catalog is not configured in this environment (EPIDEMIC_SOUND_API_KEY unset)');
  }
}

epidemicSoundsRouter.get('/epidemic-sounds/browse', requireAuth, listLimiter, validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    assertConfigured();
    const { limit, offset } = req.query as unknown as { limit: number; offset: number };
    const page = await browseEpidemicTracks(limit, offset);
    res.status(200).json(page);
  } catch (error) {
    next(error);
  }
});

epidemicSoundsRouter.get('/epidemic-sounds/search', requireAuth, listLimiter, validate({ query: searchQuerySchema }), async (req, res, next) => {
  try {
    assertConfigured();
    const { term, limit, offset } = req.query as unknown as { term: string; limit: number; offset: number };
    const page = await searchEpidemicTracks(term, limit, offset);
    res.status(200).json(page);
  } catch (error) {
    next(error);
  }
});

epidemicSoundsRouter.get('/epidemic-sounds/:trackId/preview', requireAuth, async (req, res, next) => {
  try {
    assertConfigured();
    const preview = await getEpidemicPreviewUrl(req.params.trackId!);
    res.status(200).json(preview);
  } catch (error) {
    next(error);
  }
});

epidemicSoundsRouter.get('/epidemic-sounds/favorites', requireAuth, async (req, res, next) => {
  try {
    const favorites = await prisma.epidemicSoundFavorite.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({
      tracks: favorites.map((f) => ({ id: f.trackId, title: f.trackTitle, artist: f.trackArtist, favoritedAt: f.createdAt })),
    });
  } catch (error) {
    next(error);
  }
});

const favoriteBodySchema = z.object({
  trackTitle: z.string().trim().min(1).max(200),
  trackArtist: z.string().trim().min(1).max(200),
});

epidemicSoundsRouter.post(
  '/epidemic-sounds/:trackId/favorite',
  requireAuth,
  favoriteLimiter,
  validate({ body: favoriteBodySchema }),
  async (req, res, next) => {
    try {
      await prisma.epidemicSoundFavorite.upsert({
        where: { userId_trackId: { userId: req.user!.id, trackId: req.params.trackId! } },
        create: { userId: req.user!.id, trackId: req.params.trackId!, trackTitle: req.body.trackTitle, trackArtist: req.body.trackArtist },
        update: {},
      });
      res.status(201).json({ favorited: true });
    } catch (error) {
      next(error);
    }
  },
);

epidemicSoundsRouter.delete('/epidemic-sounds/:trackId/favorite', requireAuth, favoriteLimiter, async (req, res, next) => {
  try {
    await prisma.epidemicSoundFavorite.deleteMany({ where: { userId: req.user!.id, trackId: req.params.trackId! } });
    res.status(200).json({ favorited: false });
  } catch (error) {
    next(error);
  }
});

epidemicSoundsRouter.get('/epidemic-sounds/recent', requireAuth, async (req, res, next) => {
  try {
    const recents = await prisma.epidemicSoundRecent.findMany({
      where: { userId: req.user!.id },
      orderBy: { usedAt: 'desc' },
      take: 30,
    });
    res.status(200).json({
      tracks: recents.map((r) => ({ id: r.trackId, title: r.trackTitle, artist: r.trackArtist, usedAt: r.usedAt })),
    });
  } catch (error) {
    next(error);
  }
});
