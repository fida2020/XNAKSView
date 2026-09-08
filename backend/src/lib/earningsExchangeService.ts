import { Prisma, type EarningsCoinExchange } from '@prisma/client';

import { calculateCoinsFromEarnings, COIN_VALUE_PKR, getCurrentExchangeRate } from '@/lib/coinEconomy';
import { creditCoins } from '@/lib/coinLedger';
import { debitEarnings, InsufficientEarningsError } from '@/lib/earningsLedger';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

export { InsufficientEarningsError };

export interface ExchangeEarningsToCoinsParams {
  creatorId: string;
  amountMinorUnits: number;
  currency: string;
  idempotencyKey: string;
}

export interface SerializedEarningsCoinExchange {
  id: string;
  amountMinorUnits: number;
  currency: string;
  pkrPerUsdSnapshot: string;
  coinValuePkrSnapshot: string;
  coinsCredited: number;
  createdAt: Date;
}

export interface ExchangeEarningsToCoinsResult {
  exchange: SerializedEarningsCoinExchange;
  earningsBalance: number;
  coinBalance: number;
}

function serializeExchange(exchange: EarningsCoinExchange): SerializedEarningsCoinExchange {
  return {
    id: exchange.id,
    amountMinorUnits: exchange.amountMinorUnits,
    currency: exchange.currency,
    pkrPerUsdSnapshot: exchange.pkrPerUsdSnapshot.toFixed(4),
    coinValuePkrSnapshot: exchange.coinValuePkrSnapshot.toFixed(2),
    coinsCredited: exchange.coinsCredited,
    createdAt: exchange.createdAt,
  };
}

async function currentBalances(creatorId: string): Promise<{ earningsBalance: number; coinBalance: number }> {
  const [earningsWallet, coinWallet] = await Promise.all([
    prisma.creatorEarningsWallet.findUnique({ where: { creatorId } }),
    prisma.coinWallet.findUnique({ where: { userId: creatorId } }),
  ]);
  return { earningsBalance: earningsWallet?.balanceMinorUnits ?? 0, coinBalance: coinWallet?.balance ?? 0 };
}

/**
 * Preview-only: what a given Earnings amount would exchange to right now,
 * using the current live PKR/USD rate. Never persists anything — the
 * mobile confirmation dialog ("Exchange $10.00 to 1,866 Coins?") calls this
 * before the creator confirms; the actual exchange re-derives the same
 * number server-side at confirmation time rather than trusting whatever the
 * client displayed.
 */
export async function previewExchangeEarningsToCoins(creatorId: string, amountMinorUnits?: number): Promise<{ amountMinorUnits: number; currency: string; coins: number; pkrPerUsd: string; coinValuePkr: string }> {
  const wallet = await prisma.creatorEarningsWallet.findUnique({ where: { creatorId } });
  const currency = wallet?.currency ?? 'USD';
  const resolvedAmount = amountMinorUnits ?? wallet?.balanceMinorUnits ?? 0;

  const rate = await getCurrentExchangeRate();
  return {
    amountMinorUnits: resolvedAmount,
    currency,
    coins: resolvedAmount > 0 && currency === 'USD' ? calculateCoinsFromEarnings(resolvedAmount, rate.pkrPerUsd) : 0,
    pkrPerUsd: rate.pkrPerUsd.toFixed(4),
    coinValuePkr: COIN_VALUE_PKR.toFixed(2),
  };
}

/**
 * The ONLY leg of the economy that turns eligible cash-equivalent Earnings
 * back into spendable Coins — never a separate invented Diamond→Coin rate.
 * The authoritative chain is always Diamonds → DiamondRewardRate → Earnings
 * (USD minor units) → live PKR/USD ExchangeRate → locked COIN_VALUE_PKR →
 * Coins, computed fresh here and snapshotted immutably on the
 * `EarningsCoinExchange` row.
 *
 * Same two-ledger-legs pattern as `giftService.ts`'s Coin-debit +
 * Diamond-credit: the parent `EarningsCoinExchange` row's unique
 * `idempotencyKey` is checked first for whole-operation replay safety, then
 * the Earnings debit and Coin credit are each their own idempotent,
 * Serializable-transaction ledger write
 * (`${idempotencyKey}:earnings-debit` / `${idempotencyKey}:coin-credit`) —
 * a retried or resumed request can never double-debit or double-credit
 * either side, and a crash between the two steps is safely resumable.
 */
export async function exchangeEarningsToCoins(params: ExchangeEarningsToCoinsParams): Promise<ExchangeEarningsToCoinsResult> {
  const existing = await prisma.earningsCoinExchange.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) {
    const balances = await currentBalances(params.creatorId);
    return { exchange: serializeExchange(existing), ...balances };
  }

  if (params.currency !== 'USD') {
    throw new AppError('BAD_REQUEST', 'Only USD earnings can currently be exchanged to Coins');
  }
  if (!Number.isInteger(params.amountMinorUnits) || params.amountMinorUnits < 1) {
    throw new AppError('BAD_REQUEST', 'amountMinorUnits must be a positive integer');
  }

  const rate = await getCurrentExchangeRate();
  const coinsCredited = calculateCoinsFromEarnings(params.amountMinorUnits, rate.pkrPerUsd);
  if (coinsCredited < 1) {
    throw new AppError('BAD_REQUEST', 'This amount is too small to exchange for at least 1 Coin at the current rate');
  }

  // Debit first (mirrors giftService's Coin-debit-before-Diamond-credit
  // ordering) so an insufficient balance never creates a dangling exchange
  // row or a Coin credit with nothing backing it.
  await debitEarnings({
    creatorId: params.creatorId,
    amountMinorUnits: params.amountMinorUnits,
    currency: params.currency,
    type: 'EXCHANGE_TO_COINS',
    referenceType: 'EARNINGS_COIN_EXCHANGE',
    referenceId: params.idempotencyKey,
    idempotencyKey: `${params.idempotencyKey}:earnings-debit`,
  });

  let exchange: EarningsCoinExchange;
  try {
    exchange = await prisma.earningsCoinExchange.create({
      data: {
        creatorId: params.creatorId,
        amountMinorUnits: params.amountMinorUnits,
        currency: params.currency,
        exchangeRateId: rate.id,
        pkrPerUsdSnapshot: rate.pkrPerUsd,
        coinValuePkrSnapshot: COIN_VALUE_PKR,
        coinsCredited,
        idempotencyKey: params.idempotencyKey,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // A concurrent identical request won the race to create the row — the
      // Earnings debit above was already a safe no-op on their side via the
      // same idempotency key. Treat this exactly like a replay.
      exchange = await prisma.earningsCoinExchange.findUniqueOrThrow({ where: { idempotencyKey: params.idempotencyKey } });
    } else {
      throw error;
    }
  }

  const { wallet: coinWallet } = await creditCoins({
    userId: params.creatorId,
    amount: exchange.coinsCredited,
    type: 'EARNINGS_EXCHANGE',
    referenceType: 'EARNINGS_COIN_EXCHANGE',
    referenceId: exchange.id,
    idempotencyKey: `${params.idempotencyKey}:coin-credit`,
  });

  const earningsWallet = await prisma.creatorEarningsWallet.findUniqueOrThrow({ where: { creatorId: params.creatorId } });

  return {
    exchange: serializeExchange(exchange),
    earningsBalance: earningsWallet.balanceMinorUnits,
    coinBalance: coinWallet.balance,
  };
}
