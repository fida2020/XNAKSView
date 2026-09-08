import { prisma } from '@/lib/prisma';
import { recordXP } from '@/lib/gamification/xpEngine';
import { sendGamificationNotification } from '@/lib/gamification/notifications';
import { logger } from '@/lib/logger';

/**
 * One evaluator per `Achievement.criteriaKey`, same "inert if unregistered"
 * posture as `badgeRules.ts`. Returns a progress value and the target it's
 * measured against — unlocking is `progress >= target`, decided here and
 * nowhere else, so a mobile client can render a progress bar without ever
 * being trusted to decide unlock state itself.
 */
type AchievementEvaluator = (userId: string) => Promise<{ progress: number; target: number }>;

export const ACHIEVEMENT_EVALUATORS: Record<string, AchievementEvaluator> = {
  FIRST_POST: async (userId) => {
    const [videos, photoPosts, textPosts] = await Promise.all([
      prisma.video.count({ where: { userId, status: 'READY' } }),
      prisma.photoPost.count({ where: { userId, deletedAt: null } }),
      prisma.textPost.count({ where: { userId, deletedAt: null } }),
    ]);
    return { progress: Math.min(1, videos + photoPosts + textPosts), target: 1 };
  },
  FIRST_LIVE: async (userId) => ({ progress: Math.min(1, await prisma.liveSession.count({ where: { hostId: userId } })), target: 1 }),
  FIRST_FOLLOWER_MILESTONE: async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { followerCount: true } });
    return { progress: Math.min(100, user?.followerCount ?? 0), target: 100 };
  },
  FIRST_GIFT_SENT: async (userId) => ({ progress: Math.min(1, await prisma.giftTransaction.count({ where: { senderId: userId } })), target: 1 }),
  FIRST_GIFT_RECEIVED: async (userId) => ({ progress: Math.min(1, await prisma.giftTransaction.count({ where: { recipientId: userId } })), target: 1 }),
  FIRST_TEAM_MEMBERSHIP: async (userId) => ({ progress: Math.min(1, await prisma.teamMember.count({ where: { userId, status: 'ACTIVE' } })), target: 1 }),
  LIVE_MILESTONE_10_SESSIONS: async (userId) => ({
    progress: Math.min(10, await prisma.liveSession.count({ where: { hostId: userId, status: 'ENDED' } })),
    target: 10,
  }),
  CREATOR_MILESTONE_1000_DIAMONDS: async (userId) => {
    const wallet = await prisma.creatorDiamondWallet.findUnique({ where: { creatorId: userId } });
    if (!wallet) return { progress: 0, target: 1000 };
    const lifetime = await prisma.creatorDiamondLedgerEntry.aggregate({
      where: { walletId: wallet.id, direction: 'CREDIT' },
      _sum: { diamonds: true },
    });
    return { progress: Math.min(1000, lifetime._sum.diamonds ?? 0), target: 1000 };
  },
};

export async function checkAndUnlockAchievements(userId: string, candidateKeys: string[]): Promise<void> {
  if (candidateKeys.length === 0) return;

  const achievements = await prisma.achievement.findMany({ where: { active: true, criteriaKey: { in: candidateKeys } } });
  if (achievements.length === 0) return;

  const existing = await prisma.userAchievement.findMany({
    where: { userId, achievementId: { in: achievements.map((a) => a.id) } },
  });
  const existingByAchievementId = new Map(existing.map((e) => [e.achievementId, e]));

  for (const achievement of achievements) {
    const current = existingByAchievementId.get(achievement.id);
    if (current?.unlockedAt) continue;
    const evaluator = ACHIEVEMENT_EVALUATORS[achievement.criteriaKey];
    if (!evaluator) continue;

    try {
      const { progress, target } = await evaluator(userId);
      const unlocked = progress >= target;

      await prisma.userAchievement.upsert({
        where: { userId_achievementId: { userId, achievementId: achievement.id } },
        create: { userId, achievementId: achievement.id, progressValue: progress, unlockedAt: unlocked ? new Date() : null },
        update: { progressValue: progress, unlockedAt: unlocked ? new Date() : null },
      });

      if (unlocked && !current?.unlockedAt) {
        if (achievement.xpReward > 0) {
          await recordXP({
            ledger: 'USER',
            userId,
            sourceType: 'ACHIEVEMENT_UNLOCKED',
            sourceRefId: achievement.id,
            amount: achievement.xpReward,
            metadata: { achievementSlug: achievement.slug },
          });
        }
        await sendGamificationNotification(prisma, userId, 'ACHIEVEMENT_UNLOCKED', {
          achievementId: achievement.id,
          slug: achievement.slug,
          name: achievement.name,
        });
      }
    } catch (error) {
      logger.error({ error, userId, achievementSlug: achievement.slug }, 'gamification: achievement evaluation failed');
    }
  }
}
