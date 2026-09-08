import type { Withdrawal } from '@prisma/client';

import { computeFee, getCapabilityForCountry } from '@/lib/countryPayoutCapability';
import { createAutomaticFraudHold, assessWithdrawalRisk } from '@/lib/fraudRiskEngine';
import { recordFinancialAudit } from '@/lib/financialAudit';
import { getPayoutProviderByName } from '@/lib/payout/payoutProvider';
import { prisma } from '@/lib/prisma';
import { approveWithdrawal, failWithdrawal, markPaid, markProcessing, requestWithdrawal, InsufficientEarningsError } from '@/lib/withdrawalService';
import { AppError } from '@/utils/AppError';

/**
 * The automation core (brief: "eligible earnings -> withdraw -> automatic
 * eligibility -> automatic KYC -> automatic fraud -> automatic routing ->
 * automatic bank-detail verification -> automatic payout request -> real
 * provider -> provider confirmation -> PAID -> automatic ledger update").
 * Nothing here is admin-driven. Every failure path throws BEFORE a hold is
 * created wherever possible; once a hold exists, failure always reverses
 * it via the existing `failWithdrawal`/`reverseHoldAndFail` mechanics —
 * never silently stranded funds.
 */
export interface RunAutomaticWithdrawalParams {
  userId: string;
  ageVerified: boolean;
  accountStatus: string;
  amountMinorUnits: number;
  currency: string;
  idempotencyKey: string;
}

export interface WithdrawalPreview {
  amountMinorUnits: number;
  currency: string;
  feeMinorUnits: number;
  netAmountMinorUnits: number;
  estimatedProcessingDays: number;
  countryCode: string;
}

async function loadPayoutContextOrThrow(userId: string): Promise<{
  payoutMethod: NonNullable<Awaited<ReturnType<typeof prisma.creatorPayoutMethod.findUnique>>>;
  identityStatus: string | null;
}> {
  const payoutMethod = await prisma.creatorPayoutMethod.findUnique({ where: { creatorId: userId } });
  if (!payoutMethod || payoutMethod.status !== 'VERIFIED') {
    throw new AppError('FORBIDDEN', 'Add and verify a bank account before withdrawing');
  }
  const identity = await prisma.verification.findFirst({ where: { userId, verificationType: 'IDENTITY_DOCUMENT' }, orderBy: { createdAt: 'desc' } });
  return { payoutMethod, identityStatus: identity ? identity.status : null };
}

/** Pure preview — no persistence, mirrors `earningsExchangeService.ts`'s `previewExchangeEarningsToCoins`. Backs the mobile confirmation screen's "amount / fee / FX / final expected payout" display, required before submission. */
export async function previewWithdrawal(userId: string, amountMinorUnits: number): Promise<WithdrawalPreview> {
  const { payoutMethod } = await loadPayoutContextOrThrow(userId);
  const capability = await getCapabilityForCountry(payoutMethod.country);
  if (!capability) {
    throw new AppError('SERVICE_UNAVAILABLE', `Payout is not currently available for ${payoutMethod.country}`);
  }
  if (amountMinorUnits < capability.minPayoutMinorUnits || amountMinorUnits > capability.maxPayoutMinorUnits) {
    throw new AppError('BAD_REQUEST', `Amount must be between ${capability.minPayoutMinorUnits} and ${capability.maxPayoutMinorUnits} ${capability.currency} minor units`);
  }
  const { feeMinorUnits, netAmountMinorUnits } = computeFee(amountMinorUnits, capability);
  return { amountMinorUnits, currency: capability.currency, feeMinorUnits, netAmountMinorUnits, estimatedProcessingDays: capability.estimatedProcessingDays, countryCode: capability.countryCode };
}

