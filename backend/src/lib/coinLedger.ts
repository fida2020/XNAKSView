import { Prisma, type CoinLedgerEntry, type CoinLedgerEntryType, type CoinWallet } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

const MAX_RETRIES = 5;

/** Every wallet mutation lives here — nothing else in the codebase should write `CoinWallet.balance` directly. */
export async function getOrCreateWallet(userId: string): Promise<CoinWallet> {
  const existing = await prisma.coinWallet.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.coinWallet.upsert({ where: { userId }, create: { userId }, update: {} });
}

interface LedgerOpParams {
  userId: string;
  amount: number;
  type: CoinLedgerEntryType;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey: string;
  notes?: string;
}

export class InsufficientCoinsError extends Error {
  constructor() {
    super('INSUFFICIENT_COINS');
  }
}

/** Returns the already-applied entry+wallet for a previously-seen `idempotencyKey`, or `null` if this is genuinely new. */
async function findExistingByIdempotencyKey(idempotencyKey: string): Promise<{ entry: CoinLedgerEntry; wallet: CoinWallet } | null> {
  const entry = await prisma.coinLedgerEntry.findUnique({ where: { idempotencyKey } });
  if (!entry) return null;
  const wallet = await prisma.coinWallet.findUniqueOrThrow({ where: { id: entry.walletId } });
  return { entry, wallet };
}

/**
 * Credits `amount` Coins to a user's wallet (a purchase, a refund reversal
 * being undone, an admin adjustment) inside a `Serializable` transaction —
 * same concurrency-safety pattern as Step 4's guest-slot accept and Step
 * 6's mutual-match detection: two concurrent credits for the same wallet
 * can't read a stale balance and overwrite each other's update, Postgres
 * aborts one as a serialization failure and it's retried here. Replaying
 * the same `idempotencyKey` (a retried webhook, a duplicated client
 * request) is a safe no-op that returns the original result, never a
 * second credit.
 */
export async function creditCoins(params: LedgerOpParams): Promise<{ entry: CoinLedgerEntry; wallet: CoinWallet }> {
  const existing = await findExistingByIdempotencyKey(params.idempotencyKey);
  if (existing) return existing;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const wallet = await tx.coinWallet.upsert({ where: { userId: params.userId }, create: { userId: params.userId }, update: {} });
          const afterBalance = wallet.balance + params.amount;
          const updatedWallet = await tx.coinWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
          const entry = await tx.coinLedgerEntry.create({
            data: {
              walletId: wallet.id,
              direction: 'CREDIT',
              type: params.type,
              amount: params.amount,
              beforeBalance: wallet.balance,
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
        // Lost the race to insert this idempotency key — someone else's
        // concurrent attempt for the same event won; return theirs.
        const raced = await findExistingByIdempotencyKey(params.idempotencyKey);
        if (raced) return raced;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < MAX_RETRIES) {
        continue;
      }
      throw error;
    }
  }
  throw new AppError('CONFLICT', 'Could not credit Coins due to repeated write conflicts — please try again');
}

/**
 * Debits `amount` Coins (a Gift send) inside the same Serializable pattern,
 * additionally re-checking sufficiency *inside* the transaction (never
 * trusting a balance read before the transaction started) — throws
 * `InsufficientCoinsError` without writing anything if the wallet can't
 * cover it, so a Gift send that fails this check never partially applies.
 */
export async function debitCoins(params: LedgerOpParams): Promise<{ entry: CoinLedgerEntry; wallet: CoinWallet }> {
  const existing = await findExistingByIdempotencyKey(params.idempotencyKey);
  if (existing) return existing;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Re-checked on every retry, not just once before the loop: a
          // same-idempotencyKey competitor (a real double-tap) may have
          // committed its debit between this attempt's serialization
          // failure and this retry, which would otherwise make an
          // already-fulfilled request look like a fresh one racing against
          // a now-lower balance and fail it as "insufficient" instead of
          // returning the original result.
          const raced = await tx.coinLedgerEntry.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
          if (raced) {
            const raceWallet = await tx.coinWallet.findUniqueOrThrow({ where: { id: raced.walletId } });
            return { entry: raced, wallet: raceWallet };
          }

          const wallet = await tx.coinWallet.upsert({ where: { userId: params.userId }, create: { userId: params.userId }, update: {} });
          if (wallet.balance < params.amount) {
            throw new InsufficientCoinsError();
          }
          const afterBalance = wallet.balance - params.amount;
          const updatedWallet = await tx.coinWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
          const entry = await tx.coinLedgerEntry.create({
            data: {
              walletId: wallet.id,
              direction: 'DEBIT',
              type: params.type,
              amount: params.amount,
              beforeBalance: wallet.balance,
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
      if (error instanceof InsufficientCoinsError) {
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
  throw new AppError('CONFLICT', 'Could not debit Coins due to repeated write conflicts — please try again');
}

/**
 * A refund/chargeback reversal (brief §14) — debits the purchase's original
 * `coinAmount` as an ADJUSTMENT, but never below zero: if the Coins were
 * already spent, the wallet is drained to zero and the shortfall is
 * recorded in `notes` rather than ever going negative. The reversal is
 * always a new immutable ledger row, never an edit to the original credit.
 */
export async function reverseCoinsForRefund(params: { userId: string; amount: number; referenceType: string; referenceId: string; idempotencyKey: string }): Promise<{ entry: CoinLedgerEntry; wallet: CoinWallet }> {
  const existing = await findExistingByIdempotencyKey(params.idempotencyKey);
  if (existing) return existing;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const wallet = await tx.coinWallet.upsert({ where: { userId: params.userId }, create: { userId: params.userId }, update: {} });
          const actualDebit = Math.min(params.amount, wallet.balance);
          const shortfall = params.amount - actualDebit;
          const afterBalance = wallet.balance - actualDebit;
          const updatedWallet = await tx.coinWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
          const entry = await tx.coinLedgerEntry.create({
            data: {
              walletId: wallet.id,
              direction: 'DEBIT',
              type: 'REFUND',
              amount: actualDebit,
              beforeBalance: wallet.balance,
              afterBalance,
              referenceType: params.referenceType,
              referenceId: params.referenceId,
              idempotencyKey: params.idempotencyKey,
              notes: shortfall > 0 ? `Requested reversal of ${params.amount} Coins; only ${actualDebit} were still available (${shortfall} already spent).` : undefined,
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
  throw new AppError('CONFLICT', 'Could not reverse Coins due to repeated write conflicts — please try again');
}
