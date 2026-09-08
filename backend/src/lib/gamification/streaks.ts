import type { StreakType } from '@prisma/client';

import { getGamificationConfig } from '@/lib/gamification/config';
import { checkAndAwardBadges } from '@/lib/gamification/badgeRules';
import { recordXP } from '@/lib/gamification/xpEngine';
import { prisma } from '@/lib/prisma';

/**
 * An XNAKView-original mechanic — TikTok has only tested a limited, chat-
 * only DM streak (see the Step 11 completion report), not a LIVE-attendance/
 * Fan-Club/creator-activity streak. Server time is authoritative throughout:
 * every comparison here uses `new Date()`/UTC calendar days, never anything
 * the client reports about when "today" is.
 */

const MILESTONES = [3, 7, 14, 30, 50, 100];
/** Flat XP award per milestone reached — an explicit, disclosed XNAKView rule. */
const MILESTONE_XP_AWARD = 25;

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((utcMidnight(b).getTime() - utcMidnight(a).getTime()) / 86_400_000);
}

export interface StreakResult {
  currentCount: number;
  longestCount: number;
  milestoneReached: number | null;
}

/**
 * Records one day of activity toward a streak. Safe to call more than once
 * on the same UTC calendar day for the same (userId, type, scopeId) — only
 * the first call each day advances the count, every later one that day is a
 * no-op (never lets a user "farm" a streak by repeating an action).
 */
export async function recordStreakActivity(userId: string, type: StreakType, scopeId = ''): Promise<StreakResult> {
  const now = new Date();
  const rules = await getGamificationConfig('STREAK_RULES');

  const existing = await prisma.streak.upsert({
    where: { userId_type_scopeId: { userId, type, scopeId } },
    create: { userId, type, scopeId, currentCount: 0, longestCount: 0, lastActivityDate: null },
    update: {},
  });

  if (existing.lastActivityDate) {
    const gap = daysBetween(existing.lastActivityDate, now);
    if (gap === 0) {
      return { currentCount: existing.currentCount, longestCount: existing.longestCount, milestoneReached: null };
    }
    // A gap of exactly 1 day always continues the streak; a gap of 2 days
    // only still counts as "yesterday" while still inside the configured
    // grace window past UTC midnight — beyond that, the streak resets.
    const withinGrace = gap === 2 && now.getUTCHours() < rules.graceHours;
    const continued = gap === 1 || withinGrace;
    const newCount = continued ? existing.currentCount + 1 : 1;
    const newLongest = Math.max(existing.longestCount, newCount);

    const updated = await prisma.streak.update({
      where: { id: existing.id },
      data: { currentCount: newCount, longestCount: newLongest, lastActivityDate: now },
    });

    const milestoneReached = MILESTONES.includes(newCount) ? newCount : null;
    if (milestoneReached) await onMilestone(userId, type, scopeId, milestoneReached);

    return { currentCount: updated.currentCount, longestCount: updated.longestCount, milestoneReached };
  }

  const updated = await prisma.streak.update({
    where: { id: existing.id },
    data: { currentCount: 1, longestCount: Math.max(existing.longestCount, 1), lastActivityDate: now },
  });
  // Day 1 never itself hits a milestone — MILESTONES starts at 3.
  return { currentCount: updated.currentCount, longestCount: updated.longestCount, milestoneReached: null };
}

async function onMilestone(userId: string, type: StreakType, scopeId: string, milestone: number): Promise<void> {
  await recordXP({
    ledger: 'USER',
    userId,
    sourceType: 'STREAK_MILESTONE',
    sourceRefId: `${type}:${scopeId}:${milestone}`,
    amount: MILESTONE_XP_AWARD,
    metadata: { streakType: type, scopeId, milestone },
  });
  await checkAndAwardBadges(userId, ['CONSISTENCY_7_DAY_STREAK']);
}
