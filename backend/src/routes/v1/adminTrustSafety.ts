import { Router } from 'express';

import { decideAppeal } from '@/lib/moderation/appealsService';
import { applyEnforcement, reverseEnforcement } from '@/lib/moderation/enforcementService';
import { isOpenAiModerationConfigured } from '@/lib/moderation/openAiModerationClient';
import { actionSafetyReport, dismissSafetyReport } from '@/lib/moderation/safetyReportService';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { requireAdmin } from '@/middleware/requireAdmin';
import { validate } from '@/middleware/validate';
import {
  adminActionSafetyReportSchema,
  adminManualEnforcementSchema,
  adminReverseEnforcementSchema,
  decideAppealSchema,
  listQuerySchema,
} from '@/schemas/moderation.schema';
import { AppError } from '@/utils/AppError';

/**
 * Admin Trust & Safety surface (brief §13) — monitoring/exception-handling
 * ONLY. Routine moderation is automated end-to-end by
 * `moderationPipeline.ts`/`enforcementService.ts` well before an admin
 * would ever see it; nothing here requires an admin to approve a normal
 * enforcement. This exists for: reports automation didn't resolve,
 * appeals that need a human, and visibility into fraud/identity/provider
 * health an admin would otherwise have no way to see.
 */
export const adminTrustSafetyRouter = Router();
adminTrustSafetyRouter.use(requireAuth, requireAdmin);

function paginate<T extends { id: string; createdAt: Date }>(items: T[], limit: number) {
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { page, nextCursor };
}

function cursorWhere(cursor: string | undefined) {
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');
  return decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {};
}

// ---------------------------------------------------------------------------
// Reports queue
// ---------------------------------------------------------------------------

