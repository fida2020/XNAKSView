import type { ModerationCategory, ModerationSeverity, SafetyReport, SafetyReportReasonCategory, SafetyReportTargetType } from '@prisma/client';

import { applyEnforcement } from '@/lib/moderation/enforcementService';
import type { ModerationContentTypeName, ModerationDecisionName } from '@/lib/moderation/moderationPipeline';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

/**
 * Normalized reporting across every reportable target (brief §8) — the
 * single new report-creation path going forward, replacing the fragmented
 * per-content-type Report tables for NEW reports (see the schema.prisma
 * doc comment on `SafetyReport`). Admin triage is exception-handling, not
 * routine approval (brief §13): most content gets actioned automatically
 * by `moderationPipeline.ts` well before a human ever opens a report queue;
 * this service exists for the reports that DO need a human decision.
 */

export interface CreateSafetyReportParams {
  reporterId: string;
  targetType: SafetyReportTargetType;
  targetId: string;
  targetUserId?: string;
  reasonCategory: SafetyReportReasonCategory;
  details?: string;
}

export async function createSafetyReport(params: CreateSafetyReportParams): Promise<SafetyReport> {
  return prisma.safetyReport.create({
    data: {
      reporterId: params.reporterId,
      targetType: params.targetType,
      targetId: params.targetId,
      targetUserId: params.targetUserId,
      reasonCategory: params.reasonCategory,
      details: params.details,
    },
  });
}

export interface ActionSafetyReportParams {
  reportId: string;
  reviewedById: string;
  userId: string; // the account the enforcement applies to
  decision: ModerationDecisionName;
  category?: ModerationCategory;
  severity?: ModerationSeverity;
  contentType?: ModerationContentTypeName;
  contentId?: string;
  reason: string;
}

/** A report an admin decided warrants enforcement — creates a real `EnforcementAction` sourced from this report, never a bare status flip. */
export async function actionSafetyReport(params: ActionSafetyReportParams) {
  const report = await prisma.safetyReport.findUnique({ where: { id: params.reportId } });
  if (!report) throw new AppError('NOT_FOUND', 'Report not found');
  if (report.status === 'ACTIONED' || report.status === 'DISMISSED') {
    throw new AppError('CONFLICT', 'This report has already been resolved');
  }

  const action = await applyEnforcement({
    userId: params.userId,
    decision: params.decision,
    category: params.category,
    severity: params.severity,
    sourceType: 'SAFETY_REPORT',
    safetyReportId: report.id,
    contentType: params.contentType,
    contentId: params.contentId,
    reason: params.reason,
    actorId: params.reviewedById,
  });

  await prisma.safetyReport.update({ where: { id: report.id }, data: { status: 'ACTIONED', reviewedById: params.reviewedById, reviewedAt: new Date() } });
  return action;
}

export async function dismissSafetyReport(reportId: string, reviewedById: string): Promise<SafetyReport> {
  const report = await prisma.safetyReport.findUnique({ where: { id: reportId } });
  if (!report) throw new AppError('NOT_FOUND', 'Report not found');
  if (report.status === 'ACTIONED' || report.status === 'DISMISSED') {
    throw new AppError('CONFLICT', 'This report has already been resolved');
  }
  return prisma.safetyReport.update({ where: { id: reportId }, data: { status: 'DISMISSED', reviewedById, reviewedAt: new Date() } });
}
