import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { env } from '@/config/env';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { addPlaylistVideoSchema, createPlaylistSchema, reorderPlaylistSchema, updatePlaylistSchema } from '@/schemas/discovery.schema';
import { AppError } from '@/utils/AppError';

export const playlistsRouter = Router();

const playlistLimiter = createAuthRateLimiter(60 * 1000, 20, 'playlist-mutate');

/**
 * The single source of truth for "is this account currently eligible to
 * create a Creator Playlist / add to one" — always a fresh DB read of
 * `User.followerCount`, never a client-supplied count and never cached in
 * the access token, so a follower count that changes mid-session takes
 * effect on the very next request. Threshold is centrally configurable
 * (env.CREATOR_PLAYLIST_MIN_FOLLOWERS, default 5000) — never hardcoded
 * elsewhere in this file.
 */
async function assertPlaylistEligible(userId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { followerCount: true } });
  if (user.followerCount < env.CREATOR_PLAYLIST_MIN_FOLLOWERS) {
    throw new AppError('FORBIDDEN', `Creator Playlists unlock at ${env.CREATOR_PLAYLIST_MIN_FOLLOWERS} followers`);
  }
}

function serializePlaylist(playlist: { id: string; userId: string; name: string; description: string | null; viewCount: number; createdAt: Date; updatedAt: Date }) {
  return {
    id: playlist.id,
    userId: playlist.userId,
    name: playlist.name,
    description: playlist.description,
    viewCount: playlist.viewCount,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

async function loadOwnedPlaylist(playlistId: string, userId: string) {
  const playlist = await prisma.creatorPlaylist.findUnique({ where: { id: playlistId } });
  if (!playlist || playlist.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Playlist not found');
  }
  return playlist;
}

/** Followers-progress helper for the mobile "X / 5000 followers" locked-state UI. */
playlistsRouter.get('/playlists/eligibility', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { followerCount: true } });
    res.status(200).json({
      eligible: user.followerCount >= env.CREATOR_PLAYLIST_MIN_FOLLOWERS,
      followerCount: user.followerCount,
      requiredFollowers: env.CREATOR_PLAYLIST_MIN_FOLLOWERS,
    });
  } catch (error) {
    next(error);
  }
});

