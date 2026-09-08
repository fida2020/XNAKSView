import { z } from 'zod';

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// -----------------------------------------------------------------------
// Fan Club
// -----------------------------------------------------------------------

export const fanClubParamsSchema = z.object({ creatorId: z.string().uuid() });

// -----------------------------------------------------------------------
// Leaderboards
// -----------------------------------------------------------------------

export const leaderboardQuerySchema = z.object({
  type: z.enum(['CREATOR_DIAMONDS', 'LIVE_HOURS', 'GIFT_SENDERS', 'FAN_CLUB_XP', 'TEAM_PERFORMANCE']),
  period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'ALL_TIME']).default('WEEKLY'),
  scopeId: z.string().uuid().optional(),
});

export const teamLeaderboardQuerySchema = z.object({
  period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'ALL_TIME']).default('WEEKLY'),
});

// -----------------------------------------------------------------------
// Teams
// -----------------------------------------------------------------------

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).optional(),
  avatarKey: z.string().trim().max(300).optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(500).optional(),
  avatarKey: z.string().trim().max(300).optional(),
});

export const inviteTeamMemberSchema = z.object({
  userId: z.string().uuid(),
});

export const respondToTeamInviteSchema = z.object({
  accept: z.boolean(),
});

export const changeTeamMemberRoleSchema = z.object({
  role: z.enum(['MANAGER', 'MEMBER']),
});

export const transferTeamOwnershipSchema = z.object({
  newOwnerId: z.string().uuid(),
});

export const createTeamTargetSchema = z
  .object({
    metric: z.enum(['LIVE_HOURS', 'LIVE_SESSIONS', 'GIFTS_RECEIVED_COINS', 'TEAM_ENGAGEMENT_POINTS']),
    targetValue: z.coerce.number().int().positive(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
  })
  .refine((data) => data.periodEnd > data.periodStart, { message: 'periodEnd must be after periodStart' });

// -----------------------------------------------------------------------
// Admin — badges / achievements catalog
// -----------------------------------------------------------------------

export const createBadgeSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and hyphens only'),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  iconKey: z.string().trim().max(300).optional(),
  category: z.enum(['MILESTONE', 'LIVE', 'TEAM', 'CONSISTENCY', 'CREATOR', 'FAN']),
  criteriaKey: z.string().trim().min(1).max(80),
  criteriaParams: z.record(z.unknown()).optional(),
  sortOrder: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});

export const updateBadgeSchema = createBadgeSchema.partial().omit({ slug: true });

export const createAchievementSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and hyphens only'),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  category: z.enum(['CONTENT', 'SOCIAL', 'LIVE', 'GIFTING', 'TEAM']),
  criteriaKey: z.string().trim().min(1).max(80),
  criteriaParams: z.record(z.unknown()).optional(),
  xpReward: z.coerce.number().int().min(0).default(0),
  sortOrder: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});

export const updateAchievementSchema = createAchievementSchema.partial().omit({ slug: true });

// -----------------------------------------------------------------------
// Admin — configuration
// -----------------------------------------------------------------------

export const gamificationConfigKeySchema = z.enum([
  'USER_LEVEL_THRESHOLDS',
  'CREATOR_LEVEL_THRESHOLDS',
  'FAN_LEVEL_THRESHOLDS',
  'XP_AWARD_RULES',
  'STREAK_RULES',
  'LEADERBOARD_SETTINGS',
  'ANTI_ABUSE_SETTINGS',
]);

export const setGamificationConfigParamsSchema = z.object({ key: gamificationConfigKeySchema });
export const setGamificationConfigBodySchema = z.object({ value: z.record(z.unknown()) });

export const recomputeLeaderboardSchema = z.object({
  type: z.enum(['CREATOR_DIAMONDS', 'LIVE_HOURS', 'GIFT_SENDERS', 'FAN_CLUB_XP', 'TEAM_PERFORMANCE']),
  period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'ALL_TIME']),
  scopeId: z.string().uuid().optional(),
});

// Positive-only — a documented, disclosed admin bonus grant (e.g. a
// promotional or compensation award), never a retroactive deduction. See
// GamificationConfig's own doc comment: historical XP is never rewritten.
export const adminXpAdjustmentSchema = z.object({
  userId: z.string().uuid(),
  ledger: z.enum(['USER', 'CREATOR']),
  amount: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1).max(300),
});
