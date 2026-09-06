import { z } from 'zod';

export const adminListVideosQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PROCESSING', 'READY', 'FAILED', 'DELETED']).optional(),
});

export const adminListReportsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'REVIEWED', 'DISMISSED', 'ACTIONED']).optional(),
});

export const adminListLiveQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['LIVE', 'ENDED']).optional(),
});

export const adminCreateBlockedWordSchema = z.object({
  word: z.string().trim().min(1).max(100).toLowerCase(),
});

export const adminEnforceAccountStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']),
  reason: z.string().trim().max(500).optional(),
});