playlistsRouter.get('/users/:id/playlists', requireAuth, async (req, res, next) => {
  try {
    const playlists = await prisma.creatorPlaylist.findMany({
      where: { userId: req.params.id! },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({ playlists: playlists.map(serializePlaylist) });
  } catch (error) {
    next(error);
  }
});

playlistsRouter.post('/playlists', requireAuth, playlistLimiter, validate({ body: createPlaylistSchema }), async (req, res, next) => {
  try {
    await assertPlaylistEligible(req.user!.id);
    const playlist = await prisma.creatorPlaylist.create({
      data: { userId: req.user!.id, name: req.body.name, description: req.body.description },
    });
    res.status(201).json(serializePlaylist(playlist));
  } catch (error) {
    next(error);
  }
});

playlistsRouter.get('/playlists/:id', requireAuth, async (req, res, next) => {
  try {
    const playlist = await prisma.creatorPlaylist.findUnique({
      where: { id: req.params.id! },
      include: { items: { orderBy: { position: 'asc' }, include: { video: true } } },
    });
    if (!playlist) {
      throw new AppError('NOT_FOUND', 'Playlist not found');
    }
    // Viewing an existing playlist is never eligibility-gated — only
    // creating one / adding to one is (brief N's downgrade policy).
    if (playlist.userId === req.user!.id) {
      await prisma.creatorPlaylist.update({ where: { id: playlist.id }, data: { viewCount: { increment: 0 } } });
    } else {
      await prisma.creatorPlaylist.update({ where: { id: playlist.id }, data: { viewCount: { increment: 1 } } });
    }
    res.status(200).json({
      ...serializePlaylist(playlist),
      videos: playlist.items
        .filter((item) => item.video.status === 'READY' && (item.video.visibility === 'PUBLIC' || playlist.userId === req.user!.id))
        .map((item) => ({ id: item.video.id, position: item.position })),
    });
  } catch (error) {
    next(error);
  }
});

playlistsRouter.patch('/playlists/:id', requireAuth, playlistLimiter, validate({ body: updatePlaylistSchema }), async (req, res, next) => {
  try {
    const playlist = await loadOwnedPlaylist(req.params.id!, req.user!.id);
    const updated = await prisma.creatorPlaylist.update({
      where: { id: playlist.id },
      data: { name: req.body.name, description: req.body.description },
    });
    res.status(200).json(serializePlaylist(updated));
  } catch (error) {
    next(error);
  }
});

playlistsRouter.delete('/playlists/:id', requireAuth, async (req, res, next) => {
  try {
    const playlist = await loadOwnedPlaylist(req.params.id!, req.user!.id);
    await prisma.creatorPlaylist.delete({ where: { id: playlist.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

playlistsRouter.post(
  '/playlists/:id/videos',
  requireAuth,
  playlistLimiter,
  validate({ body: addPlaylistVideoSchema }),
  async (req, res, next) => {
    try {
      const playlist = await loadOwnedPlaylist(req.params.id!, req.user!.id);
      await assertPlaylistEligible(req.user!.id);

      const video = await prisma.video.findUnique({ where: { id: req.body.videoId } });
      if (!video || video.status === 'DELETED') {
        throw new AppError('NOT_FOUND', 'Video not found');
      }
      // Only the creator's own videos — never another creator's video into
      // your playlist (brief N, explicit).
      if (video.userId !== req.user!.id) {
        throw new AppError('FORBIDDEN', 'You can only add your own videos to a playlist');
      }

      const nextPosition = await prisma.creatorPlaylistItem.count({ where: { playlistId: playlist.id } });
      const item = await prisma.creatorPlaylistItem.create({
        data: { playlistId: playlist.id, videoId: video.id, position: nextPosition },
      });
      res.status(201).json({ id: item.id, videoId: item.videoId, position: item.position });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'This video is already in the playlist'));
        return;
      }
      next(error);
    }
  },
);

playlistsRouter.delete('/playlists/:id/videos/:videoId', requireAuth, async (req, res, next) => {
  try {
    const playlist = await loadOwnedPlaylist(req.params.id!, req.user!.id);
    const deleted = await prisma.creatorPlaylistItem.deleteMany({ where: { playlistId: playlist.id, videoId: req.params.videoId! } });
    if (deleted.count === 0) {
      throw new AppError('NOT_FOUND', 'Video not found in this playlist');
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/** Full reorder: the request supplies the complete new video-id order — every id must already belong to the playlist, and positions are reassigned 0..N-1 in a single transaction so a partial write is never observable. */
playlistsRouter.put(
  '/playlists/:id/order',
  requireAuth,
  playlistLimiter,
  validate({ body: reorderPlaylistSchema }),
  async (req, res, next) => {
    try {
      const playlist = await loadOwnedPlaylist(req.params.id!, req.user!.id);
      const existing = await prisma.creatorPlaylistItem.findMany({ where: { playlistId: playlist.id } });
      const existingIds = new Set(existing.map((i) => i.videoId));
      const requestedIds: string[] = req.body.videoIds;

      if (requestedIds.length !== existing.length || !requestedIds.every((id) => existingIds.has(id))) {
        throw new AppError('BAD_REQUEST', 'videoIds must be exactly the playlist\'s current videos');
      }

      await prisma.$transaction(
        requestedIds.map((videoId, index) =>
          prisma.creatorPlaylistItem.update({
            where: { playlistId_videoId: { playlistId: playlist.id, videoId } },
            data: { position: index + existing.length },
          }),
        ),
      );
      await prisma.$transaction(
        requestedIds.map((videoId, index) =>
          prisma.creatorPlaylistItem.update({
            where: { playlistId_videoId: { playlistId: playlist.id, videoId } },
            data: { position: index },
          }),
        ),
      );

      res.status(200).json({ reordered: true });
    } catch (error) {
      next(error);
    }
  },
);
