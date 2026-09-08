import { z } from 'zod';

export const listLedgerQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Step 9: the withdrawal-request schema (amount/currency/idempotencyKey
// only — no provider/destinationReference, both resolved automatically
// from the creator's verified payout method) now lives in
// schemas/payoutMethod.schema.ts alongside the rest of the automated
// payout schemas.

export const exchangeToCoinsSchema = z.object({
  amountMinorUnits: z.coerce.number().int().positive(),
  currency: z.string().trim().length(3).toUpperCase(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const exchangePreviewQuerySchema = z.object({
  amountMinorUnits: z.coerce.number().int().positive().optional(),
});
