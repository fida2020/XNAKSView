import { Prisma, type XPLedger, type XPSourceType } from '@prisma/client';

import { getGamificationConfig } from '@/lib/gamification/config';
import { computeLevelState } from '@/lib/gamification/levels';
import { sendGamificationNotification } from '@/lib/gamification/notifications';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * The one place any XP change is ever written — mirrors `coinLedger.ts`/
 * `diamondLedger.ts`'s own posture (append-only ledger row + a materialized
 * balance snapshot, both updated together). No route, job, or client input
 * ever writes `UserLevel.lifetimeXP`/`CreatorLevel.lifetimeXP`/
 * `FanClubMembership.lifetimeFanXP` directly — only this function does,
 * always derived from a real, already-committed platform event.
 *
 * XP is NEVER monetary — this never touches CoinWallet, CreatorDiamondWallet,
 * or CreatorEarningsWallet. It only ever reads facts those systems already
 * committed (e.g. a GiftTransaction's `totalCoins`) to decide how much XP to
 * award.
 */

export interface RecordXpParams {
  ledger: XPLedger;
  userId: string;
  /** "" for USER/CREATOR ledgers; the FanClub id for FAN ledger events. */
  scopeId?: string;
  sourceType: XPSourceType;
  /** Idempotency key material — e.g. a GiftTransaction id, a Follow edge key, a LiveSession id. */
  sourceRefId: string;
  amount: number;
  metadata?: Prisma.InputJsonValue;
}

export interface RecordXpResult {
  applied: boolean; // false if this was a duplicate (already-recorded) event
  excludedAsFraud: boolean;
  leveledUp: boolean;
}

async function isUnderActiveFraudHold(userId: string): Promise<boolean> {
  const hold = await prisma.fraudHold.findFirst({ where: { userId, status: 'ACTIVE' }, select: { id: true } });
  return Boolean(hold);
}

async function exceedsHourlyEventRate(userId: string, ledger: XPLedger): Promise<boolean> {
  const antiAbuse = await getGamificationConfig('ANTI_ABUSE_SETTINGS');
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.xPEvent.count({ where: { userId, ledger, createdAt: { gte: since } } });
  return count >= antiAbuse.maxXpEventsPerUserPerHour;
}

export async function recordXP(params: RecordXpParams): Promise<RecordXpResult> {
  const scopeId = params.scopeId ?? '';

  if (params.amount <= 0) {
    return { applied: false, excludedAsFraud: false, leveledUp: false };
  }

  const [fraudHeld, rateExceeded] = await Promise.all([
    isUnderActiveFraudHold(params.userId),
    exceedsHourlyEventRate(params.userId, params.ledger),
  ]);
  const excludedAsFraud = fraudHeld || rateExceeded;

  let created: { id: string } | null = null;
  try {
    const event = await prisma.xPEvent.create({
      data: {
        ledger: params.ledger,
        userId: params.userId,
        scopeId,
        sourceType: params.sourceType,
        sourceRefId: params.sourceRefId,
        amount: params.amount,
        balanceAfter: 0, // filled in below once the snapshot lock is held
        excludedAsFraud,
        exclusionReason: fraudHeld ? 'ACTIVE_FRAUD_HOLD' : rateExceeded ? 'HOURLY_XP_RATE_EXCEEDED' : null,
        metadata: params.metadata,
      },
    });
    created = event;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Already recorded (idempotent replay, e.g. a retried webhook/route
      // call) — never double-count, and never re-derive the snapshot either.
      return { applied: false, excludedAsFraud, leveledUp: false };
    }
    throw error;
  }

  if (excludedAsFraud) {
    return { applied: true, excludedAsFraud: true, leveledUp: false };
  }

  const leveledUp = await applyToSnapshot(params.ledger, params.userId, scopeId, params.amount);

  if (created) {
    // Best-effort snapshot of the post-award balance on the ledger row —
    // never re-read for correctness, purely for a human-readable audit trail.
    const lifetimeXP = await readLifetimeXp(params.ledger, params.userId, scopeId);
    await prisma.xPEvent.update({ where: { id: created.id }, data: { balanceAfter: lifetimeXP } }).catch(() => undefined);
  }

  return { applied: true, excludedAsFraud: false, leveledUp };
}

async function readLifetimeXp(ledger: XPLedger, userId: string, scopeId: string): Promise<number> {
  if (ledger === 'USER') {
    return (await prisma.userLevel.findUnique({ where: { userId } }))?.lifetimeXP ?? 0;
  }
  if (ledger === 'CREATOR') {
    return (await prisma.creatorLevel.findUnique({ where: { userId } }))?.lifetimeXP ?? 0;
  }
  const membership = await prisma.fanClubMembership.findUnique({ where: { fanClubId_fanId: { fanClubId: scopeId, fanId: userId } } });
  return membership?.lifetimeFanXP ?? 0;
}

async function applyToSnapshot(ledger: XPLedger, userId: string, scopeId: string, amount: number): Promise<boolean> {
  if (ledger === 'USER') {
    const thresholds = await getGamificationConfig('USER_LEVEL_THRESHOLDS');
    const existing = await prisma.userLevel.upsert({
      where: { userId },
      create: { userId, lifetimeXP: 0, currentLevel: 1, currentXP: 0, nextLevelXP: thresholds.thresholds[0] ?? 100 },
      update: {},
    });
    const newLifetime = existing.lifetimeXP + amount;
    const state = computeLevelState(newLifetime, thresholds);
    await prisma.userLevel.update({
      where: { userId },
      data: { lifetimeXP: newLifetime, currentLevel: state.level, currentXP: state.currentXP, nextLevelXP: state.nextLevelXP },
    });
    const leveledUp = state.level > existing.currentLevel;
    if (leveledUp) await onLevelUp('USER', userId, '', existing.currentLevel, state.level, newLifetime);
    return leveledUp;
  }

  if (ledger === 'CREATOR') {
    const thresholds = await getGamificationConfig('CREATOR_LEVEL_THRESHOLDS');
    const existing = await prisma.creatorLevel.upsert({
      where: { userId },
      create: { userId, lifetimeXP: 0, currentLevel: 1, currentXP: 0, nextLevelXP: thresholds.thresholds[0] ?? 150 },
      update: {},
    });
    const newLifetime = existing.lifetimeXP + amount;
    const state = computeLevelState(newLifetime, thresholds);
    await prisma.creatorLevel.update({
      where: { userId },
      data: { lifetimeXP: newLifetime, currentLevel: state.level, currentXP: state.currentXP, nextLevelXP: state.nextLevelXP },
    });
    const leveledUp = state.level > existing.currentLevel;
    if (leveledUp) await onLevelUp('CREATOR', userId, '', existing.currentLevel, state.level, newLifetime);
    return leveledUp;
  }

  // FAN ledger — snapshot lives on the FanClubMembership row.
  const membership = await prisma.fanClubMembership.findUnique({ where: { fanClubId_fanId: { fanClubId: scopeId, fanId: userId } } });
  if (!membership || membership.status !== 'ACTIVE') return false;

  const thresholds = await getGamificationConfig('FAN_LEVEL_THRESHOLDS');
  const newLifetime = membership.lifetimeFanXP + amount;
  const state = computeLevelState(newLifetime, thresholds);
  await prisma.fanClubMembership.update({
    where: { id: membership.id },
    data: { lifetimeFanXP: newLifetime, fanLevel: state.level, fanXP: state.currentXP, nextLevelXP: state.nextLevelXP },
  });
  const leveledUp = state.level > membership.fanLevel;
  if (leveledUp) await onLevelUp('FAN', userId, scopeId, membership.fanLevel, state.level, newLifetime);
  return leveledUp;
}

async function onLevelUp(ledger: XPLedger, userId: string, scopeId: string, fromLevel: number, toLevel: number, xpAtLevelUp: number): Promise<void> {
  try {
    await prisma.levelUpEvent.create({ data: { ledger, userId, scopeId, fromLevel, toLevel, xpAtLevelUp } });
    const type = ledger === 'USER' ? 'USER_LEVEL_UP' : ledger === 'CREATOR' ? 'CREATOR_LEVEL_UP' : 'FAN_LEVEL_UP';
    await sendGamificationNotification(prisma, userId, type, { fromLevel, toLevel, scopeId: scopeId || undefined });
  } catch (error) {
    logger.error({ error, ledger, userId, scopeId }, 'gamification: failed to record level-up event/notification');
  }
}
