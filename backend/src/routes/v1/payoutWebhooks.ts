import { Router } from 'express';

import { registerVerifiedIdentity } from '@/lib/moderation/identityTrust';
import { getPayoutProviderByName } from '@/lib/payout/payoutProvider';
import { prisma } from '@/lib/prisma';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { failWithdrawal, markPaid } from '@/lib/withdrawalService';
import { AppError } from '@/utils/AppError';

/**
 * Real, signature-verified, idempotent inbound webhooks from the payout
 * providers — the ONLY way a withdrawal can ever become PAID (see
 * `withdrawalOrchestrator.ts`'s comment: never optimistic). Unauthenticated
 * (a provider can't carry XNAKView's own session token) but never trusted
 * without a valid signature. One row per real event in
 * `PayoutProviderWebhookEvent` (`@@unique([provider, externalEventId])`)
 * makes replays a no-op, mirroring `routes/v1/monetization.ts`'s
 * `/ad-revenue/webhook`.
 *
 * Body shape: `{ eventType, externalEventId, providerPayoutId?,
 * providerReferenceId?, status?, failureReason?, signature }` where
 * `signature = HMAC-SHA256(<PROVIDER>_WEBHOOK_SECRET, JSON.stringify(payload-without-signature))`.
 * This mirrors this codebase's own established webhook convention (see
 * `lib/payout/airwallexClient.ts`'s/`payoneerClient.ts`'s doc comments) —
 * swap for each vendor's real header-based signing scheme once real
 * webhook secrets are issued.
 */
export const payoutWebhooksRouter = Router();

const webhookLimiter = createAuthRateLimiter(60 * 1000, 120, 'payout-webhook');

type WebhookEventType = 'PAYOUT_PAID' | 'PAYOUT_FAILED' | 'IDENTITY_VERIFIED' | 'IDENTITY_REJECTED' | 'PAYOUT_METHOD_VERIFIED' | 'PAYOUT_METHOD_REJECTED';

payoutWebhooksRouter.post('/webhooks/payout/:providerName', webhookLimiter, async (req, res, next) => {
  try {
    const providerName = req.params.providerName!.toUpperCase();
    const provider = getPayoutProviderByName(providerName);
    if (!provider) {
      throw new AppError('NOT_FOUND', `Unknown payout provider "${providerName}"`);
    }

    const { signature, ...payload } = req.body as Record<string, unknown>;
    if (typeof signature !== 'string') {
      throw new AppError('BAD_REQUEST', 'Missing signature');
    }
    if (!provider.verifyWebhookSignature(payload, signature)) {
      throw new AppError('UNAUTHORIZED', 'Invalid webhook signature');
    }

    const { eventType, externalEventId, providerPayoutId, providerReferenceId, failureReason } = payload as {
      eventType?: WebhookEventType;
      externalEventId?: string;
      providerPayoutId?: string;
      providerReferenceId?: string;
      failureReason?: string;
    };
    if (!eventType || !externalEventId) {
      throw new AppError('BAD_REQUEST', 'Missing eventType/externalEventId');
    }

    const existing = await prisma.payoutProviderWebhookEvent.findUnique({ where: { provider_externalEventId: { provider: providerName, externalEventId } } });
    if (existing?.processedAt) {
      res.status(200).json({ ok: true, alreadyProcessed: true });
      return;
    }

    const eventRow = existing ?? (await prisma.payoutProviderWebhookEvent.create({ data: { provider: providerName, externalEventId, eventType, payload: payload as never } }));

    switch (eventType) {
      case 'PAYOUT_PAID': {
        if (!providerPayoutId) throw new AppError('BAD_REQUEST', 'Missing providerPayoutId');
        const withdrawal = await prisma.withdrawal.findUnique({ where: { providerPayoutId } });
        if (withdrawal && withdrawal.status === 'PROCESSING') {
          await markPaid(withdrawal.id, 'PAID');
        }
        break;
      }
      case 'PAYOUT_FAILED': {
        if (!providerPayoutId) throw new AppError('BAD_REQUEST', 'Missing providerPayoutId');
        const withdrawal = await prisma.withdrawal.findUnique({ where: { providerPayoutId } });
        if (withdrawal && (withdrawal.status === 'PROCESSING' || withdrawal.status === 'APPROVED')) {
          await failWithdrawal(withdrawal.id, failureReason ?? 'Provider reported payout failure');
        }
        break;
      }
      case 'IDENTITY_VERIFIED':
      case 'IDENTITY_REJECTED': {
        if (!providerReferenceId) throw new AppError('BAD_REQUEST', 'Missing providerReferenceId');
        const verification = await prisma.verification.findFirst({ where: { providerReferenceId }, orderBy: { createdAt: 'desc' } });
        if (verification && verification.status === 'PENDING') {
          const providerApproved = eventType === 'IDENTITY_VERIFIED';
          // Step 10: "one verified identity = one account" (brief §6) — a
          // provider-side approval can still be refused here if this
          // real-world identity already belongs to another (or a
          // permanently banned) XNAKView account. Never marked APPROVED in
          // that case, regardless of what the KYC provider itself decided.
          const trustCheck = providerApproved ? await registerVerifiedIdentity(verification.userId, verification.provider ?? 'UNKNOWN', providerReferenceId) : null;
          const approved = providerApproved && (trustCheck?.allowed ?? false);
          const rejectionReason = !providerApproved ? (failureReason ?? 'Rejected by provider') : trustCheck && !trustCheck.allowed ? trustCheck.reason : null;
          await prisma.verification.update({
            where: { id: verification.id },
            data: { status: approved ? 'APPROVED' : 'REJECTED', verifiedAt: approved ? new Date() : null, rejectionReason },
          });
        }
        break;
      }
      case 'PAYOUT_METHOD_VERIFIED':
      case 'PAYOUT_METHOD_REJECTED': {
        if (!providerReferenceId) throw new AppError('BAD_REQUEST', 'Missing providerReferenceId');
        const method = await prisma.creatorPayoutMethod.findUnique({ where: { providerBeneficiaryId: providerReferenceId } });
        if (method && method.status === 'PENDING_VERIFICATION') {
          const verified = eventType === 'PAYOUT_METHOD_VERIFIED';
          await prisma.creatorPayoutMethod.update({
            where: { id: method.id },
            data: { status: verified ? 'VERIFIED' : 'REJECTED', verifiedAt: verified ? new Date() : null, rejectionReason: verified ? null : (failureReason ?? 'Rejected by provider') },
          });
        }
        break;
      }
      default:
        throw new AppError('BAD_REQUEST', `Unknown eventType "${eventType}"`);
    }

    await prisma.payoutProviderWebhookEvent.update({ where: { id: eventRow.id }, data: { processedAt: new Date() } });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});
