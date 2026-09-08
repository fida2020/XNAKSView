import { Prisma } from '@prisma/client';

import { getGamificationConfig } from '@/lib/gamification/config';
import { sendGamificationNotification } from '@/lib/gamification/notifications';
import { recordStreakActivity } from '@/lib/gamification/streaks';
import { recordXP } from '@/lib/gamification/xpEngine';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

/**
 * XNAKView's own configurable equivalent of TikTok LIVE's Fan Club (join,
 * fan XP/level, badge, streaks, daily engagement). TikTok discloses the
 * existence of Fan Club levels/missions/badges but not its exact point
 * formula — every number here is an XNAKView rule set via
 * GamificationConfig's `FAN_LEVEL_THRESHOLDS`/`XP_AWARD_RULES` keys, never
 * presented as TikTok's real internals (see the Step 11 completion report).
 */

export async function getOrCreateFanClub(creatorId: string): Promise<{ id: string; name: string }> {
  const existing = await prisma.fanClub.findUnique({ where: { creatorId } });
  if (existing) return existing;
  const profile = await prisma.profile.findUnique({ where: { userId: creatorId } });
  const created = await prisma.fanClub.create({
    data: { creatorId, name: `${profile?.displayName ?? profile?.username ?? "Creator"}'s Fan Club` },
  });
  return created;
}

export async function joinFanClub(fanId: string, creatorId: string): Promise<void> {
  if (fanId === creatorId) {
    throw new AppError('BAD_REQUEST', 'You cannot join your own Fan Club');
  }
  const creator = await prisma.user.findUnique({ where: { id: creatorId }, select: { status: true } });
  if (!creator || creator.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 'Creator not found');
  }

  const fanClub = await getOrCreateFanClub(creatorId);
  const fanClubRow = await prisma.fanClub.findUniqueOrThrow({ where: { id: fanClub.id } });
  if (fanClubRow.status !== 'ACTIVE') {
    throw new AppError('FORBIDDEN', 'This Fan Club is not currently accepting members');
  }

  const existingMembership = await prisma.fanClubMembership.findUnique({
    where: { fanClubId_fanId: { fanClubId: fanClub.id, fanId } },
  });
  if (existingMembership?.status === 'ACTIVE') {
    return; // idempotent — already a member
  }

  const thresholds = await getGamificationConfig('FAN_LEVEL_THRESHOLDS');
  await prisma.$transaction(async (tx) => {
    if (existingMembership) {
      await tx.fanClubMembership.update({
        where: { id: existingMembership.id },
        data: { status: 'ACTIVE', joinedAt: new Date(), leftAt: null },
      });
    } else {
      await tx.fanClubMembership.create({
        data: { fanClubId: fanClub.id, fanId, nextLevelXP: thresholds.thresholds[0] ?? 50 },
      });
      await tx.fanClub.update({ where: { id: fanClub.id }, data: { memberCount: { increment: 1 } } });
    }
  });

  const rules = await getGamificationConfig('XP_AWARD_RULES');
  await recordXP({
    ledger: 'FAN',
    userId: fanId,
    scopeId: fanClub.id,
    sourceType: 'FAN_CLUB_JOIN',
    sourceRefId: fanClub.id,
    amount: rules.FAN_CLUB_JOIN,
  });
  await sendGamificationNotification(prisma, fanId, 'FAN_CLUB_JOINED', { creatorId, fanClubId: fanClub.id });
}

export async function leaveFanClub(fanId: string, creatorId: string): Promise<void> {
  const fanClub = await prisma.fanClub.findUnique({ where: { creatorId } });
  if (!fanClub) throw new AppError('NOT_FOUND', 'Fan Club not found');

  const updated = await prisma.fanClubMembership.updateMany({
    where: { fanClubId: fanClub.id, fanId, status: 'ACTIVE' },
    data: { status: 'LEFT', leftAt: new Date() },
  });
  if (updated.count === 0) {
    throw new AppError('NOT_FOUND', 'You are not a member of this Fan Club');
  }
  await prisma.fanClub.update({ where: { id: fanClub.id }, data: { memberCount: { decrement: 1 } } });
}

/**
 * Credits one calendar day of fan engagement (LIVE watched, a Gift sent to
 * this creator, chatting, etc. all route here) — idempotent per UTC day via
 * `recordStreakActivity`/`recordXP`'s own idempotency keys, so calling this
 * multiple times in one day from different triggers never double-counts.
 */
export async function creditFanEngagement(fanId: string, creatorId: string): Promise<void> {
  const fanClub = await prisma.fanClub.findUnique({ where: { creatorId } });
  if (!fanClub) return;

  const membership = await prisma.fanClubMembership.findUnique({
    where: { fanClubId_fanId: { fanClubId: fanClub.id, fanId } },
  });
  if (!membership || membership.status !== 'ACTIVE') return;

  const today = new Date().toISOString().slice(0, 10);
  const rules = await getGamificationConfig('XP_AWARD_RULES');
  await recordXP({
    ledger: 'FAN',
    userId: fanId,
    scopeId: fanClub.id,
    sourceType: 'FAN_CLUB_ENGAGEMENT',
    sourceRefId: today,
    amount: rules.FAN_CLUB_ENGAGEMENT_DAILY,
  });
  await recordStreakActivity(fanId, 'FAN_CLUB_ENGAGEMENT', fanClub.id);
}

export interface FanClubView {
  id: string;
  creatorId: string;
  name: string;
  badgeEmoji: string;
  memberCount: number;
  membership: {
    status: string;
    fanLevel: number;
    fanXP: number;
    nextLevelXP: number;
    lifetimeFanXP: number;
    joinedAt: Date;
  } | null;
}

export async function getFanClubView(creatorId: string, viewerId: string): Promise<FanClubView | null> {
  const fanClub = await prisma.fanClub.findUnique({ where: { creatorId } });
  if (!fanClub) return null;

  const membership = await prisma.fanClubMembership.findUnique({
    where: { fanClubId_fanId: { fanClubId: fanClub.id, fanId: viewerId } },
  });

  return {
    id: fanClub.id,
    creatorId: fanClub.creatorId,
    name: fanClub.name,
    badgeEmoji: fanClub.badgeEmoji,
    memberCount: fanClub.memberCount,
    membership:
      membership && membership.status === 'ACTIVE'
        ? {
            status: membership.status,
            fanLevel: membership.fanLevel,
            fanXP: membership.fanXP,
            nextLevelXP: membership.nextLevelXP,
            lifetimeFanXP: membership.lifetimeFanXP,
            joinedAt: membership.joinedAt,
          }
        : null,
  };
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
