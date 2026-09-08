import type { GamificationConfigKey } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * Admin-configurable gamification rules — same "never edited in place, only
 * superseded" posture as `DiamondEarnRate`/`DiamondRewardRate` (see
 * schema.prisma's Step 11 block): the most recent `GamificationConfig` row
 * for a key IS the current value; every prior row is automatically that
 * key's version history, and nothing here ever retroactively recalculates
 * XP already recorded under an older config version.
 *
 * These defaults are XNAKView's own numbers, not a claim about any private
 * TikTok formula — TikTok publishes no exact Fan Club/level scoring formula
 * (see the Step 11 completion report). An admin can override any of them via
 * `POST /admin/gamification/config` without a code deploy.
 */

export interface LevelThresholds {
  /** thresholds[i] = lifetime XP required to reach level i+2 (level 1 always starts at 0 XP). */
  thresholds: number[];
}

export interface XpAwardRules {
  FOLLOW_CREATED: number;
  CONTENT_PUBLISHED: number;
  LIVE_HOSTED_SESSION_PER_MINUTE: number;
  LIVE_WATCH_SESSION_PER_MINUTE: number;
  LIVE_WATCH_SESSION_MIN_MINUTES: number;
  GIFT_SENT_PER_100_COINS: number;
  GIFT_RECEIVED_PER_100_COINS: number;
  FAN_CLUB_JOIN: number;
  FAN_CLUB_ENGAGEMENT_DAILY: number;
}

export interface StreakRules {
  /** How many hours past UTC midnight a user still has to log today's activity before the streak resets, i.e. a grace window rather than a hard cutoff at 00:00. */
  graceHours: number;
  minWatchMinutesForLiveAttendanceCredit: number;
}

export interface LeaderboardSettings {
  /** Any subject with a RiskAssessment at or above this score in the lookback window is excluded from public rankings. */
  riskScoreExclusionThreshold: number;
  lookbackDays: number;
}

export interface AntiAbuseSettings {
  maxXpEventsPerUserPerHour: number;
}

type ConfigValueByKey = {
  USER_LEVEL_THRESHOLDS: LevelThresholds;
  CREATOR_LEVEL_THRESHOLDS: LevelThresholds;
  FAN_LEVEL_THRESHOLDS: LevelThresholds;
  XP_AWARD_RULES: XpAwardRules;
  STREAK_RULES: StreakRules;
  LEADERBOARD_SETTINGS: LeaderboardSettings;
  ANTI_ABUSE_SETTINGS: AntiAbuseSettings;
};

/** A gently-increasing curve (each level costs a bit more than the last) — an explicit, disclosed XNAKView rule, never presented as TikTok's real formula. */
function generateCurve(steps: number, base: number, growth: number): number[] {
  const out: number[] = [];
  let value = base;
  for (let i = 0; i < steps; i += 1) {
    out.push(Math.round(value));
    value *= growth;
  }
  return out;
}

const DEFAULTS: ConfigValueByKey = {
  USER_LEVEL_THRESHOLDS: { thresholds: generateCurve(50, 100, 1.15) },
  CREATOR_LEVEL_THRESHOLDS: { thresholds: generateCurve(50, 150, 1.18) },
  FAN_LEVEL_THRESHOLDS: { thresholds: generateCurve(50, 50, 1.12) },
  XP_AWARD_RULES: {
    FOLLOW_CREATED: 5,
    CONTENT_PUBLISHED: 20,
    LIVE_HOSTED_SESSION_PER_MINUTE: 2,
    LIVE_WATCH_SESSION_PER_MINUTE: 1,
    LIVE_WATCH_SESSION_MIN_MINUTES: 1,
    GIFT_SENT_PER_100_COINS: 5,
    GIFT_RECEIVED_PER_100_COINS: 10,
    FAN_CLUB_JOIN: 10,
    FAN_CLUB_ENGAGEMENT_DAILY: 15,
  },
  STREAK_RULES: {
    graceHours: 6,
    minWatchMinutesForLiveAttendanceCredit: 3,
  },
  LEADERBOARD_SETTINGS: {
    riskScoreExclusionThreshold: 40,
    lookbackDays: 30,
  },
  ANTI_ABUSE_SETTINGS: {
    maxXpEventsPerUserPerHour: 200,
  },
};

export async function getGamificationConfig<K extends GamificationConfigKey>(key: K): Promise<ConfigValueByKey[K]> {
  const row = await prisma.gamificationConfig.findFirst({ where: { key }, orderBy: { createdAt: 'desc' } });
  if (!row) return DEFAULTS[key];
  return row.value as unknown as ConfigValueByKey[K];
}

export async function setGamificationConfig<K extends GamificationConfigKey>(
  key: K,
  value: ConfigValueByKey[K],
  createdById: string,
): Promise<void> {
  await prisma.gamificationConfig.create({ data: { key, value: value as object, createdById } });
}

export function getDefaultGamificationConfig<K extends GamificationConfigKey>(key: K): ConfigValueByKey[K] {
  return DEFAULTS[key];
}

export const GAMIFICATION_CONFIG_KEYS: GamificationConfigKey[] = [
  'USER_LEVEL_THRESHOLDS',
  'CREATOR_LEVEL_THRESHOLDS',
  'FAN_LEVEL_THRESHOLDS',
  'XP_AWARD_RULES',
  'STREAK_RULES',
  'LEADERBOARD_SETTINGS',
  'ANTI_ABUSE_SETTINGS',
];
