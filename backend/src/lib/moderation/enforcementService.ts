import type { EnforcementAction, EnforcementActionType, EnforcementSourceType, ModerationCategory, ModerationSeverity } from '@prisma/client';

import type { ModerationContentTypeName, ModerationDecisionName } from '@/lib/moderation/moderationPipeline';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

/**
 * The one place any user/content enforcement is actually APPLIED (brief
 * §1's "-> action" step) — every moderation/report/fraud path that decides
 * something must happen calls this, never mutates `User.status` or a
 * content row's visibility directly. Mirrors Step 9's
 * `withdrawalService.ts`: `actorId: null` = the automatic pipeline decided
 * this; a real id = an admin used the exception-override path.
 */

function decisionToActionType(decision: ModerationDecisionName): EnforcementActionType {
  switch (decision) {
    case 'LIMIT':
    case 'NOT_RECOMMENDED':
      return 'LIMIT_DISTRIBUTION';
    case 'AGE_RESTRICT':
      return 'AGE_RESTRICT';
    case 'REMOVE':
      return 'CONTENT_REMOVED';
    case 'FEATURE_RESTRICT':
      return 'FEATURE_RESTRICT';
    case 'TEMPORARY_ACCOUNT_RESTRICT':
      return 'TEMPORARY_ACCOUNT_RESTRICT';
    case 'PERMANENT_BAN':
      return 'PERMANENT_BAN';
    case 'ALLOW':
      throw new AppError('BAD_REQUEST', 'ALLOW is not an enforceable decision');
  }
}

// REMOVE/PERMANENT_BAN/TEMPORARY_ACCOUNT_RESTRICT all mean "this specific
// piece of content violates policy enough to come down" — LIMIT/
// NOT_RECOMMENDED/AGE_RESTRICT/FEATURE_RESTRICT are distribution/feature
// decisions that don't remove the flagged content itself (brief §2: "do
// not treat every violation identically"). Feeding LIMIT/NOT_RECOMMENDED
// into an actual ranking/recommendation system is a disclosed limitation —
// no such system exists in this codebase to feed.
const CONTENT_REMOVING_TYPES: EnforcementActionType[] = ['CONTENT_REMOVED', 'PERMANENT_BAN', 'TEMPORARY_ACCOUNT_RESTRICT'];

/** Hard-deletes/tombstones the flagged content, matching each model's OWN existing deletion convention — never a new parallel "hidden" mechanism per content type. A no-op (never an error) if the content is already gone. */
async function removeContentIfApplicable(contentType: ModerationContentTypeName | null | undefined, contentId: string | null | undefined): Promise<void> {
  if (!contentType || !contentId) return;
  switch (contentType) {
    case 'VIDEO':
      await prisma.video.updateMany({ where: { id: contentId }, data: { status: 'DELETED' } });
      return;
    case 'PHOTO_POST':
      await prisma.photoPost.updateMany({ where: { id: contentId }, data: { deletedAt: new Date() } });
      return;
    case 'TEXT_POST':
      await prisma.textPost.updateMany({ where: { id: contentId }, data: { deletedAt: new Date() } });
      return;
    case 'STORY':
      await prisma.story.updateMany({ where: { id: contentId }, data: { deletedAt: new Date() } });
      return;
    case 'MESSAGE':
      await prisma.message.updateMany({ where: { id: contentId }, data: { deletedAt: new Date() } });
      return;
    case 'VIDEO_COMMENT':
      await prisma.videoComment.deleteMany({ where: { id: contentId } });
      return;
    case 'TEXT_POST_COMMENT':
      await prisma.textPostComment.deleteMany({ where: { id: contentId } });
      return;
    case 'PHOTO_POST_COMMENT':
      await prisma.photoPostComment.deleteMany({ where: { id: contentId } });
      return;
    case 'LIVE_CHAT_MESSAGE':
      await prisma.liveChatMessage.deleteMany({ where: { id: contentId } });
      return;
    // LIVE_SESSION/USER_PROFILE/USERNAME/BIO/AVATAR are not "content to
    // delete" here — LIVE-session-level actions live in
    // lib/moderation/liveSafetyService.ts; profile/username/bio/avatar
    // enforcement is a plain account-level restriction, handled by the
    // caller re-prompting the user to change the offending field.
    default:
      return;
  }
}

async function applyUserStatusEffect(userId: string, actionType: EnforcementActionType, expiresAt: Date | null): Promise<void> {
  if (actionType === 'PERMANENT_BAN') {
    await prisma.user.update({ where: { id: userId }, data: { status: 'BANNED', statusReason: 'Trust & Safety enforcement — permanent ban', statusUpdatedAt: new Date() } });
    await revokeIdentityTrustForBannedUser(userId);
    return;
  }
  if (actionType === 'TEMPORARY_ACCOUNT_RESTRICT') {
    await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED', statusReason: 'Trust & Safety enforcement — temporary restriction', statusUpdatedAt: new Date() } });
    void expiresAt; // recorded on the EnforcementAction row itself; see tryAutoLiftExpiredRestriction
  }
}

