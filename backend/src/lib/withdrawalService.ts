import { Prisma, type PayoutProviderType, type Withdrawal } from '@prisma/client';

import { env } from '@/config/env';
import { creditEarnings, InsufficientEarningsError } from '@/lib/earningsLedger';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

// Higher than `coinLedger.ts`'s MAX_RETRIES=5 — this transaction does more
// work per attempt (an extra existence check, an extra ledger write), so it
// holds its Serializable locks longer and collides more often under real
// concurrent load; jittered backoff (below) plus a slightly larger budget
// keeps a genuine double-tap reliably resolving to exactly one winner
// instead of occasionally exhausting retries into a spurious CONFLICT.
const MAX_RETRIES = 8;

/**
 * Step 9: the withdrawal state machine + atomic hold/reversal ledger
 * mechanics below are unchanged from Step 7/8 (still real, still atomic —
 * see `requestWithdrawal`/`reverseHoldAndFail`). What changed is WHO drives
 * the transitions: `withdrawalOrchestrator.ts` now drives
 * REQUESTED -> APPROVED -> PROCESSING -> PAID/FAILED automatically, no
 * human in the loop, immediately after `requestWithdrawal` succeeds. The
 * admin-facing functions here (`markReviewing`/`approveWithdrawal` with a
 * real `reviewedById`/`rejectWithdrawal`/`failWithdrawal` called from
 * `routes/v1/adminEconomy.ts`) still exist but are now an EXCEPTION-HANDLING
 * override path (a stuck PROCESSING row, a disputed fraud hold) — not the
 * default path a routine withdrawal ever takes.
 */

export interface WithdrawalEligibilityInput {
  userId: string;
  ageVerified: boolean;
  accountStatus: string;
  amountMinorUnits: number;
  payoutMethodStatus: string | null;
  identityVerificationStatus: string | null;
}

export interface WithdrawalEligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Server-side-only checks — every one of these must be independently
 * re-verified here even though some (account status, 18+) are already
 * enforced upstream by `requireAuth`, because a withdrawal is exactly the
 * kind of action where "trust the caller already checked" is not an
 * acceptable posture. Step 9 adds the two checks that were a disclosed gap
 * in Step 7: a VERIFIED payout method and a VERIFIED identity check —
 * both driven by real `lib/payout/*Provider.ts` calls, never assumed.
 */
export async function checkWithdrawalEligibility(input: WithdrawalEligibilityInput): Promise<WithdrawalEligibilityResult> {
  if (input.accountStatus !== 'ACTIVE') {
    return { eligible: false, reason: 'Your account is not in good standing' };
  }
  if (!input.ageVerified) {
    return { eligible: false, reason: 'Age verification is required to withdraw earnings' };
  }
  if (input.amountMinorUnits < env.WITHDRAWAL_MIN_AMOUNT_MINOR_UNITS) {
    return { eligible: false, reason: `The minimum withdrawal amount is ${env.WITHDRAWAL_MIN_AMOUNT_MINOR_UNITS} minor units` };
  }
  if (input.payoutMethodStatus !== 'VERIFIED') {
    return { eligible: false, reason: 'Add and verify a bank account before withdrawing' };
  }
  // `Verification.status` is `VerificationStatus` (PENDING/APPROVED/REJECTED/EXPIRED) —
  // `routes/v1/identityVerification.ts`'s `mapStatus` maps a provider's VERIFIED
  // outcome to DB status APPROVED; there is no DB status literally named "VERIFIED".
  if (input.identityVerificationStatus !== 'APPROVED') {
    return { eligible: false, reason: 'Verify your identity before withdrawing' };
  }

  const activeFraudHold = await prisma.fraudHold.findFirst({ where: { userId: input.userId, status: 'ACTIVE' } });
  if (activeFraudHold) {
    return { eligible: false, reason: 'Your account currently has a compliance hold on withdrawals' };
  }

  return { eligible: true };
}

export interface RequestWithdrawalParams {
  userId: string;
  ageVerified: boolean;
  accountStatus: string;
  amountMinorUnits: number;
  currency: string;
  provider: PayoutProviderType;
  destinationReference: string;
  idempotencyKey: string;
  payoutMethodStatus: string | null;
  identityVerificationStatus: string | null;
  countryCode: string;
  payoutMethodId: string;
  feeMinorUnits: number;
  netAmountMinorUnits: number;
}

