import { z } from 'zod';

export const listCoinHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const listCoinPurchasesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createCoinPurchaseSchema = z.object({
  packageId: z.string().uuid(),
  provider: z.enum(['APP_STORE', 'GOOGLE_PLAY', 'WEB']),
  idempotencyKey: z.string().trim().min(1).max(200),
});

/** Submits the provider receipt for a previously-created purchase so it can be verified and, if valid, credited — never a bare client-reported "it succeeded" flag. */
export const verifyCoinPurchaseSchema = z.object({
  receipt: z.string().trim().min(1),
});

export const setDailyGiftLimitSchema = z.object({
  dailyGiftLimitCoins: z.coerce.number().int().min(0).nullable(),
});

// -----------------------------------------------------------------------
// Admin
// -----------------------------------------------------------------------

export const createExchangeRateSchema = z.object({
  pkrPerUsd: z.coerce.number().positive(),
});

export const createCoinPackageSchema = z.object({
  baseUsdPrice: z.coerce.number().positive(),
  taxUsd: z.coerce.number().min(0).default(0),
  feeUsd: z.coerce.number().min(0).default(0),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

export const updateCoinPackageSchema = z.object({
  baseUsdPrice: z.coerce.number().positive().optional(),
  taxUsd: z.coerce.number().min(0).optional(),
  feeUsd: z.coerce.number().min(0).optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});
