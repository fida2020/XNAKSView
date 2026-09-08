import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * LOCKED — 1 XNAKView Coin = PKR 1.50, permanently. This is a literal
 * constant, never read from configuration or the database, so there is no
 * code path (admin or otherwise) that can change it. Only the PKR/USD
 * exchange rate is configurable (see `getCurrentExchangeRate`/`ExchangeRate`).
 */
export const COIN_VALUE_PKR = new Prisma.Decimal('1.50');

/** The most recently created rate row — admin "changes the rate" by inserting a new row, never by editing an old one. */
export async function getCurrentExchangeRate(): Promise<{ id: string; pkrPerUsd: Prisma.Decimal }> {
  const rate = await prisma.exchangeRate.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!rate) {
    throw new Error('No PKR/USD exchange rate has been configured yet — an admin must set one before Coins can be purchased');
  }
  return rate;
}

export interface CoinPricingSnapshot {
  baseUsdPrice: Prisma.Decimal;
  taxUsd: Prisma.Decimal;
  feeUsd: Prisma.Decimal;
  totalUsdPrice: Prisma.Decimal;
  exchangeRatePkrPerUsd: Prisma.Decimal;
  coinValuePkr: Prisma.Decimal;
  coinAmount: number;
}

/**
 * The one place the USD→PKR→Coins formula is computed — every caller
 * (package listing, purchase creation) goes through this, never a
 * reimplementation, so the locked rate and rounding rule can never drift
 * between call sites. Coins = FLOOR((USD base price × PKR/USD) / 1.50) —
 * rounds DOWN, per the explicit product rule, so a purchase can never
 * grant more Coins than the payment actually covers.
 */
export function calculateCoinPricing(
  pkg: { baseUsdPrice: Prisma.Decimal | string | number; taxUsd: Prisma.Decimal | string | number; feeUsd: Prisma.Decimal | string | number },
  exchangeRatePkrPerUsd: Prisma.Decimal | string | number,
): CoinPricingSnapshot {
  const baseUsdPrice = new Prisma.Decimal(pkg.baseUsdPrice);
  const taxUsd = new Prisma.Decimal(pkg.taxUsd);
  const feeUsd = new Prisma.Decimal(pkg.feeUsd);
  const rate = new Prisma.Decimal(exchangeRatePkrPerUsd);

  const totalUsdPrice = baseUsdPrice.plus(taxUsd).plus(feeUsd);
  // Coins are purchased with the base price only — tax/fee are
  // payment-processing charges, not additional Coin-buying power (matches
  // how a package's Coin amount is advertised before tax/fee are added).
  const pkrValue = baseUsdPrice.times(rate);
  const coinAmount = pkrValue.dividedBy(COIN_VALUE_PKR).floor().toNumber();

  return {
    baseUsdPrice,
    taxUsd,
    feeUsd,
    totalUsdPrice,
    exchangeRatePkrPerUsd: rate,
    coinValuePkr: COIN_VALUE_PKR,
    coinAmount,
  };
}

/**
 * Earnings (USD minor units, e.g. cents) → Coins — the ONLY leg that turns
 * eligible cash-equivalent Earnings back into spendable Coins, using the
 * SAME locked `COIN_VALUE_PKR` and the live PKR/USD `exchangeRatePkrPerUsd`
 * as every other Coin computation in this file. Never a separate invented
 * Diamond/Earnings→Coin rate — the authoritative chain is always Earnings
 * (USD) → live ExchangeRate → COIN_VALUE_PKR → Coins. Rounds DOWN, same
 * "never grant more Coins than the value actually covers" rule as
 * `calculateCoinPricing`.
 */
export function calculateCoinsFromEarnings(amountMinorUnits: number, exchangeRatePkrPerUsd: Prisma.Decimal | string | number): number {
  const usdValue = new Prisma.Decimal(amountMinorUnits).dividedBy(100);
  const pkrValue = usdValue.times(new Prisma.Decimal(exchangeRatePkrPerUsd));
  return pkrValue.dividedBy(COIN_VALUE_PKR).floor().toNumber();
}

export interface SerializedCoinPackage {
  id: string;
  baseUsdPrice: string;
  taxUsd: string;
  feeUsd: string;
  totalUsdPrice: string;
  exchangeRatePkrPerUsd: string;
  coinValuePkr: string;
  coinAmount: number;
  active: boolean;
  sortOrder: number;
}

/** Packages are always priced against the CURRENT rate — never a value stored on the package row itself (see the model's own schema comment). */
export function serializeCoinPackage(
  pkg: { id: string; baseUsdPrice: Prisma.Decimal; taxUsd: Prisma.Decimal; feeUsd: Prisma.Decimal; active: boolean; sortOrder: number },
  exchangeRatePkrPerUsd: Prisma.Decimal,
): SerializedCoinPackage {
  const pricing = calculateCoinPricing(pkg, exchangeRatePkrPerUsd);
  return {
    id: pkg.id,
    baseUsdPrice: pricing.baseUsdPrice.toFixed(2),
    taxUsd: pricing.taxUsd.toFixed(2),
    feeUsd: pricing.feeUsd.toFixed(2),
    totalUsdPrice: pricing.totalUsdPrice.toFixed(2),
    exchangeRatePkrPerUsd: pricing.exchangeRatePkrPerUsd.toFixed(4),
    coinValuePkr: pricing.coinValuePkr.toFixed(2),
    coinAmount: pricing.coinAmount,
    active: pkg.active,
    sortOrder: pkg.sortOrder,
  };
}