adminTrustSafetyRouter.get('/admin/safety/reports', validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const reports = await prisma.safetyReport.findMany({
      where: { status: { in: ['OPEN', 'UNDER_REVIEW'] }, ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(reports, limit);
    res.status(200).json({ reports: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

adminTrustSafetyRouter.post('/admin/safety/reports/:id/action', validate({ body: adminActionSafetyReportSchema }), async (req, res, next) => {
  try {
    const action = await actionSafetyReport({
      reportId: req.params.id!,
      reviewedById: req.user!.id,
      userId: req.body.userId,
      decision: req.body.decision,
      category: req.body.category,
      severity: req.body.severity,
      reason: req.body.reason,
    });
    res.status(200).json({ enforcementActionId: action.id, status: action.status });
  } catch (error) {
    next(error);
  }
});

adminTrustSafetyRouter.post('/admin/safety/reports/:id/dismiss', async (req, res, next) => {
  try {
    const report = await dismissSafetyReport(req.params.id!, req.user!.id);
    res.status(200).json({ id: report.id, status: report.status });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Enforcement actions (manual exception path + reversal)
// ---------------------------------------------------------------------------

adminTrustSafetyRouter.get('/admin/safety/enforcement-actions', validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const actions = await prisma.enforcementAction.findMany({
      where: cursorWhere(cursor),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(actions, limit);
    res.status(200).json({ enforcementActions: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

adminTrustSafetyRouter.post('/admin/safety/enforcement-actions', validate({ body: adminManualEnforcementSchema }), async (req, res, next) => {
  try {
    const action = await applyEnforcement({
      userId: req.body.userId,
      decision: req.body.decision,
      category: req.body.category,
      severity: req.body.severity,
      sourceType: 'MANUAL',
      reason: req.body.reason,
      actorId: req.user!.id,
    });
    res.status(201).json({ id: action.id, actionType: action.actionType, status: action.status });
  } catch (error) {
    next(error);
  }
});

adminTrustSafetyRouter.post('/admin/safety/enforcement-actions/:id/reverse', validate({ body: adminReverseEnforcementSchema }), async (req, res, next) => {
  try {
    const action = await reverseEnforcement(req.params.id!, req.user!.id, req.body.reason);
    res.status(200).json({ id: action.id, status: action.status });
  } catch (error) {
    next(error);
  }
});

/** Permanently banned accounts — a filtered view of enforcement actions, not a separate table. */
adminTrustSafetyRouter.get('/admin/safety/banned-accounts', validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const actions = await prisma.enforcementAction.findMany({
      where: { actionType: 'PERMANENT_BAN', status: 'ACTIVE', ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { user: { select: { id: true, email: true, phone: true } } },
    });
    const { page, nextCursor } = paginate(actions, limit);
    res.status(200).json({ bannedAccounts: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Appeals queue (the human-review exception path — most appeals resolve
// automatically in appealsService.ts before ever reaching here)
// ---------------------------------------------------------------------------

adminTrustSafetyRouter.get('/admin/safety/appeals', validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const appeals = await prisma.appeal.findMany({
      where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] }, ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(appeals, limit);
    res.status(200).json({ appeals: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

adminTrustSafetyRouter.post('/admin/safety/appeals/:id/decide', validate({ body: decideAppealSchema }), async (req, res, next) => {
  try {
    const appeal = await decideAppeal(req.params.id!, req.body.decision, req.user!.id, req.body.notes);
    res.status(200).json({ id: appeal.id, status: appeal.status });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Fraud / identity alerts (read-only visibility — clearing a FraudHold
// stays the existing Step 9 admin route, not duplicated here)
// ---------------------------------------------------------------------------

adminTrustSafetyRouter.get('/admin/safety/risk-assessments', validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const assessments = await prisma.riskAssessment.findMany({
      where: { OR: [{ blocked: true }, { riskScore: { gte: 40 } }], ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(assessments, limit);
    res.status(200).json({ riskAssessments: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

adminTrustSafetyRouter.get('/admin/safety/identity-alerts', validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const revoked = await prisma.identityTrustSignal.findMany({
      where: { status: 'REVOKED_BANNED', ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(revoked, limit);
    res.status(200).json({ revokedIdentities: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// AI/provider health + moderation analytics
// ---------------------------------------------------------------------------

/** Real-config-vs-approval status — never claims a vendor is "working" without a real key configured (mirrors Step 9's `/admin/payout-providers/status`). */
adminTrustSafetyRouter.get('/admin/safety/provider-status', async (_req, res, next) => {
  try {
    res.status(200).json({
      textModeration: { provider: 'XNAKVIEW_IN_HOUSE', configured: true, note: 'Always available — no external vendor required' },
      textModerationVendor: { provider: 'OPENAI', configured: isOpenAiModerationConfigured() },
      imageModeration: { provider: 'OPENAI', configured: isOpenAiModerationConfigured() },
      videoModeration: { provider: 'NONE', configured: false, note: 'No video AI vendor is configured — see the Step 10 completion report' },
      audioModeration: { provider: 'NONE', configured: false, note: 'No audio AI vendor is configured — see the Step 10 completion report' },
      liveness: { provider: 'NONE', configured: false, note: 'No liveness vendor is configured — see the Step 10 completion report' },
    });
  } catch (error) {
    next(error);
  }
});

adminTrustSafetyRouter.get('/admin/safety/analytics', async (_req, res, next) => {
  try {
    const [totalEvents, byDecision, activeBans, activeRestrictions, openReports, pendingAppeals] = await Promise.all([
      prisma.moderationEvent.count(),
      prisma.moderationEvent.groupBy({ by: ['decision'], _count: { _all: true } }),
      prisma.enforcementAction.count({ where: { actionType: 'PERMANENT_BAN', status: 'ACTIVE' } }),
      prisma.enforcementAction.count({ where: { actionType: 'TEMPORARY_ACCOUNT_RESTRICT', status: 'ACTIVE' } }),
      prisma.safetyReport.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      prisma.appeal.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
    ]);
    res.status(200).json({
      totalModerationEvents: totalEvents,
      byDecision: byDecision.map((d) => ({ decision: d.decision, count: d._count._all })),
      activePermanentBans: activeBans,
      activeTemporaryRestrictions: activeRestrictions,
      openSafetyReports: openReports,
      pendingAppeals,
    });
  } catch (error) {
    next(error);
  }
});
