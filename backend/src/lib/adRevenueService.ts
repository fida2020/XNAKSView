import { Prisma, type AdRevenueEvent, type MonetizationStatus } from '@prisma/client';

import { creditEarnings, reverseEarnings } from '@/lib/earningsLedger';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

/** XNAKView's own locked default split — never a claim about any other platform's private revenue-share numbers. Used only when no admin `AdRevenueShareRule` has been configured yet (brief §8/§12: "default to 70% creator / 30% platform"). */
export const DEFAULT_CREATOR_SHARE_PERCENT = new Prisma.Decimal('70.00');
export const DEFAULT_PLATFORM_SHARE_PERCENT = new Prisma.Decimal('30.00');

export interface AdRevenueShareSnapshot {
  id: string | null;
  creatorSharePercent: Prisma.Decimal;
  platformSharePercent: Prisma.Decimal;
}

/** The currently-active, effective-dated creator/platform ad-revenue split — never "most recent row" alone (an admin may schedule a future change ahead of time). Falls back to the locked default when nothing has been configured, so the system works out of the box exactly as specified. */
export async function getCurrentAdRevenueShareRule(): Promise<AdRevenueShareSnapshot> {
  const now = new Date();
  const rule = await prisma.adRevenueShareRule.findFirst({
    where: { active: true, effectiveFrom: { lte: now }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!rule) return { id: null, creatorSharePercent: DEFAULT_CREATOR_SHARE_PERCENT, platformSharePercent: DEFAULT_PLATFORM_SHARE_PERCENT };
  return { id: rule.id, creatorSharePercent: rule.creatorSharePercent, platformSharePercent: rule.platformSharePercent };
}

/** A video can generate CREATOR-share revenue only if it's actually public/playable and its creator is in good standing (brief §10) — ads may still have served against it (platform still earns 100%), but a private/removed video or a non-active account never earns the creator anything. */
async function isVideoMonetizable(video: { status: string; visibility: string }, creatorStatus: string): Promise<boolean> {
  return video.status === 'READY' && video.visibility === 'PUBLIC' && creatorStatus === 'ACTIVE';
}

export interface RecordAdRevenueEventParams {
  provider: string;
  providerEventId: string;
  videoId: string;
  impressions?: number;
  validImpressions?: number;
  clicks?: number;
  grossRevenueMinorUnits: number;
  currency?: string;
  idempotencyKey: string;
}

export interface AdRevenueEventResult {
  event: AdRevenueEvent;
  creatorEarningsBalance: number | null;
}

/**
 * The ONLY place actual ad revenue is ever recorded — one immutable row per
 * real provider event (never a theoretical CPM/estimate). Whether the
 * creator earns a share depends ENTIRELY on their monetization status AT
 * THIS MOMENT (never retroactive — brief §2/§9): if they're not currently
 * ACTIVE, 100% goes to the platform and 0 is ever credited, permanently,
 * even if they become ACTIVE later. Idempotent on both `idempotencyKey`
 * and the natural `(provider, providerEventId)` pair, so a retried/
 * duplicated provider webhook can never be double-counted.
 */
export async function recordAdRevenueEvent(params: RecordAdRevenueEventParams): Promise<AdRevenueEventResult> {
  const existing = await prisma.adRevenueEvent.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) {
    const wallet = existing.creatorShareMinorUnits > 0 ? await prisma.creatorEarningsWallet.findUnique({ where: { creatorId: existing.creatorId } }) : null;
    return { event: existing, creatorEarningsBalance: wallet?.balanceMinorUnits ?? null };
  }

  if (!Number.isInteger(params.grossRevenueMinorUnits) || params.grossRevenueMinorUnits < 0) {
    throw new AppError('BAD_REQUEST', 'grossRevenueMinorUnits must be a non-negative integer');
  }

  const video = await prisma.video.findUnique({ where: { id: params.videoId }, select: { id: true, userId: true, status: true, visibility: true } });
  if (!video) {
    throw new AppError('NOT_FOUND', 'Video not found');
  }
  const creatorId = video.userId;

  const creator = await prisma.user.findUniqueOrThrow({ where: { id: creatorId }, select: { status: true } });
  const monetization = await prisma.creatorMonetization.upsert({
    where: { creatorId },
    create: { creatorId, status: 'NOT_ELIGIBLE' },
    update: {},
  });

  const videoMonetizable = await isVideoMonetizable(video, creator.status);
  const wasMonetizationActive = monetization.status === 'ACTIVE' && videoMonetizable;

  const currency = params.currency ?? 'USD';
  let creatorShareMinorUnits = 0;
  let platformShareMinorUnits = params.grossRevenueMinorUnits;
  let shareRuleId: string | null = null;
  let creatorSharePercentSnapshot: Prisma.Decimal | null = null;
  let platformSharePercentSnapshot: Prisma.Decimal | null = null;

  if (wasMonetizationActive) {
    const rule = await getCurrentAdRevenueShareRule();
    shareRuleId = rule.id;
    creatorSharePercentSnapshot = rule.creatorSharePercent;
    platformSharePercentSnapshot = rule.platformSharePercent;
    // Rounds DOWN for the creator's share, remainder to the platform — the
    // same "never grant more than the value actually supports" rule used
    // throughout this economy, and it guarantees creator+platform always
    // sum to exactly the gross amount (no rounding leakage either way).
    creatorShareMinorUnits = new Prisma.Decimal(params.grossRevenueMinorUnits).times(rule.creatorSharePercent).dividedBy(100).floor().toNumber();
    platformShareMinorUnits = params.grossRevenueMinorUnits - creatorShareMinorUnits;
  }

  let event: AdRevenueEvent;
  try {
    event = await prisma.adRevenueEvent.create({
      data: {
        type: 'REVENUE',
        provider: params.provider,
        providerEventId: params.providerEventId,
        videoId: video.id,
        creatorId,
        impressions: params.impressions ?? 0,
        validImpressions: params.validImpressions ?? 0,
        clicks: params.clicks,
        grossRevenueMinorUnits: params.grossRevenueMinorUnits,
        currency,
        status: 'CONFIRMED',
        monetizationStatusAtEvent: monetization.status,
        wasMonetizationActive,
        revenueShareRuleId: shareRuleId,
        creatorSharePercentSnapshot,
        platformSharePercentSnapshot,
        creatorShareMinorUnits,
        platformShareMinorUnits,
        idempotencyKey: params.idempotencyKey,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Lost the race to insert this exact provider event (or idempotency
      // key) — someone else's concurrent delivery of the same webhook won;
      // return theirs rather than double-recording.
      const raced = await prisma.adRevenueEvent.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
      if (raced) {
        const wallet = raced.creatorShareMinorUnits > 0 ? await prisma.creatorEarningsWallet.findUnique({ where: { creatorId: raced.creatorId } }) : null;
        return { event: raced, creatorEarningsBalance: wallet?.balanceMinorUnits ?? null };
      }
    }
    throw error;
  }

  let creatorEarningsBalance: number | null = null;
  if (creatorShareMinorUnits > 0) {
    const { wallet, entry } = await creditEarnings({
      creatorId,
      amountMinorUnits: creatorShareMinorUnits,
      currency,
      type: 'AD_REVENUE',
      referenceType: 'AD_REVENUE_EVENT',
      referenceId: event.id,
      idempotencyKey: `${params.idempotencyKey}:earnings-credit`,
    });
    creatorEarningsBalance = wallet.balanceMinorUnits;
    await prisma.adRevenueEvent.update({ where: { id: event.id }, data: { earningsLedgerEntryId: entry.id } }).catch(() => undefined);
  }

  return { event, creatorEarningsBalance };
}

export interface ReverseAdRevenueEventParams {
  originalEventId: string;
  reason: string;
  idempotencyKey: string;
}

/**
 * A chargeback/correction/fraud reversal (brief §11) — creates a NEW
 * `AdRevenueEvent` row (`type: REVERSAL`) with negated amounts, pointing
 * back at the original; the original REVENUE row is never edited. If the
 * creator's share was already credited, claws it back via
 * `reverseEarnings` (capped at their current balance — never goes
 * negative, records any shortfall).
 */
export async function reverseAdRevenueEvent(params: ReverseAdRevenueEventParams): Promise<AdRevenueEventResult> {
  const existing = await prisma.adRevenueEvent.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) {
    const wallet = await prisma.creatorEarningsWallet.findUnique({ where: { creatorId: existing.creatorId } });
    return { event: existing, creatorEarningsBalance: wallet?.balanceMinorUnits ?? null };
  }

  const original = await prisma.adRevenueEvent.findUnique({ where: { id: params.originalEventId } });
  if (!original) {
    throw new AppError('NOT_FOUND', 'Ad revenue event not found');
  }
  if (original.type !== 'REVENUE') {
    throw new AppError('BAD_REQUEST', 'Only an original REVENUE event can be reversed');
  }

  let reversal: AdRevenueEvent;
  try {
    reversal = await prisma.adRevenueEvent.create({
      data: {
        type: 'REVERSAL',
        provider: original.provider,
        providerEventId: `${original.providerEventId}:reversal:${params.idempotencyKey}`,
        videoId: original.videoId,
        creatorId: original.creatorId,
        impressions: -original.impressions,
        validImpressions: -original.validImpressions,
        clicks: original.clicks != null ? -original.clicks : null,
        grossRevenueMinorUnits: -original.grossRevenueMinorUnits,
        currency: original.currency,
        status: 'CONFIRMED',
        monetizationStatusAtEvent: original.monetizationStatusAtEvent,
        wasMonetizationActive: original.wasMonetizationActive,
        revenueShareRuleId: original.revenueShareRuleId,
        creatorSharePercentSnapshot: original.creatorSharePercentSnapshot,
        platformSharePercentSnapshot: original.platformSharePercentSnapshot,
        creatorShareMinorUnits: -original.creatorShareMinorUnits,
        platformShareMinorUnits: -original.platformShareMinorUnits,
        reversalOfEventId: original.id,
        idempotencyKey: params.idempotencyKey,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await prisma.adRevenueEvent.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
      if (raced) {
        const wallet = await prisma.creatorEarningsWallet.findUnique({ where: { creatorId: raced.creatorId } });
        return { event: raced, creatorEarningsBalance: wallet?.balanceMinorUnits ?? null };
      }
    }
    throw error;
  }

  let creatorEarningsBalance: number | null = null;
  if (original.creatorShareMinorUnits > 0) {
    const { wallet, entry } = await reverseEarnings({
      creatorId: original.creatorId,
      amountMinorUnits: original.creatorShareMinorUnits,
      currency: original.currency,
      type: 'AD_REVENUE_REVERSAL',
      referenceType: 'AD_REVENUE_EVENT',
      referenceId: reversal.id,
      idempotencyKey: `${params.idempotencyKey}:earnings-reversal`,
    });
    creatorEarningsBalance = wallet.balanceMinorUnits;
    await prisma.adRevenueEvent.update({ where: { id: reversal.id }, data: { earningsLedgerEntryId: entry.id } }).catch(() => undefined);
  }

  return { event: reversal, creatorEarningsBalance };
}

export type { MonetizationStatus };
