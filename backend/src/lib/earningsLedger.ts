import { Prisma, type CreatorEarningsLedgerEntry, type CreatorEarningsWallet, type EarningsLedgerEntryType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

const MAX_RETRIES = 5;

/** Every wallet mutation lives here — nothing else in the codebase should write `CreatorEarningsWallet.balanceMinorUnits` directly. */
export async function getOrCreateEarningsWallet(creatorId: string): Promise<CreatorEarningsWallet> {
  const existing = await prisma.creatorEarningsWallet.findUnique({ where: { creatorId } });
  if (existing) return existing;
  return prisma.creatorEarningsWallet.upsert({ where: { creatorId }, create: { creatorId }, update: {} });
}

export class InsufficientEarningsError extends Error {
  constructor() {
    super('INSUFFICIENT_EARNINGS');
  }
}

interface EarningsOpParams {
  creatorId: string;
  amountMinorUnits: number;
  currency: string;
  type: EarningsLedgerEntryType;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey: string;
  notes?: string;
}

async function findExistingByIdempotencyKey(idempotencyKey: string): Promise<{ entry: CreatorEarningsLedgerEntry; wallet: CreatorEarningsWallet } | null> {
  const entry = await prisma.creatorEarningsLedgerEntry.findUnique({ where: { idempotencyKey } });
  if (!entry) return null;
  const wallet = await prisma.creatorEarningsWallet.findUniqueOrThrow({ where: { id: entry.walletId } });
  return { entry, wallet };
}

/**
 * Credits a creator's earnings wallet — used for `DIAMOND_REWARD` (Diamonds
 * converted to eligible cash-equivalent earnings via the current
 * `DiamondRewardRate`) and `WITHDRAWAL_REVERSAL` (an approved-then-failed
 * withdrawal's held amount returned). Same Serializable+retry+idempotency
 * pattern as `coinLedger.ts`/`diamondLedger.ts` — a retried request can
 * never double-credit.
 */
export async function creditEarnings(params: EarningsOpParams): Promise<{ entry: CreatorEarningsLedgerEntry; wallet: CreatorEarningsWallet }> {
  const existing = await findExistingByIdempotencyKey(params.idempotencyKey);
  if (existing) return existing;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const wallet = await tx.creatorEarningsWallet.upsert({ where: { creatorId: params.creatorId }, create: { creatorId: params.creatorId, currency: params.currency }, update: {} });
          const afterBalance = wallet.balanceMinorUnits + params.amountMinorUnits;
          const updatedWallet = await tx.creatorEarningsWallet.update({ where: { id: wallet.id }, data: { balanceMinorUnits: afterBalance } });
          const entry = await tx.creatorEarningsLedgerEntry.create({
            data: {
              walletId: wallet.id,
              direction: 'CREDIT',
              type: params.type,
              amountMinorUnits: params.amountMinorUnits,
              currency: params.currency,
              beforeBalance: wallet.balanceMinorUnits,
              afterBalance,
              referenceType: params.referenceType,
              referenceId: params.referenceId,
              idempotencyKey: params.idempotencyKey,
              notes: params.notes,
            },
          });
          return { entry, wallet: updatedWallet };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await findExistingByIdempotencyKey(params.idempotencyKey);
        if (raced) return raced;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < MAX_RETRIES) {
        continue;
      }
      throw error;
    }
  }
  throw new AppError('CONFLICT', 'Could not credit earnings due to repeated write conflicts — please try again');
}

/**
 * Debits a creator's earnings wallet — used ONLY for `WITHDRAWAL_HOLD`
 * (funds set aside the instant a withdrawal is REQUESTED, so the same
 * balance can never be withdrawn twice while the request is reviewed) and
 * admin `ADJUSTMENT`. Re-checks sufficiency inside the transaction and
 * throws `InsufficientEarningsError` without writing anything if the
 * wallet can't cover it — mirrors `coinLedger.ts`'s `debitCoins`.
 */
export async function debitEarnings(params: EarningsOpParams): Promise<{ entry: CreatorEarningsLedgerEntry; wallet: CreatorEarningsWallet }> {
  const existing = await findExistingByIdempotencyKey(params.idempotencyKey);
  if (existing) return existing;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Re-checked on every retry, not just once before the loop: a
          // same-idempotencyKey competitor may have committed its debit
          // between this attempt's serialization failure and this retry,
          // which would otherwise make an already-fulfilled request look
          // like a fresh one racing against a now-lower balance and fail it
          // as "insufficient" instead of returning the original result.
          const raced = await tx.creatorEarningsLedgerEntry.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
          if (raced) {
            const raceWallet = await tx.creatorEarningsWallet.findUniqueOrThrow({ where: { id: raced.walletId } });
            return { entry: raced, wallet: raceWallet };
          }

          const wallet = await tx.creatorEarningsWallet.upsert({ where: { creatorId: params.creatorId }, create: { creatorId: params.creatorId, currency: params.currency }, update: {} });
          if (wallet.balanceMinorUnits < params.amountMinorUnits) {
            throw new InsufficientEarningsError();
          }
          const afterBalance = wallet.balanceMinorUnits - params.amountMinorUnits;
          const updatedWallet = await tx.creatorEarningsWallet.update({ where: { id: wallet.id }, data: { balanceMinorUnits: afterBalance } });
          const entry = await tx.creatorEarningsLedgerEntry.create({
            data: {
              walletId: wallet.id,
              direction: 'DEBIT',
              type: params.type,
              amountMinorUnits: params.amountMinorUnits,
              currency: params.currency,
              beforeBalance: wallet.balanceMinorUnits,
              afterBalance,
              referenceType: params.referenceType,
              referenceId: params.referenceId,
              idempotencyKey: params.idempotencyKey,
              notes: params.notes,
            },
          });
          return { entry, wallet: updatedWallet };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof InsufficientEarningsError) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await findExistingByIdempotencyKey(params.idempotencyKey);
        if (raced) return raced;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < MAX_RETRIES) {
        continue;
      }
      throw error;
    }
  }
  throw new AppError('CONFLICT', 'Could not debit earnings due to repeated write conflicts — please try again');
}

