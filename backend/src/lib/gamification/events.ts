import { checkAndUnlockAchievements } from '@/lib/gamification/achievementRules';
import { checkAndAwardBadges } from '@/lib/gamification/badgeRules';
import { getGamificationConfig } from '@/lib/gamification/config';
import { creditFanEngagement } from '@/lib/gamification/fanClub';
import { recordStreakActivity } from '@/lib/gamification/streaks';
import { logTeamActivity } from '@/lib/gamification/teams';
import { recordXP } from '@/lib/gamification/xpEngine';
import { logger } from '@/lib/logger';

/**
 * The centralized gamification event pipeline (brief: "User follows creator
 * -> event -> XP evaluation -> achievement evaluation -> badge evaluation ->
 * notification"). Every route/service that produces a gamification-relevant
 * fact calls exactly one function here, AFTER its own primary action (a
 * follow, a Gift, ending a LIVE session, publishing content) has already
 * fully committed — this module only ever READS already-committed facts and
 * WRITES gamification-only state (XPEvent, Streak, Badge/Achievement
 * unlocks, TeamActivityEntry). It never re-runs or duplicates a financial
 * ledger transaction (Coins/Diamonds/CreatorEarnings), and a failure here
 * never surfaces as a failure of the caller's own action — every entry point
 * below swallows and logs its own errors.
 */
async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logger.error({ error, label }, 'gamification: event handler failed');
  }
}

export function onFollowCreated(followerId: string, followingId: string): void {
  void safely('onFollowCreated', async () => {
    const rules = await getGamificationConfig('XP_AWARD_RULES');
    await recordXP({
      ledger: 'USER',
      userId: followerId,
      sourceType: 'FOLLOW_CREATED',
      sourceRefId: `${followerId}:${followingId}`,
      amount: rules.FOLLOW_CREATED,
    });
    await checkAndAwardBadges(followingId, ['FOLLOWERS_100', 'FOLLOWERS_1000']);
    await checkAndUnlockAchievements(followingId, ['FIRST_FOLLOWER_MILESTONE']);
  });
}

export function onContentPublished(userId: string, contentType: 'VIDEO' | 'PHOTO_POST' | 'TEXT_POST', contentId: string): void {
  void safely('onContentPublished', async () => {
    const rules = await getGamificationConfig('XP_AWARD_RULES');
    await recordXP({
      ledger: 'USER',
      userId,
      sourceType: 'CONTENT_PUBLISHED',
      sourceRefId: `${contentType}:${contentId}`,
      amount: rules.CONTENT_PUBLISHED,
    });
    await checkAndUnlockAchievements(userId, ['FIRST_POST']);
  });
}

export function onLiveSessionStarted(hostId: string): void {
  void safely('onLiveSessionStarted', async () => {
    await checkAndAwardBadges(hostId, ['FIRST_LIVE_HOSTED']);
    await checkAndUnlockAchievements(hostId, ['FIRST_LIVE']);
  });
}

export function onLiveSessionEnded(hostId: string, liveSessionId: string, durationMinutes: number): void {
  void safely('onLiveSessionEnded', async () => {
    if (durationMinutes <= 0) return;
    const rules = await getGamificationConfig('XP_AWARD_RULES');
    await recordXP({
      ledger: 'CREATOR',
      userId: hostId,
      sourceType: 'LIVE_HOSTED_SESSION',
      sourceRefId: liveSessionId,
      amount: Math.round(rules.LIVE_HOSTED_SESSION_PER_MINUTE * durationMinutes),
    });
    await recordStreakActivity(hostId, 'CREATOR_ACTIVITY');
    await checkAndAwardBadges(hostId, ['LIVE_HOST_10_SESSIONS']);
    await checkAndUnlockAchievements(hostId, ['LIVE_MILESTONE_10_SESSIONS']);
    await logTeamActivity(hostId, 'LIVE_HOURS_LOGGED', durationMinutes, { liveSessionId });
  });
}

export function onLiveWatchSession(viewerId: string, hostId: string, liveSessionId: string, durationMinutes: number): void {
  void safely('onLiveWatchSession', async () => {
    const rules = await getGamificationConfig('XP_AWARD_RULES');
    if (durationMinutes < rules.LIVE_WATCH_SESSION_MIN_MINUTES) return;

    await recordXP({
      ledger: 'USER',
      userId: viewerId,
      sourceType: 'LIVE_WATCH_SESSION',
      sourceRefId: `${liveSessionId}:${viewerId}`,
      amount: Math.round(rules.LIVE_WATCH_SESSION_PER_MINUTE * durationMinutes),
    });

    const streakRules = await getGamificationConfig('STREAK_RULES');
    if (durationMinutes >= streakRules.minWatchMinutesForLiveAttendanceCredit) {
      await recordStreakActivity(viewerId, 'LIVE_ATTENDANCE', hostId);
    }
    await creditFanEngagement(viewerId, hostId);
  });
}

export function onGiftTransaction(params: { senderId: string; recipientId: string; giftTransactionId: string; totalCoins: number }): void {
  void safely('onGiftTransaction', async () => {
    const { senderId, recipientId, giftTransactionId, totalCoins } = params;
    const rules = await getGamificationConfig('XP_AWARD_RULES');

    await recordXP({
      ledger: 'USER',
      userId: senderId,
      sourceType: 'GIFT_SENT',
      sourceRefId: giftTransactionId,
      amount: Math.max(1, Math.round((rules.GIFT_SENT_PER_100_COINS * totalCoins) / 100)),
    });
    await recordXP({
      ledger: 'CREATOR',
      userId: recipientId,
      sourceType: 'GIFT_RECEIVED',
      sourceRefId: giftTransactionId,
      amount: Math.max(1, Math.round((rules.GIFT_RECEIVED_PER_100_COINS * totalCoins) / 100)),
    });

    await checkAndAwardBadges(recipientId, ['FIRST_GIFT_RECEIVED']);
    await checkAndUnlockAchievements(senderId, ['FIRST_GIFT_SENT']);
    await checkAndUnlockAchievements(recipientId, ['FIRST_GIFT_RECEIVED', 'CREATOR_MILESTONE_1000_DIAMONDS']);
    await creditFanEngagement(senderId, recipientId);
    await logTeamActivity(recipientId, 'GIFT_RECEIVED', totalCoins, { giftTransactionId });
  });
}
