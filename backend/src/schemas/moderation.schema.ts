import { z } from 'zod';

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const safetyReportTargetTypeEnum = z.enum([
  'USER_ACCOUNT',
  'VIDEO',
  'VIDEO_COMMENT',
  'PHOTO_POST',
  'PHOTO_POST_COMMENT',
  'TEXT_POST',
  'TEXT_POST_COMMENT',
  'STORY',
  'MESSAGE',
  'CONVERSATION',
  'LIVE_SESSION',
  'LIVE_CHAT_MESSAGE',
  'CREATOR_PAYMENT',
]);

const safetyReportReasonEnum = z.enum([
  'SEXUAL_NUDITY',
  'EXPLOITATION',
  'VIOLENCE',
  'GRAPHIC_CONTENT',
  'THREATS',
  'HATE_HARASSMENT',
  'BULLYING',
  'ABUSIVE_PROFANE_LANGUAGE',
  'DANGEROUS_BEHAVIOR',
  'SCAM_FRAUD',
  'SPAM',
  'IMPERSONATION',
  'ILLEGAL_REGULATED',
  'HARMFUL_CONTENT',
  'COPYRIGHT',
  'UNDERAGE_USER',
  'OTHER',
]);

export const createSafetyReportSchema = z.object({
  targetType: safetyReportTargetTypeEnum,
  targetId: z.string().min(1),
  targetUserId: z.string().uuid().optional(),
  reasonCategory: safetyReportReasonEnum,
  details: z.string().trim().max(1000).optional(),
});

const moderationCategoryEnum = z.enum([
  'SEXUAL_NUDITY',
  'EXPLOITATION',
  'VIOLENCE',
  'GRAPHIC_CONTENT',
  'THREATS',
  'HATE_HARASSMENT',
  'BULLYING',
  'ABUSIVE_PROFANE_LANGUAGE',
  'DANGEROUS_BEHAVIOR',
  'SCAM_FRAUD',
  'SPAM',
  'IMPERSONATION',
  'ILLEGAL_REGULATED',
  'HARMFUL_CONTENT',
  'COPYRIGHT',
  'OTHER_POLICY_VIOLATION',
]);

const moderationSeverityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'SEVERE']);

const moderationDecisionEnum = z.enum([
  'LIMIT',
  'NOT_RECOMMENDED',
  'AGE_RESTRICT',
  'REMOVE',
  'FEATURE_RESTRICT',
  'TEMPORARY_ACCOUNT_RESTRICT',
  'PERMANENT_BAN',
]);

export const adminActionSafetyReportSchema = z.object({
  userId: z.string().uuid(),
  decision: moderationDecisionEnum,
  category: moderationCategoryEnum.optional(),
  severity: moderationSeverityEnum.optional(),
  reason: z.string().trim().min(1).max(1000),
});

export const adminDismissSafetyReportSchema = z.object({});

export const submitAppealSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export const decideAppealSchema = z.object({
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  notes: z.string().trim().max(1000).optional(),
});

export const adminManualEnforcementSchema = z.object({
  userId: z.string().uuid(),
  decision: moderationDecisionEnum,
  category: moderationCategoryEnum.optional(),
  severity: moderationSeverityEnum.optional(),
  reason: z.string().trim().min(1).max(1000),
});

export const adminReverseEnforcementSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
