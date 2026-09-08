import type { LeaderboardPeriod, LeaderboardSnapshot, LeaderboardType } from '@prisma/client';

import { getGamificationConfig } from '@/lib/gamification/config';
import { prisma } from '@/lib/prisma';

/**
 * Precomputed-snapshot leaderboards (brief: "avoid expensive full-database
 * scans"). This codebase has no background job runner (video processing is
 * the same documented, disclosed limitation — see docs/ARCHITECTURE.md §6),
 * so a snapshot is recomputed lazily on read once it's stale rather than on
 * a cron: cheap for the common case (most reads hit a fresh cached
 * snapshot), and an admin can also force a recompute via
 * `POST /admin/gamification/leaderboards/recompute`.
 */

const SNAPSHOT_STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 100;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(weekNo)}`;
}

function periodRange(period: LeaderboardPeriod, now: Date): { key: string; start: Date; end: Date } {
  if (period === 'DAILY') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 86_400_000);
    return { key: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`, start, end };
  }
  if (period === 'WEEKLY') {
    const dayOfWeek = now.getUTCDay() || 7;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dayOfWeek - 1)));
    const end = new Date(start.getTime() + 7 * 86_400_000);
    return { key: isoWeekKey(now), start, end };
  }
  if (period === 'MONTHLY') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { key: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`, start, end };
  }
  return { key: 'ALL', start: new Date(0), end: now };
}

async function excludedSubjectIds(candidateUserIds: string[]): Promise<Set<string>> {
  if (candidateUserIds.length === 0) return new Set();
  const settings = await getGamificationConfig('LEADERBOARD_SETTINGS');
  const since = new Date(Date.now() - settings.lookbackDays * 86_400_000);

  const [heldUsers, riskyAssessments] = await Promise.all([
    prisma.fraudHold.findMany({ where: { userId: { in: candidateUserIds }, status: 'ACTIVE' }, select: { userId: true } }),
    prisma.riskAssessment.findMany({
      where: { userId: { in: candidateUserIds }, riskScore: { gte: settings.riskScoreExclusionThreshold }, createdAt: { gte: since } },
      select: { userId: true },
    }),
  ]);

  const excluded = new Set<string>();
  for (const h of heldUsers) excluded.add(h.userId);
  for (const r of riskyAssessments) if (r.userId) excluded.add(r.userId);
  return excluded;
}

async function computeRawScores(type: LeaderboardType, start: Date, end: Date, scopeId: string): Promise<Map<string, number>> {
  const scores = new Map<string, number>();

  if (type === 'CREATOR_DIAMONDS') {
    const grouped = await prisma.creatorDiamondLedgerEntry.groupBy({
      by: ['walletId'],
      where: { direction: 'CREDIT', createdAt: { gte: start, lt: end } },
      _sum: { diamonds: true },
    });
    if (grouped.length === 0) return scores;
    const wallets = await prisma.creatorDiamondWallet.findMany({ where: { id: { in: grouped.map((g) => g.walletId) } } });
    const walletToCreator = new Map(wallets.map((w) => [w.id, w.creatorId]));
    for (const g of grouped) {
      const creatorId = walletToCreator.get(g.walletId);
      if (creatorId) scores.set(creatorId, g._sum.diamonds ?? 0);
    }
    return scores;
  }

  if (type === 'GIFT_SENDERS') {
    const grouped = await prisma.giftTransaction.groupBy({
      by: ['senderId'],
      where: { createdAt: { gte: start, lt: end } },
      _sum: { totalCoins: true },
    });
    for (const g of grouped) scores.set(g.senderId, g._sum.totalCoins ?? 0);
    return scores;
  }

  if (type === 'LIVE_HOURS') {
    const sessions = await prisma.liveSession.findMany({
      where: { status: 'ENDED', endedAt: { gte: start, lt: end } },
      select: { hostId: true, startedAt: true, endedAt: true },
    });
    for (const session of sessions) {
      if (!session.endedAt) continue;
      const minutes = Math.max(0, Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60_000));
      scores.set(session.hostId, (scores.get(session.hostId) ?? 0) + minutes);
    }
    return scores;
  }

  if (type === 'FAN_CLUB_XP') {
    if (!scopeId) return scores;
    const grouped = await prisma.xPEvent.groupBy({
      by: ['userId'],
      where: { ledger: 'FAN', scopeId, excludedAsFraud: false, createdAt: { gte: start, lt: end } },
      _sum: { amount: true },
    });
    for (const g of grouped) scores.set(g.userId, g._sum.amount ?? 0);
    return scores;
  }

  // TEAM_PERFORMANCE — subjects are team ids, not user ids (no fraud-hold
  // filtering applies to a team id itself; per-contributor fraud exclusion
  // already happened at write time via TeamActivityEntry.excludedAsFraud).
  const entries = await prisma.teamActivityEntry.findMany({
    where: { excludedAsFraud: false, type: { in: ['LIVE_HOURS_LOGGED', 'GIFT_RECEIVED'] }, createdAt: { gte: start, lt: end } },
    select: { teamId: true, type: true, value: true },
  });
  for (const entry of entries) {
    const points = entry.type === 'GIFT_RECEIVED' ? Math.floor(entry.value / 10) : entry.value;
    scores.set(entry.teamId, (scores.get(entry.teamId) ?? 0) + points);
  }
  return scores;
}

export async function computeLeaderboard(type: LeaderboardType, period: LeaderboardPeriod, scopeId = ''): Promise<LeaderboardSnapshot> {
  const now = new Date();
  const { key, start, end } = periodRange(period, now);

  const rawScores = await computeRawScores(type, start, end, scopeId);
  const isTeamLeaderboard = type === 'TEAM_PERFORMANCE';
  const excluded = isTeamLeaderboard ? new Set<string>() : await excludedSubjectIds([...rawScores.keys()]);

  const ranked = [...rawScores.entries()]
    .filter(([subjectId, score]) => score > 0 && !excluded.has(subjectId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ENTRIES);

  const snapshot = await prisma.leaderboardSnapshot.upsert({
    where: { type_period_periodKey_scopeId: { type, period, periodKey: key, scopeId } },
    create: { type, period, periodKey: key, scopeId },
    update: { computedAt: now },
  });

  await prisma.leaderboardEntry.deleteMany({ where: { snapshotId: snapshot.id } });
  if (ranked.length > 0) {
    await prisma.leaderboardEntry.createMany({
      data: ranked.map(([subjectId, score], index) => ({ snapshotId: snapshot.id, subjectId, rank: index + 1, score: BigInt(Math.round(score)) })),
    });
  }

  return snapshot;
}

export async function getLeaderboard(type: LeaderboardType, period: LeaderboardPeriod, scopeId = '') {
  const now = new Date();
  const { key } = periodRange(period, now);

  let snapshot = await prisma.leaderboardSnapshot.findUnique({
    where: { type_period_periodKey_scopeId: { type, period, periodKey: key, scopeId } },
  });

  if (!snapshot || now.getTime() - snapshot.computedAt.getTime() > SNAPSHOT_STALE_AFTER_MS) {
    snapshot = await computeLeaderboard(type, period, scopeId);
  }

  const entries = await prisma.leaderboardEntry.findMany({ where: { snapshotId: snapshot.id }, orderBy: { rank: 'asc' } });
  return { snapshot, entries };
}
