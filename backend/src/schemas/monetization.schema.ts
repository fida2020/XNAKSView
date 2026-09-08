import { z } from 'zod';

export const createEligibilityRuleSchema = z.object({
  minFollowers: z.coerce.number().int().min(0).default(0),
  minLifetimeVideoViews: z.coerce.number().int().min(0).default(0),
  minAccountAgeDays: z.coerce.number().int().min(0).default(0),
  requireGoodStanding: z.coerce.boolean().default(true),
  allowedRegions: z.array(z.string().trim().toUpperCase().length(2)).default([]),
  effectiveFrom: z.coerce.date().optional(),
  effectiveUntil: z.coerce.date().optional(),
});

export const createAdRevenueShareRuleSchema = z
  .object({
    creatorSharePercent: z.coerce.number().min(0).max(100),
    platformSharePercent: z.coerce.number().min(0).max(100),
    effectiveFrom: z.coerce.date().optional(),
    effectiveUntil: z.coerce.date().optional(),
  })
  .refine((data) => Math.abs(data.creatorSharePercent + data.platformSharePercent - 100) < 0.001, {
    message: 'creatorSharePercent and platformSharePercent must sum to exactly 100',
    path: ['platformSharePercent'],
  });

export const updateCreatorMonetizationStatusSchema = z.object({
  status: z.enum(['NOT_ELIGIBLE', 'ELIGIBLE', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'DISABLED']),
  reason: z.string().trim().max(500).optional(),
});

export const recordAdRevenueEventSchema = z.object({
  provider: z.string().trim().min(1).max(50),
  providerEventId: z.string().trim().min(1).max(200),
  videoId: z.string().trim().min(1),
  impressions: z.coerce.number().int().min(0).optional(),
  validImpressions: z.coerce.number().int().min(0).optional(),
  clicks: z.coerce.number().int().min(0).optional(),
  grossRevenueMinorUnits: z.coerce.number().int().min(0),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const reverseAdRevenueEventSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const adminListAdRevenueQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  creatorId: z.string().trim().optional(),
  videoId: z.string().trim().optional(),
  status: z.enum(['CONFIRMED', 'INVALID']).optional(),
});

export const adminListCreatorMonetizationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['NOT_ELIGIBLE', 'ELIGIBLE', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'DISABLED']).optional(),
});

export const listCreatorRevenueQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
