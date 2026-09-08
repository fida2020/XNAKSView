import { Router } from 'express';

import { getCapabilityForCountry } from '@/lib/countryPayoutCapability';
import { resolveConfiguredKycProvider } from '@/lib/payout/identityVerificationProvider';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { startIdentityVerificationSchema } from '@/schemas/payoutMethod.schema';
import { AppError } from '@/utils/AppError';

/**
 * Automatic identity verification (KYC) — kept separate from
 * payout-method status, matching TikTok's own documented UX ("Verify
 * identity to collect payouts" as its own step). See
 * `lib/payout/identityVerificationProvider.ts` for why this stays its own
 * provider seam rather than being folded into `PayoutProvider`.
 */
export const identityVerificationRouter = Router();

const startLimiter = createAuthRateLimiter(60 * 1000, 5, 'start-identity-verification');

function mapStatus(status: 'PENDING' | 'VERIFIED' | 'REJECTED'): 'PENDING' | 'APPROVED' | 'REJECTED' {
  return status === 'VERIFIED' ? 'APPROVED' : status;
}

identityVerificationRouter.get('/creator/identity-verification', requireAuth, async (req, res, next) => {
  try {
    const verification = await prisma.verification.findFirst({ where: { userId: req.user!.id, verificationType: 'IDENTITY_DOCUMENT' }, orderBy: { createdAt: 'desc' } });
    if (!verification) {
      res.status(200).json({ verification: null });
      return;
    }
    res.status(200).json({
      verification: {
        id: verification.id,
        status: verification.status,
        provider: verification.provider,
        country: verification.country,
        hostedUrl: verification.hostedUrl,
        rejectionReason: verification.rejectionReason,
        verifiedAt: verification.verifiedAt,
        createdAt: verification.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

identityVerificationRouter.post('/creator/identity-verification/start', requireAuth, startLimiter, validate({ body: startIdentityVerificationSchema }), async (req, res, next) => {
  try {
    const { country } = req.body as { country: string };
    const capability = await getCapabilityForCountry(country);
    if (!capability) {
      throw new AppError('SERVICE_UNAVAILABLE', `Identity verification is not currently available for ${country}`);
    }
    const provider = resolveConfiguredKycProvider(capability.providerPriority);
    if (!provider) {
      throw new AppError('SERVICE_UNAVAILABLE', 'Identity verification service is currently unavailable for this country (no provider configured)');
    }

    const payoutMethod = await prisma.creatorPayoutMethod.findUnique({ where: { creatorId: req.user!.id } });

    let outcome;
    try {
      const result = await provider.startVerification({ creatorId: req.user!.id, country, existingPayoutBeneficiaryId: payoutMethod?.providerBeneficiaryId ?? undefined });
      if (!result.configured) {
        throw new AppError('SERVICE_UNAVAILABLE', result.reason);
      }
      outcome = result.outcome;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : 'Identity verification could not be started';
      throw new AppError('BAD_REQUEST', message);
    }

    const verification = await prisma.verification.create({
      data: {
        userId: req.user!.id,
        verificationType: 'IDENTITY_DOCUMENT',
        status: mapStatus(outcome.status),
        provider: provider.name,
        providerReferenceId: outcome.providerReferenceId,
        country,
        hostedUrl: outcome.hostedUrl,
        verifiedAt: outcome.status === 'VERIFIED' ? new Date() : null,
      },
    });

    res.status(201).json({ id: verification.id, status: verification.status, hostedUrl: verification.hostedUrl });
  } catch (error) {
    next(error);
  }
});
