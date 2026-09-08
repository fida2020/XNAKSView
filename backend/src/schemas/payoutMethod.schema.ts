import { z } from 'zod';

/** ISO 3166-1 alpha-2. */
const countryCodeSchema = z.string().trim().length(2).toUpperCase();
/** ISO 4217. */
const currencyCodeSchema = z.string().trim().length(3).toUpperCase();

export const payoutMethodSchemaQuerySchema = z.object({
  country: countryCodeSchema,
  currency: currencyCodeSchema,
});

export const addPayoutMethodSchema = z.object({
  country: countryCodeSchema,
  currency: currencyCodeSchema,
  accountHolderName: z.string().trim().min(1).max(200),
  // Dynamic per-country fields (see `GET /creator/payout-method/schema`) —
  // never a hardcoded IBAN/SWIFT/sort-code shape here.
  bankDetails: z.record(z.string(), z.string().trim().min(1).max(200)),
});

export const startIdentityVerificationSchema = z.object({
  country: countryCodeSchema,
});

export const createWithdrawalSchema = z.object({
  amountMinorUnits: z.coerce.number().int().positive(),
  currency: z.string().trim().length(3).toUpperCase(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const withdrawalPreviewQuerySchema = z.object({
  amountMinorUnits: z.coerce.number().int().positive(),
});

export const createCountryPayoutCapabilitySchema = z.object({
  countryCode: countryCodeSchema,
  currency: currencyCodeSchema,
  enabled: z.boolean().default(false),
  minPayoutMinorUnits: z.coerce.number().int().min(0),
  maxPayoutMinorUnits: z.coerce.number().int().min(0),
  feeFixedMinorUnits: z.coerce.number().int().min(0).default(0),
  feePercentBps: z.coerce.number().int().min(0).max(10_000).default(0),
  estimatedProcessingDays: z.coerce.number().int().min(0).default(3),
  providerPriority: z.array(z.enum(['PAYONEER', 'AIRWALLEX'])).default([]),
  notes: z.string().trim().max(500).optional(),
});

export const updateCountryPayoutCapabilitySchema = createCountryPayoutCapabilitySchema.partial().omit({ countryCode: true });