export async function requestWithdrawal(params: RequestWithdrawalParams): Promise<Withdrawal> {
  const existing = await prisma.withdrawal.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) return existing;

  const eligibility = await checkWithdrawalEligibility({
    userId: params.userId,
    ageVerified: params.ageVerified,
    accountStatus: params.accountStatus,
    amountMinorUnits: params.amountMinorUnits,
    payoutMethodStatus: params.payoutMethodStatus,
    identityVerificationStatus: params.identityVerificationStatus,
  });
  if (!eligibility.eligible) {
    throw new AppError('FORBIDDEN', eligibility.reason ?? 'You are not currently eligible to withdraw');
  }

  // Hold the funds and create the Withdrawal row inside one Serializable
  // transaction, re-reading the wallet balance ON EVERY ATTEMPT rather than
  // trusting a value read before the transaction started — same
  // concurrency-safe pattern as `coinLedger.ts`'s `creditCoins`/`debitCoins`.
  // Without this, two concurrent withdrawal requests for the same creator
  // (different idempotency keys) could both read the same starting balance
  // and both succeed, double-spending the same funds — Postgres aborts one
  // as a serialization failure instead, and it's retried here.
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Re-checked on every attempt: a same-idempotencyKey competitor
          // (a real double-tap) may have committed between this attempt's
          // serialization failure and this retry.
          const raced = await tx.withdrawal.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
          if (raced) return raced;

          const earningsWallet = await tx.creatorEarningsWallet.findUnique({ where: { creatorId: params.userId } });
          if (!earningsWallet) {
            throw new AppError('BAD_REQUEST', 'You have no earnings wallet yet');
          }
          if (earningsWallet.balanceMinorUnits < params.amountMinorUnits) {
            throw new InsufficientEarningsError();
          }

          const withdrawal = await tx.withdrawal.create({
            data: {
              creatorId: params.userId,
              earningsWalletId: earningsWallet.id,
              amountMinorUnits: params.amountMinorUnits,
              currency: params.currency,
              provider: params.provider,
              destinationReference: params.destinationReference,
              status: 'REQUESTED',
              idempotencyKey: params.idempotencyKey,
              countryCode: params.countryCode,
              payoutMethodId: params.payoutMethodId,
              feeMinorUnits: params.feeMinorUnits,
              netAmountMinorUnits: params.netAmountMinorUnits,
            },
          });

          const afterBalance = earningsWallet.balanceMinorUnits - params.amountMinorUnits;
          await tx.creatorEarningsWallet.update({ where: { id: earningsWallet.id }, data: { balanceMinorUnits: afterBalance } });
          await tx.creatorEarningsLedgerEntry.create({
            data: {
              walletId: earningsWallet.id,
              direction: 'DEBIT',
              type: 'WITHDRAWAL_HOLD',
              amountMinorUnits: params.amountMinorUnits,
              currency: params.currency,
              beforeBalance: earningsWallet.balanceMinorUnits,
              afterBalance,
              referenceType: 'WITHDRAWAL',
              referenceId: withdrawal.id,
              idempotencyKey: `${params.idempotencyKey}:hold`,
            },
          });

          return withdrawal;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Lost the race to insert this idempotency key — someone else's
        // concurrent attempt for the same request won; return theirs.
        const raced = await prisma.withdrawal.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
        if (raced) return raced;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < MAX_RETRIES) {
        // A short random backoff before retrying — without it, two requests
        // kicked off at nearly the same instant (a real double-tap) tend to
        // redo the same sequence of queries at the same pace and keep
        // re-colliding in lockstep, burning through every retry. Jitter
        // breaks that cycle so one side reliably wins within a few attempts.
        await new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 40) * attempt));
        continue;
      }
      throw error;
    }
  }
  throw new AppError('CONFLICT', 'Could not create withdrawal due to repeated write conflicts — please try again');
}

async function loadWithdrawalOrThrow(id: string): Promise<Withdrawal> {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id } });
  if (!withdrawal) throw new AppError('NOT_FOUND', 'Withdrawal not found');
  return withdrawal;
}

/** Admin exception-override transition REQUESTED -> REVIEWING (e.g. investigating a disputed fraud hold). No ledger effect — the hold from `requestWithdrawal` already covers this state. */
export async function markReviewing(withdrawalId: string): Promise<Withdrawal> {
  const withdrawal = await loadWithdrawalOrThrow(withdrawalId);
  if (withdrawal.status !== 'REQUESTED') {
    throw new AppError('CONFLICT', 'Only a REQUESTED withdrawal can move to REVIEWING');
  }
  return prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'REVIEWING' } });
}

