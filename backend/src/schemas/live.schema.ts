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

// multipart/form-data always arrives as strings — z.coerce.boolean() is a
// trap here (`Boolean('false') === true`), so booleans from a form field
// are parsed explicitly instead.
const formBoolean = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')
  .default(false);

export const startLiveSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(100, 'Title must be at most 100 characters'),
  category: z.string().trim().max(50).optional(),
  // Co-host/multi-guest foundation — how many non-host participants may be
  // ACTIVE at once. Defaults to the classic single co-host.
  maxGuestSlots: z.coerce.number().int().min(0).max(12).default(1),
  // Subscriber-only chat and replay are opt-in per session.
  subscriberOnlyChat: formBoolean,
  replayEnabled: formBoolean,
  // LIVE Goal — real, optional Coin-spend target. Enabled only when the
  // host actually sets a positive target; goalTitle alone with no target
  // never turns the goal "on" (there would be nothing real to track).
  goalTitle: z.string().trim().max(80).optional(),
  goalTargetCoins: z.coerce.number().int().min(1).max(10_000_000).optional(),
  // Voice Chat LIVE mode — a real, persisted session-type flag; the host's
  // client never publishes a camera track when this is true (LiveKit
  // natively supports an audio-only participant, no custom pipeline needed).
  isVoiceOnly: formBoolean,
});

export const listLiveQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const liveChatMessageSchema = z.object({
  text: z.string().trim().min(1, 'Message cannot be empty').max(300, 'Message must be at most 300 characters'),
});

// Real LIVE reactions — a fixed, honest set (no arbitrary emoji injection
// into the realtime room), broadcast ephemerally (see routes/v1/live.ts) —
// never persisted, matching how a transient reaction burst actually works.
export const liveReactionSchema = z.object({
  emoji: z.enum(['❤️', '👍', '😂', '🔥', '👏']),
});

export const listLiveChatQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const reportLiveSchema = z.object({
  reason: reportReasonEnum,
  description: z.string().trim().max(500).optional(),
});

export const reportLiveViewerSchema = z.object({
  reportedUserId: z.string().uuid(),
  reason: reportReasonEnum,
  description: z.string().trim().max(500).optional(),
});

export const reportLiveChatMessageSchema = z.object({
  reason: reportReasonEnum,
  description: z.string().trim().max(500).optional(),
});

// -----------------------------------------------------------------------
// LIVE events (scheduling)
// -----------------------------------------------------------------------

export const createLiveEventSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(100),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(50).optional(),
  scheduledAt: z.coerce.date().refine((date) => date.getTime() > Date.now(), {
    message: 'scheduledAt must be in the future',
  }),
});

export const rescheduleLiveEventSchema = z.object({
  scheduledAt: z.coerce.date().refine((date) => date.getTime() > Date.now(), {
    message: 'scheduledAt must be in the future',
  }),
});

export const listLiveEventsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['SCHEDULED', 'STARTED', 'CANCELLED']).optional(),
});

// -----------------------------------------------------------------------
// LIVE moderation (moderators, mute/block)
// -----------------------------------------------------------------------

export const assignModeratorSchema = z.object({
  userId: z.string().uuid(),
});

export const restrictViewerSchema = z.object({
  userId: z.string().uuid(),
});

// -----------------------------------------------------------------------
// Co-host / multi-guest
// -----------------------------------------------------------------------

export const inviteGuestSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['CO_HOST', 'GUEST']).default('GUEST'),
});

// -----------------------------------------------------------------------
// LIVE Match / Battle
// -----------------------------------------------------------------------

export const createLiveMatchSchema = z.object({
  opponentSessionId: z.string().uuid(),
  durationSeconds: z.coerce.number().int().min(30).max(3600).default(180),
  // SOLO (default) is the original 1v1 shape — sessionA/sessionB are the
  // only two participants. TEAM allows additional LiveMatchTeamMember
  // sessions to join either side after creation via the team/invite route.
  matchType: z.enum(['SOLO', 'TEAM']).default('SOLO'),
});

export const matchScoreSchema = z.object({
  side: z.enum(['A', 'B']),
  increment: z.coerce.number().int().min(1).max(100).default(1),
});

export const inviteTeamMemberSchema = z.object({
  liveSessionId: z.string().uuid(),
  side: z.enum(['A', 'B']),
});
