import { z } from 'zod';

const reportReasonEnum = z.enum([
  'SPAM',
  'NUDITY_OR_SEXUAL_CONTENT',
  'VIOLENCE',
  'HARASSMENT_OR_BULLYING',
  'HATE_SPEECH',
  'MISINFORMATION',
  'OTHER',
]);

export const createConversationSchema = z.object({
  userId: z.string().uuid(),
});

export const listConversationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['PENDING', 'ACCEPTED']).optional(),
});

export const reportConversationSchema = z.object({
  reason: reportReasonEnum,
  description: z.string().trim().max(500).optional(),
});

export const listMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const sendTextMessageSchema = z.object({
  clientMessageId: z.string().uuid(),
  text: z.string().trim().min(1, 'Message cannot be empty').max(2000, 'Message must be at most 2000 characters'),
});

export const sendVoiceMessageSchema = z.object({
  clientMessageId: z.string().uuid(),
});

export const reportMessageSchema = z.object({
  reason: reportReasonEnum,
  description: z.string().trim().max(500).optional(),
});

export const updateMessagingSettingsSchema = z
  .object({
    whoCanMessage: z.enum(['EVERYONE', 'MUTUAL_FOLLOWERS', 'NO_ONE']).optional(),
    showActivityStatus: z.boolean().optional(),
  })
  .refine((body) => body.whoCanMessage !== undefined || body.showActivityStatus !== undefined, {
    message: 'At least one setting must be provided',
  });

export const createCallSchema = z.object({
  calleeId: z.string().uuid(),
  type: z.enum(['VOICE', 'VIDEO']),
});

export const listCallsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const reportCallSchema = z.object({
  reason: reportReasonEnum,
  description: z.string().trim().max(500).optional(),
});
