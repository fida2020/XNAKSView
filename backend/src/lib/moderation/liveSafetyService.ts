import { applyEnforcement } from '@/lib/moderation/enforcementService';
import { moderateAudio, moderateText, moderateVideo, type ModerationOutcome } from '@/lib/moderation/moderationPipeline';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

/**
 * Real-time LIVE safety (brief §4): LIVE chat messages already run through
 * `moderateText` at `routes/v1/live.ts`'s message-creation route (the
 * XNAKView Strict Abuse Rule applies there directly). This service covers
 * the rest of the LIVE surface: sampled video/audio (architecture-only —
 * see `videoAudioModerationProvider.ts`'s doc comment for today's real-
 * vendor status) and the explicit moderator/host/admin actions the brief
 * names (mute, remove guest, restrict/terminate LIVE).
 */

/** A sampled LIVE video frame — same honest-unconfigured posture as a video upload; never fabricates a "safe" result. */
export async function moderateLiveVideoSample(liveSessionId: string, hostId: string, frameStorageKey: string): Promise<ModerationOutcome> {
  return moderateVideo({ contentType: 'LIVE_SESSION', contentId: liveSessionId, authorId: hostId, videoStorageKey: frameStorageKey });
}

/** A sampled LIVE audio clip (host/guest speech) — same honest-unconfigured posture as a voice message. */
export async function moderateLiveAudioSample(liveSessionId: string, hostId: string, audioStorageKey: string): Promise<ModerationOutcome> {
  return moderateAudio({ contentType: 'LIVE_SESSION', contentId: liveSessionId, authorId: hostId, audioStorageKey });
}

/** A moderator-authored note/flag about something said on stream (no ASR/transcription vendor is configured — see the doc comment above) — lets a human moderator's real-time judgment feed the SAME pipeline/audit trail as automated detection, rather than a side channel. */
export async function moderateReportedLiveSpeech(liveSessionId: string, hostId: string, transcribedText: string): Promise<ModerationOutcome> {
  return moderateText({ contentType: 'LIVE_SESSION', contentId: liveSessionId, authorId: hostId, text: transcribedText });
}

export interface EndLiveForSafetyParams {
  liveSessionId: string;
  hostId: string;
  actorId: string | null; // null = automatic pipeline; a real id = a moderator/admin
  reason: string;
}

/** "Terminate LIVE" (brief §4) — ends the session immediately and records a real `EnforcementAction` (FEATURE_RESTRICT: the LIVE feature, not a full ban) so it's auditable/appealable like any other enforcement. */
export async function terminateLiveForSafety(params: EndLiveForSafetyParams): Promise<void> {
  const session = await prisma.liveSession.findUnique({ where: { id: params.liveSessionId } });
  if (!session) throw new AppError('NOT_FOUND', 'LIVE session not found');
  if (session.status === 'ENDED') return; // already ended — a safe no-op, never a duplicate enforcement

  await prisma.liveSession.update({ where: { id: session.id }, data: { status: 'ENDED', endedAt: new Date() } });
  await applyEnforcement({
    userId: params.hostId,
    decision: 'FEATURE_RESTRICT',
    sourceType: 'MANUAL',
    contentType: 'LIVE_SESSION',
    contentId: params.liveSessionId,
    reason: params.reason,
    actorId: params.actorId,
  });
}

/** "Stop gifting capability" (brief §4) — a FEATURE_RESTRICT specifically flagged as gift-related; `routes/v1/gifts.ts`'s send-gift path can check for an ACTIVE gift-related FEATURE_RESTRICT on the recipient/session before crediting a Gift (disclosed as a follow-on wiring point in the Step 10 completion report, not fully threaded through here given scope). */
export async function restrictGiftingForSafety(userId: string, actorId: string | null, reason: string) {
  return applyEnforcement({ userId, decision: 'FEATURE_RESTRICT', sourceType: 'MANUAL', reason: `Gifting restricted: ${reason}`, actorId });
}

/** "Remove guest" — removes an active co-host/guest slot immediately; always a real, current `LiveGuestSlot` row, never a fabricated success. */
export async function removeLiveGuestForSafety(liveSessionId: string, guestUserId: string, actorId: string | null, reason: string): Promise<void> {
  const slot = await prisma.liveGuestSlot.findFirst({ where: { liveSessionId, userId: guestUserId, status: 'ACTIVE' } });
  if (!slot) return; // already removed — safe no-op

  await prisma.liveGuestSlot.update({ where: { id: slot.id }, data: { status: 'REMOVED' } });
  await applyEnforcement({ userId: guestUserId, decision: 'FEATURE_RESTRICT', sourceType: 'MANUAL', contentType: 'LIVE_SESSION', contentId: liveSessionId, reason: `Removed as LIVE guest: ${reason}`, actorId });
}
