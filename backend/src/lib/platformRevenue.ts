import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * The currently-active, effective-dated platform/creator split for Gift
 * revenue — NEVER an asserted real TikTok percentage. TikTok does not
 * publicly disclose its exact creator payout algorithm/percentage (verified
 * during Step 7 research; see docs/STEP7_PROGRESS.md), so XNAKView defines
 * its own number here, admin-configurable and versioned, and every Gift
 * snapshots which rule row it used via `PlatformRevenueLedgerEntry.ruleId`
 * — a later policy change never rewrites historical accounting.
 */
export async function getCurrentPlatformRevenueRule(applicableContext: string = 'GIFT'): Promise<{ id: string; platformSharePercent: Prisma.Decimal }> {
  const now = new Date();
  const rule = await prisma.platformRevenueRule.findFirst({
    where: { active: true, applicableContext, effectiveFrom: { lte: now }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!rule) {
    throw new Error(`No active PlatformRevenueRule is configured for context "${applicableContext}" — an admin must set one before Gifts can be sent`);
  }
  return rule;
}

/** Splits a Gift's total Coins into platform/creator shares — floors the platform's cut and gives the remainder to the creator, so the two shares always sum to exactly `totalCoins` with no Coin lost or invented by rounding. */
export function splitCoins(totalCoins: number, platformSharePercent: Prisma.Decimal | string | number): { platformShareCoins: number; creatorShareCoins: number } {
  const platformShareCoins = new Prisma.Decimal(totalCoins).times(new Prisma.Decimal(platformSharePercent)).dividedBy(100).floor().toNumber();
  return { platformShareCoins, creatorShareCoins: totalCoins - platformShareCoins };
}