/**
 * A reversal/chargeback clawback (Step 8 ad-revenue reversals) — debits up
 * to `amountMinorUnits`, but never below zero: if the creator already
 * withdrew/spent the earnings, the wallet is drained to zero and the
 * shortfall is recorded in `notes` rather than ever going negative. Same
 * "cap at available balance, note the shortfall" pattern as
 * `coinLedger.ts`'s `reverseCoinsForRefund`. Always a new immutable credit
 * row's opposite — never an edit to the original credit.
 */
export async function reverseEarnings(params: { creatorId: string; amountMinorUnits: number; currency: string; type: EarningsLedgerEntryType; referenceType: string; referenceId: string; idempotencyKey: string }): Promise<{ entry: CreatorEarningsLedgerEntry; wallet: CreatorEarningsWallet }> {
  const existing = await findExistingByIdempotencyKey(params.idempotencyKey);
  if (existing) return existing;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const raced = await tx.creatorEarningsLedgerEntry.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
          if (raced) {
            const raceWallet = await tx.creatorEarningsWallet.findUniqueOrThrow({ where: { id: raced.walletId } });
            return { entry: raced, wallet: raceWallet };
          }

          const wallet = await tx.creatorEarningsWallet.upsert({ where: { creatorId: params.creatorId }, create: { creatorId: params.creatorId, currency: params.currency }, update: {} });
          const actualDebit = Math.min(params.amountMinorUnits, wallet.balanceMinorUnits);
          const shortfall = params.amountMinorUnits - actualDebit;
          const afterBalance = wallet.balanceMinorUnits - actualDebit;
          const updatedWallet = await tx.creatorEarningsWallet.update({ where: { id: wallet.id }, data: { balanceMinorUnits: afterBalance } });
          const entry = await tx.creatorEarningsLedgerEntry.create({
            data: {
              walletId: wallet.id,
              direction: 'DEBIT',
              type: params.type,
              amountMinorUnits: actualDebit,
              currency: params.currency,
              beforeBalance: wallet.balanceMinorUnits,
              afterBalance,
              referenceType: params.referenceType,
              referenceId: params.referenceId,
              idempotencyKey: params.idempotencyKey,
              notes: shortfall > 0 ? `Requested reversal of ${params.amountMinorUnits}; only ${actualDebit} were still available (${shortfall} already withdrawn/spent).` : undefined,
            },
          });
          return { entry, wallet: updatedWallet };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await findExistingByIdempotencyKey(params.idempotencyKey);
        if (raced) return raced;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < MAX_RETRIES) {
        continue;
      }
      throw error;
    }
  }
  throw new AppError('CONFLICT', 'Could not reverse earnings due to repeated write conflicts — please try again');
}

/** The currently-active, effective-dated reward policy — never "most recent row" alone, since an admin may schedule a future rate ahead of time (see the model's own schema comment). Throws if none is configured, so a Diamond can never silently convert into $0. */
export async function getCurrentDiamondRewardRate(): Promise<{ id: string; diamondsRequired: number; rewardCurrency: string; rewardAmount: Prisma.Decimal }> {
  const now = new Date();
  const rate = await prisma.diamondRewardRate.findFirst({
    where: { active: true, effectiveFrom: { lte: now }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!rate) {
    throw new Error('No active Diamond reward rate is configured for the current time — an admin must set one before Diamonds can convert to earnings');
  }
  return rate;
}

/** Converts a Diamond amount into integer minor units of `rate.rewardCurrency`, proportional to the rate's `diamondsRequired`/`rewardAmount` pair — rounds DOWN, same "never grant more than the value actually supports" rule used throughout this ledger. */
export function calculateEarningsMinorUnits(diamonds: number, rate: { diamondsRequired: number; rewardAmount: Prisma.Decimal | string | number }): number {
  const rewardAmountMinorUnits = new Prisma.Decimal(rate.rewardAmount).times(100);
  return new Prisma.Decimal(diamonds).times(rewardAmountMinorUnits).dividedBy(rate.diamondsRequired).floor().toNumber();
}
