import { prisma } from '@/lib/prisma';

/**
 * Admin-configurable per-country payout policy (Step 9) — mirrors the
 * effective-dated admin-config pattern already used by
 * `monetizationEligibility.ts`/`DiamondRewardRate`. `enabled: false` (the
 * default for any country without a row) means XNAKView hasn't turned on
 * automatic payouts there yet — never an assumption that every country is
 * supported just because Airwallex might support it.
 */
export interface CountryPayoutCapabilitySnapshot {
  countryCode: string;
  currency: string;
  enabled: boolean;
  minPayoutMinorUnits: number;
  maxPayoutMinorUnits: number;
  feeFixedMinorUnits: number;
  feePercentBps: number;
  estimatedProcessingDays: number;
  providerPriority: string[];
}

export async function getCapabilityForCountry(countryCode: string): Promise<CountryPayoutCapabilitySnapshot | null> {
  const row = await prisma.countryPayoutCapability.findUnique({ where: { countryCode } });
  if (!row || !row.enabled) return null;
  return {
    countryCode: row.countryCode,
    currency: row.currency,
    enabled: row.enabled,
    minPayoutMinorUnits: row.minPayoutMinorUnits,
    maxPayoutMinorUnits: row.maxPayoutMinorUnits,
    feeFixedMinorUnits: row.feeFixedMinorUnits,
    feePercentBps: row.feePercentBps,
    estimatedProcessingDays: row.estimatedProcessingDays,
    providerPriority: row.providerPriority,
  };
}

export async function listEnabledCapabilities(): Promise<CountryPayoutCapabilitySnapshot[]> {
  const rows = await prisma.countryPayoutCapability.findMany({ where: { enabled: true }, orderBy: { countryCode: 'asc' } });
  return rows.map((row) => ({
    countryCode: row.countryCode,
    currency: row.currency,
    enabled: row.enabled,
    minPayoutMinorUnits: row.minPayoutMinorUnits,
    maxPayoutMinorUnits: row.maxPayoutMinorUnits,
    feeFixedMinorUnits: row.feeFixedMinorUnits,
    feePercentBps: row.feePercentBps,
    estimatedProcessingDays: row.estimatedProcessingDays,
    providerPriority: row.providerPriority,
  }));
}

/** Fee is transparent and computed BEFORE submission (brief: "creator ko withdrawal se pehle amount/fees/final expected payout clear dikhao"). Floor-rounded, same convention as `lib/platformRevenue.ts`. */
export function computeFee(amountMinorUnits: number, capability: CountryPayoutCapabilitySnapshot): { feeMinorUnits: number; netAmountMinorUnits: number } {
  const percentFee = Math.floor((amountMinorUnits * capability.feePercentBps) / 10_000);
  const feeMinorUnits = capability.feeFixedMinorUnits + percentFee;
  const netAmountMinorUnits = Math.max(0, amountMinorUnits - feeMinorUnits);
  return { feeMinorUnits, netAmountMinorUnits };
}
