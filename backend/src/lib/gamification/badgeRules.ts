import { prisma } from '@/lib/prisma';
import { sendGamificationNotification } from '@/lib/gamification/notifications';
import { logger } from '@/lib/logger';

/**
 * One evaluator per `Badge.criteriaKey` — a Badge row created in the admin
 * catalog with a `criteriaKey` that has no matching entry here is simply
 * inert (never auto-awarded), by design (see schema.prisma's doc comment on
 * `Badge`). Every evaluator answers a single yes/no question from data this
 * codebase already owns — never a bare client-asserted "I earned this".
 */
type BadgeEvaluator = (userId: string) => Promise<boolean>;

export const BADGE_EVALUATORS: Record<string, BadgeEvaluator> = {
  FIRST_LIVE_HOSTED: async (userId) => (await prisma.liveSession.count({ where: { hostId: userId } })) >= 1,
  FOLLOWERS_100: async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { followerCount: true } });
    return (user?.followerCount ?? 0) >= 100;
  },
  FOLLOWERS_1000: async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { followerCount: true } });
    return (user?.followerCount ?? 0) >= 1000;
  },
  FIRST_GIFT_RECEIVED: async (userId) => (await prisma.giftTransaction.count({ where: { recipientId: userId } })) >= 1,
  LIVE_HOST_10_SESSIONS: async (userId) => (await prisma.liveSession.count({ where: { hostId: userId, status: 'ENDED' } })) >= 10,
  TEAM_MEMBER: async (userId) => (await prisma.teamMember.count({ where: { userId, status: 'ACTIVE' } })) >= 1,
  TEAM_LEADER: async (userId) => (await prisma.teamMember.count({ where: { userId, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } } })) >= 1,
  CONSISTENCY_7_DAY_STREAK: async (userId) => (await prisma.streak.count({ where: { userId, longestCount: { gte: 7 } } })) >= 1,
};

/**
 * Runs only the evaluators relevant to what just happened (`candidateKeys`)
 * — never a scan of the whole Badge catalog on every event, so this stays
 * cheap no matter how many badges an admin defines over time.
 */
export async function checkAndAwardBadges(userId: string, candidateKeys: string[]): Promise<void> {
  if (candidateKeys.length === 0) return;

  const badges = await prisma.badge.findMany({
    where: { active: true, criteriaKey: { in: candidateKeys } },
  });
  if (badges.length === 0) return;

  const alreadyEarned = new Set(
    (await prisma.userBadge.findMany({ where: { userId, badgeId: { in: badges.map((b) => b.id) } }, select: { badgeId: true } })).map(
      (b) => b.badgeId,
    ),
  );

  for (const badge of badges) {
    if (alreadyEarned.has(badge.id)) continue;
    const evaluator = BADGE_EVALUATORS[badge.criteriaKey];
    if (!evaluator) continue;

    try {
      const eligible = await evaluator(userId);
      if (!eligible) continue;

      await prisma.userBadge.create({ data: { userId, badgeId: badge.id } });
      await sendGamificationNotification(prisma, userId, 'BADGE_AWARDED', { badgeId: badge.id, slug: badge.slug, name: badge.name });
    } catch (error) {
      // A duplicate-award race (P2002) is a harmless no-op; anything else is
      // logged and skipped — a badge-evaluation bug must never break the
      // caller's primary action (a follow, a gift, ending a LIVE session).
      if (!(error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002')) {
        logger.error({ error, userId, badgeSlug: badge.slug }, 'gamification: badge evaluation failed');
      }
    }
  }
}
