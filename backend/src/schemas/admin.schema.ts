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