/** `reviewedById: null` = the automatic pipeline (`withdrawalOrchestrator.ts`) approved this; a real id = an admin used the exception-override path. */
export async function approveWithdrawal(withdrawalId: string, reviewedById: string | null): Promise<Withdrawal> {
  const withdrawal = await loadWithdrawalOrThrow(withdrawalId);
  if (withdrawal.status !== 'REQUESTED' && withdrawal.status !== 'REVIEWING') {
    throw new AppError('CONFLICT', 'Only a REQUESTED or REVIEWING withdrawal can be approved');
  }
  return prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'APPROVED', reviewedById } });
}

/** Marks an approved withdrawal as submitted to the real payout provider. */
export async function markProcessing(withdrawalId: string, providerPayoutId: string, providerStatus: string): Promise<Withdrawal> {
  const withdrawal = await loadWithdrawalOrThrow(withdrawalId);
  if (withdrawal.status !== 'APPROVED') {
    throw new AppError('CONFLICT', 'Only an APPROVED withdrawal can move to PROCESSING');
  }
  return prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'PROCESSING', providerPayoutId, providerStatus } });
}

/** Terminal success — the held funds are gone for good (no reversal); this is the one transition that never touches the earnings ledger, since `WITHDRAWAL_HOLD` already removed the balance at request time. Only ever called after a REAL provider confirmation (a webhook, or a reconciliation poll) — never optimistically. */
export async function markPaid(withdrawalId: string, providerStatus?: string): Promise<Withdrawal> {
  const withdrawal = await loadWithdrawalOrThrow(withdrawalId);
  if (withdrawal.status !== 'PROCESSING') {
    throw new AppError('CONFLICT', 'Only a PROCESSING withdrawal can be marked PAID');
  }
  return prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'PAID', processedAt: new Date(), providerStatus: providerStatus ?? withdrawal.providerStatus } });
}

/** Shared reversal path for REJECTED/FAILED/CANCELLED — returns the held amount to the creator's earnings balance via an immutable `WITHDRAWAL_REVERSAL` credit, never by editing the original hold entry. `reasonField` distinguishes a pre-submission refusal (`rejectionReason`) from a provider-side failure (`failureReason`). */
async function reverseHoldAndFail(withdrawalId: string, status: 'REJECTED' | 'FAILED' | 'CANCELLED', reason: string | undefined, reasonField: 'rejectionReason' | 'failureReason', fromStatuses: Withdrawal['status'][]): Promise<Withdrawal> {
  const withdrawal = await loadWithdrawalOrThrow(withdrawalId);
  if (!fromStatuses.includes(withdrawal.status)) {
    throw new AppError('CONFLICT', `Cannot move a withdrawal from ${withdrawal.status} to ${status}`);
  }

  await creditEarnings({
    creatorId: withdrawal.creatorId,
    amountMinorUnits: withdrawal.amountMinorUnits,
    currency: withdrawal.currency,
    type: 'WITHDRAWAL_REVERSAL',
    referenceType: 'WITHDRAWAL',
    referenceId: withdrawal.id,
    idempotencyKey: `${withdrawal.idempotencyKey}:reversal`,
  });

  return prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status, [reasonField]: reason } });
}

export async function rejectWithdrawal(withdrawalId: string, reason: string): Promise<Withdrawal> {
  return reverseHoldAndFail(withdrawalId, 'REJECTED', reason, 'rejectionReason', ['REQUESTED', 'REVIEWING']);
}

/** Provider-side failure — post-submission (invalid destination at the provider, a bounced transfer). `fromStatuses` includes APPROVED (submission itself threw) and PROCESSING (a later webhook/poll reports failure). */
export async function failWithdrawal(withdrawalId: string, reason: string): Promise<Withdrawal> {
  return reverseHoldAndFail(withdrawalId, 'FAILED', reason, 'failureReason', ['APPROVED', 'PROCESSING']);
}

export async function cancelWithdrawal(withdrawalId: string, requestingUserId: string): Promise<Withdrawal> {
  const withdrawal = await loadWithdrawalOrThrow(withdrawalId);
  if (withdrawal.creatorId !== requestingUserId) {
    throw new AppError('FORBIDDEN', 'You can only cancel your own withdrawal request');
  }
  return reverseHoldAndFail(withdrawalId, 'CANCELLED', undefined, 'rejectionReason', ['REQUESTED']);
}

// Re-exported so route handlers never need to reach into two different
// ledger modules to check "did the debit fail for lack of funds."
export { InsufficientEarningsError };
