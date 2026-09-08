import type { Video } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/** Batch "did I like each of these videos" lookup — one query for a whole page, not one per video. */
export async function fetchLikedVideoIds(userId: string, videoIds: string[]): Promise<Set<string>> {
  if (videoIds.length === 0) return new Set();
  const likes = await prisma.videoLike.findMany({
    where: { userId, videoId: { in: videoIds } },
    select: { videoId: true },
  });
  return new Set(likes.map((like) => like.videoId));
}

export interface AuthorSummary {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Batch author profile lookup for a page of videos — one query, not one per video. */
export async function fetchAuthorSummaries(userIds: string[]): Promise<Map<string, AuthorSummary>> {
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, profile: { select: { username: true, displayName: true, avatarUrl: true } } },
  });
  return new Map(
    users.map((user) => [
      user.id,
      {
        id: user.id,
        username: user.profile?.username ?? null,
        displayName: user.profile?.displayName ?? null,
        avatarUrl: user.profile?.avatarUrl ?? null,
      },
    ]),
  );
}

/** Batch "do I follow each of these authors" lookup — one query, not one per video. */
export async function fetchFollowingIds(followerId: string, targetIds: string[]): Promise<Set<string>> {
  if (targetIds.length === 0) return new Set();
  const follows = await prisma.follow.findMany({
    where: { followerId, followingId: { in: targetIds } },
    select: { followingId: true },
  });
  return new Set(follows.map((follow) => follow.followingId));
}

/** Batch "did I repost each of these videos" lookup — the authenticated user's real state, not client-side-only, so it survives a reload/re-login. */
export async function fetchRepostedVideoIds(userId: string, videoIds: string[]): Promise<Set<string>> {
  if (videoIds.length === 0) return new Set();
  const reposts = await prisma.repost.findMany({ where: { userId, videoId: { in: videoIds } }, select: { videoId: true } });
  return new Set(reposts.map((r) => r.videoId));
}

/** Batch "did I favorite each of these videos" lookup — same real-state posture as `fetchRepostedVideoIds`. */
export async function fetchFavoritedVideoIds(userId: string, videoIds: string[]): Promise<Set<string>> {
  if (videoIds.length === 0) return new Set();
  const favorites = await prisma.favorite.findMany({ where: { userId, videoId: { in: videoIds } }, select: { videoId: true } });
  return new Set(favorites.map((f) => f.videoId));
}

/** A video is visible to anyone only once it's finished processing and is public — its owner can always see it. */
export function canViewVideo(video: Pick<Video, 'userId' | 'status' | 'visibility'>, requesterId: string): boolean {
  if (video.userId === requesterId) return true;
  return video.status === 'READY' && video.visibility === 'PUBLIC';
}

interface SerializeVideoExtras {
  likedByMe?: boolean;
  author?: AuthorSummary;
  isFollowedByMe?: boolean;
  repostedByMe?: boolean;
  favoritedByMe?: boolean;
}

/** Fields left `undefined` (not e.g. `false`/`null`) when the caller hasn't looked them up, so callers that skip that lookup don't accidentally imply a value. */
export function serializeVideo(video: Video, extras: SerializeVideoExtras = {}) {
  const { likedByMe, author, isFollowedByMe, repostedByMe, favoritedByMe } = extras;
  return {
    id: video.id,
    userId: video.userId,
    caption: video.caption,
    status: video.status,
    visibility: video.visibility,
    processingError: video.status === 'FAILED' ? video.processingError : undefined,
    playbackUrl: video.playbackKey ? `/api/v1/videos/${video.id}/file` : null,
    thumbnailUrl: video.thumbnailKey ? `/api/v1/videos/${video.id}/thumbnail` : null,
    durationMs: video.durationMs,
    width: video.width,
    height: video.height,
    likeCount: video.likeCount,
    commentCount: video.commentCount,
    viewCount: video.viewCount,
    shareCount: video.shareCount,
    allowDuet: video.allowDuet,
    allowStitch: video.allowStitch,
    allowDownload: video.allowDownload,
    allowComments: video.allowComments,
    allowGifts: video.allowGifts,
    duetOfVideoId: video.duetOfVideoId,
    stitchOfVideoId: video.stitchOfVideoId,
    addYoursPrompt: video.addYoursPrompt,
    addYoursOfVideoId: video.addYoursOfVideoId,
    soundId: video.soundId,
    likedByMe,
    author,
    isFollowedByMe,
    repostedByMe,
    favoritedByMe,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  };
}
