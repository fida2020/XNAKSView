import type { Prisma, PrismaClient } from '@prisma/client';

// Unicode word characters so non-Latin-script hashtags/usernames work, not
// just [A-Za-z0-9_]. Matches TikTok's "letters, numbers, underscore" rule
// closely enough for parity without pulling in a locale-aware tokenizer.
const HASHTAG_PATTERN = /#([\p{L}\p{N}_]+)/gu;
const MENTION_PATTERN = /@([\p{L}\p{N}_.]+)/gu;

/** Case/leading-# insensitive: `#XNAKView` and `#xnakview` normalize to the same tag. */
export function normalizeHashtag(raw: string): string {
  return raw.replace(/^#/, '').trim().toLowerCase();
}

/** Extracts unique, normalized hashtags from a caption/text — never trusts a client-supplied hashtag list separately from the text itself. */
export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    const tag = normalizeHashtag(match[1]!);
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/** Extracts unique @-mention usernames (not yet resolved to real users) from a caption/text. */
export function extractMentionUsernames(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const username = match[1]!.trim().toLowerCase();
    if (username) seen.add(username);
  }
  return [...seen];
}

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Upserts every hashtag in `tags`, links them to `videoId`, and bumps each
 * `Hashtag.postCount` — all inside the caller's transaction so a video and
 * its hashtag links are never created out of sync with each other.
 */
export async function syncVideoHashtags(tx: Tx, videoId: string, tags: string[]): Promise<void> {
  for (const tag of tags) {
    const hashtag = await tx.hashtag.upsert({
      where: { tag },
      create: { tag },
      update: {},
    });
    await tx.videoHashtag.upsert({
      where: { videoId_hashtagId: { videoId, hashtagId: hashtag.id } },
      create: { videoId, hashtagId: hashtag.id },
      update: {},
    });
    await tx.hashtag.update({ where: { id: hashtag.id }, data: { postCount: { increment: 1 } } });
  }
}

/**
 * Resolves `usernames` to real, existing users and records a `Mention` row
 * for each — silently skips usernames that don't belong to any account
 * (brief §10's "invalid mention handling") and never mentions the caller
 * themselves. Server-side resolution means a mention can only ever reach an
 * account that actually holds that username right now, never a
 * client-asserted user id.
 */
export async function syncVideoMentions(tx: Tx, videoId: string, mentionedById: string, usernames: string[]): Promise<string[]> {
  if (usernames.length === 0) return [];
  const profiles = await tx.profile.findMany({
    where: { username: { in: usernames, mode: 'insensitive' } },
    select: { userId: true },
  });
  const mentionedUserIds = [...new Set(profiles.map((p) => p.userId))].filter((id) => id !== mentionedById);

  for (const mentionedUserId of mentionedUserIds) {
    await tx.mention.upsert({
      where: { videoId_mentionedUserId: { videoId, mentionedUserId } },
      create: { videoId, mentionedUserId, mentionedById },
      update: {},
    });
  }
  return mentionedUserIds;
}

/** Same as `syncVideoHashtags`, for a Photo Post. */
export async function syncPhotoPostHashtags(tx: Tx, photoPostId: string, tags: string[]): Promise<void> {
  for (const tag of tags) {
    const hashtag = await tx.hashtag.upsert({ where: { tag }, create: { tag }, update: {} });
    await tx.photoPostHashtag.upsert({
      where: { photoPostId_hashtagId: { photoPostId, hashtagId: hashtag.id } },
      create: { photoPostId, hashtagId: hashtag.id },
      update: {},
    });
    await tx.hashtag.update({ where: { id: hashtag.id }, data: { postCount: { increment: 1 } } });
  }
}

/** Same as `syncVideoHashtags`, for a Text Post. */
export async function syncTextPostHashtags(tx: Tx, textPostId: string, tags: string[]): Promise<void> {
  for (const tag of tags) {
    const hashtag = await tx.hashtag.upsert({ where: { tag }, create: { tag }, update: {} });
    await tx.textPostHashtag.upsert({
      where: { textPostId_hashtagId: { textPostId, hashtagId: hashtag.id } },
      create: { textPostId, hashtagId: hashtag.id },
      update: {},
    });
    await tx.hashtag.update({ where: { id: hashtag.id }, data: { postCount: { increment: 1 } } });
  }
}
