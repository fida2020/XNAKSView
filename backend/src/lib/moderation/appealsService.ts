import type { Appeal } from '@prisma/client';

import { reverseEnforcement } from '@/lib/moderation/enforcementService';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

/**
 * Real appeal lifecycle (brief §10): enforcement -> user notification (the
 * `EnforcementAction` row itself, surfaced via `routes/v1/accountStatus.ts`)
 * -> appeal submitted -> automated re-evaluation where appropriate ->
 * accepted/rejected -> the original enforcement is restored/reversed on
 * ACCEPTED. Never deletes the original enforcement/audit history — an
 * ACCEPTED appeal calls `reverseEnforcement`, which sets fields on the
 * existing row rather than removing it.
 */

export async function submitAppeal(enforcementActionId: string, submittedById: string, reason: string): Promise<Appeal> {
  const action = await prisma.enforcementAction.findUnique({ where: { id: enforcementActionId } });
  if (!action) throw new AppError('NOT_FOUND', 'Enforcement action not found');
  if (action.userId !== submittedById) throw new AppError('FORBIDDEN', 'You can only appeal an enforcement action taken against your own account');
  if (action.status !== 'ACTIVE') throw new AppError('CONFLICT', 'This enforcement action is not currently active and cannot be appealed');

  const existing = await prisma.appeal.findFirst({ where: { enforcementActionId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } });
  if (existing) return existing;

  const appeal = await prisma.appeal.create({ data: { enforcementActionId, submittedById, reason } });
  return attemptAutomatedReevaluation(appeal);
}

/**
 * Uncertain/high-risk cases are escalated to a human rather than
 * pretending AI certainty (brief §11): only a LOW/MEDIUM-severity,
 * sub-threshold-confidence original decision is ever auto-accepted here —
 * a SEVERE or high-confidence enforcement (including every strict-abuse-
 * rule PERMANENT_BAN) always moves to UNDER_REVIEW for a human admin.
 */
async function attemptAutomatedReevaluation(appeal: Appeal): Promise<Appeal> {
  const action = await prisma.enforcementAction.findUniqueOrThrow({ where: { id: appeal.enforcementActionId } });
  if (action.sourceType !== 'MODERATION_EVENT' || !action.moderationEventId) {
    return prisma.appeal.update({ where: { id: appeal.id }, data: { status: 'UNDER_REVIEW' } });
  }

  const event = await prisma.moderationEvent.findUnique({ where: { id: action.moderationEventId } });
  const likelyFalsePositive = Boolean(event) && event!.severity !== 'SEVERE' && event!.confidence < 0.6;

  if (likelyFalsePositive) {
    await reverseEnforcement(action.id, null, 'Automated re-evaluation: original confidence was below the threshold expected for this severity');
    return prisma.appeal.update({
      where: { id: appeal.id },
      data: { status: 'ACCEPTED', decidedAt: new Date(), decidedById: null, decisionNotes: 'Automated re-evaluation accepted this appeal.' },
    });
  }

  return prisma.appeal.update({ where: { id: appeal.id }, data: { status: 'UNDER_REVIEW' } });
}

/** Admin exception-path decision — the normal path for a LOW/MEDIUM case is the automated re-evaluation above; this is for cases that needed a human. */
export async function decideAppeal(appealId: string, decision: 'ACCEPTED' | 'REJECTED', decidedById: string, notes?: string): Promise<Appeal> {
  const appeal = await prisma.appeal.findUnique({ where: { id: appealId } });
  if (!appeal) throw new AppError('NOT_FOUND', 'Appeal not found');
  if (appeal.status !== 'SUBMITTED' && appeal.status !== 'UNDER_REVIEW') {
    throw new AppError('CONFLICT', 'This appeal has already been decided');
  }

  if (decision === 'ACCEPTED') {
    await reverseEnforcement(appeal.enforcementActionId, decidedById, notes ?? 'Appeal accepted on review');
  }

  return prisma.appeal.update({ where: { id: appealId }, data: { status: decision, decidedAt: new Date(), decidedById, decisionNotes: notes } });
}
