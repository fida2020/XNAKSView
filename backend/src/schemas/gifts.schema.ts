import { z } from 'zod';

export const listGiftsQuerySchema = z.object({
  category: z.enum(['APPRECIATION', 'PREMIUM', 'CELEBRATION', 'LIVE', 'SPECIAL']).optional(),
});

export const sendGiftSchema = z
  .object({
    giftSlug: z.string().trim().min(1),
    quantity: z.coerce.number().int().min(1).max(999).default(1),
    idempotencyKey: z.string().trim().min(1).max(200),
    // Exactly one target must be provided — enforced by the refine below,
    // never inferred from "whichever field happened to be non-empty."
    liveSessionId: z.string().uuid().optional(),
    // The viewer's intent for a specific LIVE participant — the server
    // independently re-validates this against real session/guest-slot
    // state (see lib/giftService.ts) and never trusts it directly.
    targetParticipantId: z.string().uuid().optional(),
    videoId: z.string().uuid().optional(),
    photoPostId: z.string().uuid().optional(),
    textPostId: z.string().uuid().optional(),
  })
  .refine((data) => [data.liveSessionId, data.videoId, data.photoPostId, data.textPostId].filter(Boolean).length === 1, {
    message: 'Exactly one of liveSessionId, videoId, photoPostId, or textPostId is required',
  });

export const listGiftTransactionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// -----------------------------------------------------------------------
// Admin — Gift catalog
// -----------------------------------------------------------------------

export const createGiftSchema = z.object({
  name: z.string().trim().min(1).max(50),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and hyphens only'),
  coinCost: z.coerce.number().int().min(1),
  category: z.enum(['APPRECIATION', 'PREMIUM', 'CELEBRATION', 'LIVE', 'SPECIAL']),
  sortOrder: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
  maxQuantityPerSend: z.coerce.number().int().min(1).max(999).default(99),
});

export const updateGiftSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  coinCost: z.coerce.number().int().min(1).optional(),
  category: z.enum(['APPRECIATION', 'PREMIUM', 'CELEBRATION', 'LIVE', 'SPECIAL']).optional(),
  sortOrder: z.coerce.number().int().optional(),
  active: z.boolean().optional(),
  maxQuantityPerSend: z.coerce.number().int().min(1).max(999).optional(),
});

// -----------------------------------------------------------------------
// Admin — Diamond / platform-revenue rules
// -----------------------------------------------------------------------

export const createDiamondEarnRateSchema = z.object({
  coinsPerDiamond: z.coerce.number().positive(),
});

export const createDiamondRewardRateSchema = z.object({
  diamondsRequired: z.coerce.number().int().positive(),
  rewardCurrency: z.string().trim().length(3).toUpperCase(),
  rewardAmount: z.coerce.number().positive(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveUntil: z.coerce.date().optional(),
});

export const createPlatformRevenueRuleSchema = z.object({
  platformSharePercent: z.coerce.number().min(0).max(100),
  creatorRewardDescription: z.string().trim().max(500).optional(),
  applicableContext: z.string().trim().max(50).default('GIFT'),
  effectiveFrom: z.coerce.date().optional(),
  effectiveUntil: z.coerce.date().optional(),
});

// -----------------------------------------------------------------------
// Admin — fraud holds, withdrawal review
// -----------------------------------------------------------------------

export const createFraudHoldSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

export const withdrawalReviewActionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const adminListWithdrawalsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['REQUESTED', 'REVIEWING', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED', 'CANCELLED']).optional(),
});

/** Step 9 manual-override only — a real `providerPayoutId` the admin has independently confirmed with the provider, never fabricated. */
export const adminMarkProcessingSchema = z.object({
  providerPayoutId: z.string().trim().min(1).max(200),
  providerStatus: z.string().trim().min(1).max(100).optional(),
});

export const adminListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const convertDiamondsToEarningsSchema = z.object({
  diamonds: z.coerce.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const adminListAuditLogsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  entityType: z.string().trim().max(50).optional(),
  entityId: z.string().trim().max(200).optional(),
});
