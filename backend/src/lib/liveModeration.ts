import { prisma } from '@/lib/prisma';

/**
 * Real server-side keyword filter for LIVE chat — checked before a message
 * is ever persisted (see routes/v1/live.ts). Matches whole words,
 * case-insensitively, so "class" doesn't trip a filter on "ass". The list
 * itself is admin-managed (LiveBlockedWord), not hardcoded, so it can change
 * without a deploy.
 *
 * This is the "comment filtering / keyword filtering / blocked words"
 * foundation. It is NOT the zero-tolerance permanent-ban system described
 * in the product requirements — that needs identity-verification and
 * ban-evasion infrastructure that doesn't exist yet and is explicitly
 * deferred (see docs/STEP4_PROGRESS.md and docs/ROADMAP.md).
 */
export async function containsBlockedWord(text: string): Promise<string | null> {
  const blockedWords = await prisma.liveBlockedWord.findMany({ select: { word: true } });
  if (blockedWords.length === 0) return null;

  const normalized = text.toLowerCase();
  for (const { word } of blockedWords) {
    const pattern = new RegExp(`\\b${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(normalized)) {
      return word;
    }
  }
  return null;
}

export async function isUserBlockedFromSession(liveSessionId: string, userId: string): Promise<boolean> {
  const restriction = await prisma.liveViewerRestriction.findUnique({
    where: { liveSessionId_userId_type: { liveSessionId, userId, type: 'BLOCKED' } },
  });
  return Boolean(restriction);
}

export async function isUserMutedInSession(liveSessionId: string, userId: string): Promise<boolean> {
  const restriction = await prisma.liveViewerRestriction.findUnique({
    where: { liveSessionId_userId_type: { liveSessionId, userId, type: 'MUTED' } },
  });
  return Boolean(restriction);
}

/** Host always has moderator authority; an appointed LiveModerator also does. */
export async function canModerate(liveSessionId: string, userId: string, hostId: string): Promise<boolean> {
  if (userId === hostId) return true;
  const moderator = await prisma.liveModerator.findUnique({
    where: { liveSessionId_userId: { liveSessionId, userId } },
  });
  return Boolean(moderator);
}