export async function runAutomaticWithdrawal(params: RunAutomaticWithdrawalParams): Promise<Withdrawal> {
  const existing = await prisma.withdrawal.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) return existing;

  const { payoutMethod, identityStatus } = await loadPayoutContextOrThrow(params.userId);

  const capability = await getCapabilityForCountry(payoutMethod.country);
  if (!capability) {
    throw new AppError('SERVICE_UNAVAILABLE', `Payout is not currently available for ${payoutMethod.country}`);
  }
  if (params.currency !== capability.currency) {
    throw new AppError('BAD_REQUEST', `Withdrawals for this payout method must be in ${capability.currency}`);
  }
  if (params.amountMinorUnits < capability.minPayoutMinorUnits || params.amountMinorUnits > capability.maxPayoutMinorUnits) {
    throw new AppError('BAD_REQUEST', `Amount must be between ${capability.minPayoutMinorUnits} and ${capability.maxPayoutMinorUnits} ${capability.currency} minor units`);
  }

  // The provider that owns this payout method's beneficiary id — resolved
  // once, at payout-method-add time, never re-resolved here (a beneficiary
  // id is only meaningful against the provider that issued it).
  const provider = getPayoutProviderByName(payoutMethod.provider);
  if (!provider || !provider.isConfigured() || !payoutMethod.providerBeneficiaryId) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Payout service is currently unavailable — the configured provider is not available on this server');
  }

  const risk = await assessWithdrawalRisk({
    creatorId: params.userId,
    amountMinorUnits: params.amountMinorUnits,
    payoutMethod: { country: payoutMethod.country, verifiedAt: payoutMethod.verifiedAt },
    profileCountry: (await prisma.profile.findUnique({ where: { userId: params.userId }, select: { country: true } }))?.country ?? null,
  });
  if (risk.blocked) {
    await createAutomaticFraudHold(params.userId, risk.reason ?? 'Automatic fraud/risk check blocked this withdrawal');
    await recordFinancialAudit({ actorId: null, action: 'FRAUD_HOLD_AUTO_CREATED', entityType: 'User', entityId: params.userId, metadata: { reason: risk.reason } });
    throw new AppError('FORBIDDEN', 'Your account currently has a compliance hold on withdrawals');
  }

  const { feeMinorUnits, netAmountMinorUnits } = computeFee(params.amountMinorUnits, capability);

  let withdrawal: Withdrawal;
  try {
    withdrawal = await requestWithdrawal({
      userId: params.userId,
      ageVerified: params.ageVerified,
      accountStatus: params.accountStatus,
      amountMinorUnits: params.amountMinorUnits,
      currency: params.currency,
      provider: payoutMethod.provider,
      destinationReference: payoutMethod.providerBeneficiaryId,
      idempotencyKey: params.idempotencyKey,
      payoutMethodStatus: payoutMethod.status,
      identityVerificationStatus: identityStatus,
      countryCode: payoutMethod.country,
      payoutMethodId: payoutMethod.id,
      feeMinorUnits,
      netAmountMinorUnits,
    });
  } catch (error) {
    if (error instanceof InsufficientEarningsError) {
      throw new AppError('BAD_REQUEST', 'Insufficient available earnings for this withdrawal amount');
    }
    throw error;
  }

  if (withdrawal.status !== 'REQUESTED') {
    // Idempotent replay of an already-progressed withdrawal.
    return withdrawal;
  }

  // No admin step: immediately approve and submit to the real provider.
  await approveWithdrawal(withdrawal.id, null);
  await recordFinancialAudit({ actorId: null, action: 'WITHDRAWAL_AUTO_APPROVED', entityType: 'Withdrawal', entityId: withdrawal.id });

  try {
    const payoutResult = await provider.createPayout({ beneficiaryId: payoutMethod.providerBeneficiaryId, amountMinorUnits: netAmountMinorUnits, currency: capability.currency, idempotencyKey: params.idempotencyKey });
    if (!payoutResult.configured) {
      const failed = await failWithdrawal(withdrawal.id, payoutResult.reason);
      await recordFinancialAudit({ actorId: null, action: 'WITHDRAWAL_AUTO_FAILED', entityType: 'Withdrawal', entityId: withdrawal.id, metadata: { reason: payoutResult.reason } });
      return failed;
    }

    const { outcome } = payoutResult;
    if (outcome.status === 'FAILED') {
      const failed = await failWithdrawal(withdrawal.id, outcome.failureReason ?? 'Provider rejected the payout');
      await recordFinancialAudit({ actorId: null, action: 'WITHDRAWAL_AUTO_FAILED', entityType: 'Withdrawal', entityId: withdrawal.id, metadata: { reason: outcome.failureReason } });
      return failed;
    }

    const processing = await markProcessing(withdrawal.id, outcome.providerPayoutId, outcome.status);
    await recordFinancialAudit({ actorId: null, action: 'WITHDRAWAL_AUTO_SUBMITTED', entityType: 'Withdrawal', entityId: withdrawal.id, metadata: { provider: provider.name, providerPayoutId: outcome.providerPayoutId } });

    // A provider that confirms synchronously (neither of ours does today,
    // both return PENDING) can still be marked PAID here — this is a REAL
    // provider confirmation just returned inline, not an optimistic guess.
    if (outcome.status === 'PAID') {
      const paid = await markPaid(processing.id, outcome.status);
      await recordFinancialAudit({ actorId: null, action: 'WITHDRAWAL_AUTO_PAID', entityType: 'Withdrawal', entityId: withdrawal.id });
      return paid;
    }

    return processing;
  } catch (error) {
    // Submission itself threw (e.g. MockPayoutProvider's SIMULATE_REJECT_AT_SUBMIT,
    // or a real provider HTTP failure) — automatic FAILED + reversal, never a stranded hold.
    const reason = error instanceof Error ? error.message : 'Payout provider submission failed';
    const failed = await failWithdrawal(withdrawal.id, reason);
    await recordFinancialAudit({ actorId: null, action: 'WITHDRAWAL_AUTO_FAILED', entityType: 'Withdrawal', entityId: withdrawal.id, metadata: { reason } });
    return failed;
  }
}