/** Marks the banned user's identity fingerprint (if any) as no longer reusable — blocks that same real-world identity from verifying a NEW account (brief §6: "if identity is associated with a permanently banned account -> block creation/verification of another account"). */
async function revokeIdentityTrustForBannedUser(userId: string): Promise<void> {
  await prisma.identityTrustSignal.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'REVOKED_BANNED', revokedAt: new Date() } });
}

export interface ApplyEnforcementParams {
  userId: string;
  decision: ModerationDecisionName;
  category?: ModerationCategory;
  severity?: ModerationSeverity;
  sourceType: EnforcementSourceType;
  moderationEventId?: string;
  safetyReportId?: string;
  riskAssessmentId?: string;
  contentType?: ModerationContentTypeName;
  contentId?: string;
  reason: string;
  /** null/omitted = the automatic pipeline decided this. A real id = an admin used the exception-override path. */
  actorId?: string | null;
  /** TEMPORARY_ACCOUNT_RESTRICT only. */
  temporaryDurationMs?: number;
}

export async function applyEnforcement(params: ApplyEnforcementParams): Promise<EnforcementAction> {
  const actionType = decisionToActionType(params.decision);
  const expiresAt = actionType === 'TEMPORARY_ACCOUNT_RESTRICT' ? new Date(Date.now() + (params.temporaryDurationMs ?? 7 * 24 * 60 * 60 * 1000)) : null;

  const action = await prisma.enforcementAction.create({
    data: {
      userId: params.userId,
      actionType,
      category: params.category,
      severity: params.severity,
      sourceType: params.sourceType,
      moderationEventId: params.moderationEventId,
      safetyReportId: params.safetyReportId,
      riskAssessmentId: params.riskAssessmentId,
      contentType: params.contentType,
      contentId: params.contentId,
      reason: params.reason,
      actorId: params.actorId ?? null,
      expiresAt,
    },
  });

  if (CONTENT_REMOVING_TYPES.includes(actionType)) {
    await removeContentIfApplicable(params.contentType, params.contentId);
  }
  await applyUserStatusEffect(params.userId, actionType, expiresAt);

  return action;
}

/**
 * Reverses a still-ACTIVE enforcement — used by an accepted appeal
 * (`appealsService.ts`) or a disclosed admin exception-override correction.
 * Never deletes the original row: sets `status`/`reversedAt`/`reversedById`/
 * `reversalReason` on it (brief §14/§10: "never delete the original
 * enforcement/audit history").
 */
export async function reverseEnforcement(enforcementActionId: string, reversedById: string | null, reversalReason: string): Promise<EnforcementAction> {
  const action = await prisma.enforcementAction.findUnique({ where: { id: enforcementActionId } });
  if (!action) throw new AppError('NOT_FOUND', 'Enforcement action not found');
  if (action.status !== 'ACTIVE') throw new AppError('CONFLICT', 'Only an ACTIVE enforcement action can be reversed');

  const reversed = await prisma.enforcementAction.update({
    where: { id: enforcementActionId },
    data: { status: 'REVERSED', reversedAt: new Date(), reversedById, reversalReason },
  });

  if (action.actionType === 'PERMANENT_BAN' || action.actionType === 'TEMPORARY_ACCOUNT_RESTRICT') {
    // Only restore ACTIVE if no OTHER active account-level restriction still applies to this user.
    const stillRestricted = await prisma.enforcementAction.findFirst({
      where: { userId: action.userId, status: 'ACTIVE', actionType: { in: ['PERMANENT_BAN', 'TEMPORARY_ACCOUNT_RESTRICT'] }, id: { not: enforcementActionId } },
    });
    if (!stillRestricted) {
      await prisma.user.update({ where: { id: action.userId }, data: { status: 'ACTIVE', statusReason: 'Enforcement reversed', statusUpdatedAt: new Date() } });
    }
  }

  return reversed;
}

/**
 * Lazily lifts an expired TEMPORARY_ACCOUNT_RESTRICT — called from
 * `middleware/auth.ts` only on the (rare) SUSPENDED path, never on every
 * request, so a temporary restriction's own `expiresAt` is honored without
 * needing a cron job. Returns true if the user was just restored to ACTIVE.
 */
export async function tryAutoLiftExpiredRestriction(userId: string): Promise<boolean> {
  const active = await prisma.enforcementAction.findFirst({
    where: { userId, status: 'ACTIVE', actionType: 'TEMPORARY_ACCOUNT_RESTRICT', expiresAt: { lte: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!active) return false;

  await prisma.enforcementAction.update({ where: { id: active.id }, data: { status: 'EXPIRED' } });
  const stillRestricted = await prisma.enforcementAction.findFirst({
    where: { userId, status: 'ACTIVE', actionType: { in: ['PERMANENT_BAN', 'TEMPORARY_ACCOUNT_RESTRICT'] } },
  });
  if (!stillRestricted) {
    await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE', statusReason: 'Temporary restriction expired', statusUpdatedAt: new Date() } });
    return true;
  }
  return false;
}
