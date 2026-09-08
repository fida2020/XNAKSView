import { Prisma, type CreatorDiamondLedgerEntry, type CreatorDiamondWallet, type DiamondSourceType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

const MAX_RETRIES = 5;

/** Every wallet mutation lives here — nothing else in the codebase should write `CreatorDiamondWallet.balance` directly. */
export async function getOrCreateDiamondWallet(creatorId: string): Promise<CreatorDiamondWallet> {
  const existing = await prisma.creatorDiamondWallet.findUnique({ where: { creatorId } });
  if (existing) return existing;
  return prisma.creatorDiamondWallet.upsert({ where: { creatorId }, create: { creatorId }, update: {} });
}

interface DiamondLedgerOpParams {
  creatorId: string;
  diamonds: number;
  sourceType: DiamondSourceType;
  giftTransactionId?: string;
  idempotencyKey: string;
  notes?: string;
}

/** Returns the already-applied entry+wallet for a previously-seen `idempotencyKey`, or `null` if this is genuinely new. */
async function findExistingByIdempotencyKey(idempotencyKey: string): Promise<{ entry: CreatorDiamondLedgerEntry; wallet: CreatorDiamondWallet } | null> {
  const entry = await prisma.creatorDiamondLedgerEntry.findUnique({ where: { idempotencyKey } });
  if (!entry) return null;
  const wallet = await prisma.creatorDiamondWallet.findUniqueOrThrow({ where: { id: entry.walletId } });
  return { entry, wallet };
}

/**
 * Credits Diamonds to a creator's wallet — the ONLY caller of this is
 * `giftService.sendGift()`, converting a Gift's creator-share Coins into
 * Diamonds via the current `DiamondEarnRate` (never a manual/client-supplied
 * amount, never 1 Coin = 1 Diamond by default). Same Serializable+retry
 * concurrency-safety pattern as `coinLedger.ts`'s `creditCoins`, and the
 * same idempotency-key safe-replay guarantee — a retried Gift-send request
 * or a webhook replay can never double-credit Diamonds.
 */
export async function creditDiamonds(params: DiamondLedgerOpParams): Promise<{ entry: CreatorDiamondLedgerEntry; wallet: CreatorDiamondWallet }> {
  const existing = await findExistingByIdempotencyKey(params.idempotencyKey);
  if (existing) return existing;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const wallet = await tx.creatorDiamondWallet.upsert({ where: { creatorId: params.creatorId }, create: { creatorId: params.creatorId }, update: {} });
          const afterBalance = wallet.balance + params.diamonds;
          const updatedWallet = await tx.creatorDiamondWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
          const entry = await tx.creatorDiamondLedgerEntry.create({
            data: {
              walletId: wallet.id,
              direction: 'CREDIT',
              sourceType: params.sourceType,
              giftTransactionId: params.giftTransactionId,
              diamonds: params.diamonds,
              beforeBalance: wallet.balance,
              afterBalance,
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
        // concurrent attempt for the same Gift won; return theirs.
        const raced = await findExistingByIdempotencyKey(params.idempotencyKey);
        if (raced) return raced;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < MAX_RETRIES) {
        continue;
      }
      throw error;
    }
  }
  throw new AppError('CONFLICT', 'Could not credit Diamonds due to repeated write conflicts — please try again');
}

/**
 * Debits Diamonds — used only for an admin-driven `ADJUSTMENT` (e.g.
 * reversing a fraudulently-attributed Gift's Diamond credit). Diamonds are
 * never spent by a creator action; there is no "creator spends Diamonds"
 * flow anywhere in Step 7. Caps the debit at the available balance and
 * records any shortfall in `notes` rather than ever going negative, same
 * safety rule as `coinLedger.ts`'s `reverseCoinsForRefund`.
 */
export async function debitDiamondsForAdjustment(params: { creatorId: string; diamonds: number; idempotencyKey: string; notes?: string }): Promise<{ entry: CreatorDiamondLedgerEntry; wallet: CreatorDiamondWallet }> {
  const existing = await findExistingByIdempotencyKey(params.idempotencyKey);
  if (existing) return existing;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const wallet = await tx.creatorDiamondWallet.upsert({ where: { creatorId: params.creatorId }, create: { creatorId: params.creatorId }, update: {} });
          const actualDebit = Math.min(params.diamonds, wallet.balance);
          const shortfall = params.diamonds - actualDebit;
          const afterBalance = wallet.balance - actualDebit;
          const updatedWallet = await tx.creatorDiamondWallet.update({ where: { id: wallet.id }, data: { balance: afterBalance } });
          const entry = await tx.creatorDiamondLedgerEntry.create({
            data: {
              walletId: wallet.id,
              direction: 'DEBIT',
              sourceType: 'ADJUSTMENT',
              diamonds: actualDebit,
              beforeBalance: wallet.balance,
              afterBalance,
              idempotencyKey: params.idempotencyKey,
              notes: shortfall > 0 ? `${params.notes ?? ''} Requested reversal of ${params.diamonds} Diamonds; only ${actualDebit} were still available (${shortfall} already converted to earnings).`.trim() : params.notes,
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
  throw new AppError('CONFLICT', 'Could not debit Diamonds due to repeated write conflicts — please try again');
}

/** The most recently created rate row — admin "changes the rate" by inserting a new row, never by editing an old one. Same pattern as `coinEconomy.ts`'s `getCurrentExchangeRate`. */
export async function getCurrentDiamondEarnRate(): Promise<{ id: string; coinsPerDiamond: Prisma.Decimal }> {
  const rate = await prisma.diamondEarnRate.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!rate) {
    throw new Error('No Coins-per-Diamond rate has been configured yet — an admin must set one before Gifts can allocate Diamonds');
  }
  return rate;
}

/** Converts a creator's Coin share of a Gift into whole Diamonds — rounds DOWN, same "never grant more than the value actually supports" rule as the Coin-purchase formula. */
export function calculateDiamonds(creatorShareCoins: number, coinsPerDiamond: Prisma.Decimal | string | number): number {
  return new Prisma.Decimal(creatorShareCoins).dividedBy(new Prisma.Decimal(coinsPerDiamond)).floor().toNumber();
}
