import { Router } from 'express';
import type { PayoutProviderType } from '@prisma/client';

import { isTest } from '@/config/env';
import { getCapabilityForCountry, listEnabledCapabilities } from '@/lib/countryPayoutCapability';
import { resolveConfiguredProvider } from '@/lib/payout/payoutProvider';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { addPayoutMethodSchema, payoutMethodSchemaQuerySchema } from '@/schemas/payoutMethod.schema';
import { AppError } from '@/utils/AppError';

/**
 * Creator payout method (bank account) — one per creator (mirrors TikTok's
 * own single-payout-method Balance UX). Country-specific fields are NEVER
 * hardcoded here: `GET /schema` proxies whichever real provider is
 * configured for that country's dynamic field list.
 */
export const payoutMethodsRouter = Router();

const addLimiter = createAuthRateLimiter(60 * 1000, 5, 'add-payout-method');

/** Keeps only display-safe fragments — never the full account number/IBAN. */
function maskBankDetails(accountHolderName: string, bankDetails: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = { accountHolderName };
  for (const [key, value] of Object.entries(bankDetails)) {
    const isSensitive = /account|iban|number/i.test(key);
    masked[key] = isSensitive && value.length > 4 ? `••••${value.slice(-4)}` : value;
  }
  return masked;
}

/**
 * Countries the creator can actually pick when adding a bank account — the
 * client-side source of truth for the country picker in the "Bank Account"
 * step, so the mobile app never hardcodes a country list (brief: "do not
 * hard-code Pakistan-only logic", "do not assume PK/IN/GB/US/DE are the
 * complete supported list"). Just `countryCode`/`currency` — never limits,
 * fees, or `providerPriority`, which stay admin/internal-only.
 */
payoutMethodsRouter.get('/creator/payout-method/countries', requireAuth, async (_req, res, next) => {
  try {
    const capabilities = await listEnabledCapabilities();
    res.status(200).json({ countries: capabilities.map((c) => ({ countryCode: c.countryCode, currency: c.currency })) });
  } catch (error) {
    next(error);
  }
});

payoutMethodsRouter.get('/creator/payout-method', requireAuth, async (req, res, next) => {
  try {
    const method = await prisma.creatorPayoutMethod.findUnique({ where: { creatorId: req.user!.id } });
    if (!method) {
      res.status(200).json({ payoutMethod: null });
      return;
    }
    res.status(200).json({
      payoutMethod: {
        id: method.id,
        country: method.country,
        currency: method.currency,
        provider: method.provider,
        bankDetailsMasked: method.bankDetailsMasked,
        status: method.status,
        rejectionReason: method.rejectionReason,
        verifiedAt: method.verifiedAt,
        createdAt: method.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

payoutMethodsRouter.get('/creator/payout-method/schema', requireAuth, validate({ query: payoutMethodSchemaQuerySchema }), async (req, res, next) => {
  try {
    const { country, currency } = req.query as unknown as { country: string; currency: string };
    const capability = await getCapabilityForCountry(country);
    if (!capability || capability.currency !== currency) {
      throw new AppError('SERVICE_UNAVAILABLE', `Payout is not currently available for ${country}`);
    }
    const provider = resolveConfiguredProvider(capability.providerPriority);
    if (!provider) {
      throw new AppError('SERVICE_UNAVAILABLE', 'Payout service is currently unavailable for this country (no provider configured)');
    }
    const result = await provider.getBankFieldSchema(country, currency);
    if (!result.configured) {
      throw new AppError('SERVICE_UNAVAILABLE', result.reason);
    }
    res.status(200).json({ fields: result.fields });
  } catch (error) {
    next(error);
  }
});

payoutMethodsRouter.post('/creator/payout-method', requireAuth, addLimiter, validate({ body: addPayoutMethodSchema }), async (req, res, next) => {
  try {
    const { country, currency, accountHolderName, bankDetails } = req.body as { country: string; currency: string; accountHolderName: string; bankDetails: Record<string, string> };

    const capability = await getCapabilityForCountry(country);
    if (!capability || capability.currency !== currency) {
      throw new AppError('SERVICE_UNAVAILABLE', `Payout is not currently available for ${country}`);
    }
    const provider = resolveConfiguredProvider(capability.providerPriority);
    if (!provider) {
      throw new AppError('SERVICE_UNAVAILABLE', 'Payout service is currently unavailable for this country (no provider configured)');
    }

    const result = await provider.createBeneficiary({ country, currency, accountHolderName, bankDetails });
    if (!result.configured) {
      throw new AppError('SERVICE_UNAVAILABLE', result.reason);
    }

    // In tests the mock always answers, regardless of which real provider
    // was "selected" — store the country's actual first-priority provider
    // so `Withdrawal.provider`/`CreatorPayoutMethod.provider` still reflect
    // a real, meaningful choice rather than a fake "MOCK" enum value.
    const providerType = (isTest ? (capability.providerPriority[0] ?? 'AIRWALLEX') : provider.name) as PayoutProviderType;

    const { outcome } = result;
    const status = outcome.status === 'PENDING' ? 'PENDING_VERIFICATION' : outcome.status;
    const method = await prisma.creatorPayoutMethod.upsert({
      where: { creatorId: req.user!.id },
      create: {
        creatorId: req.user!.id,
        country,
        currency,
        provider: providerType,
        providerBeneficiaryId: outcome.beneficiaryId,
        bankDetailsMasked: maskBankDetails(accountHolderName, bankDetails),
        status,
        rejectionReason: outcome.rejectionReason,
        verifiedAt: outcome.status === 'VERIFIED' ? new Date() : null,
      },
      update: {
        country,
        currency,
        provider: providerType,
        providerBeneficiaryId: outcome.beneficiaryId,
        bankDetailsMasked: maskBankDetails(accountHolderName, bankDetails),
        status,
        rejectionReason: outcome.rejectionReason,
        verifiedAt: outcome.status === 'VERIFIED' ? new Date() : null,
      },
    });

    res.status(200).json({ id: method.id, status: method.status, rejectionReason: method.rejectionReason });
  } catch (error) {
    next(error);
  }
});
