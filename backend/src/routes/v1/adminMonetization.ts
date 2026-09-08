import { Router } from 'express';

import { reverseAdRevenueEvent } from '@/lib/adRevenueService';
import { recordFinancialAudit } from '@/lib/financialAudit';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { requireAdmin } from '@/middleware/requireAdmin';
import { validate } from '@/middleware/validate';
import {
  adminListAdRevenueQuerySchema,
  adminListCreatorMonetizationQuerySchema,
  createAdRevenueShareRuleSchema,
  createEligibilityRuleSchema,
  reverseAdRevenueEventSchema,
  updateCreatorMonetizationStatusSchema,
} from '@/schemas/monetization.schema';
import { AppError } from '@/utils/AppError';

/**
 * Admin management of Step 8 Creator Monetization — eligibility rules,
 * the 70/30-default ad-revenue split, creator status transitions, revenue
 * inspection/reversal, and the aggregate summary. Every rule change
 * inserts a new versioned/effective-dated row (never edits an old one);
 * every status/reversal action records a `FinancialAuditLog` entry.
 */
export const adminMonetizationRouter = Router();

adminMonetizationRouter.use(requireAuth, requireAdmin);

// -----------------------------------------------------------------------
// Eligibility rules
// -----------------------------------------------------------------------

adminMonetizationRouter.get('/admin/monetization/eligibility-rules', async (_req, res, next) => {
  try {
    const rules = await prisma.monetizationEligibilityRule.findMany({ orderBy: { effectiveFrom: 'desc' } });
    res.status(200).json({ rules });
  } catch (error) {
    next(error);
  }
});

adminMonetizationRouter.post('/admin/monetization/eligibility-rules', validate({ body: createEligibilityRuleSchema }), async (req, res, next) => {
  try {
    const rule = await prisma.monetizationEligibilityRule.create({ data: { ...req.body, createdById: req.user!.id } });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'MONETIZATION_ELIGIBILITY_RULE_CREATED', entityType: 'MonetizationEligibilityRule', entityId: rule.id, metadata: req.body });
    res.status(201).json(rule);
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Ad-revenue share (creator/platform %) — defaults to 70/30, admin-configurable.
// -----------------------------------------------------------------------

adminMonetizationRouter.get('/admin/monetization/ad-revenue-share-rules', async (_req, res, next) => {
  try {
    const rules = await prisma.adRevenueShareRule.findMany({ orderBy: { effectiveFrom: 'desc' } });
    res.status(200).json({ rules: rules.map((r) => ({ ...r, creatorSharePercent: r.creatorSharePercent.toFixed(2), platformSharePercent: r.platformSharePercent.toFixed(2) })) });
  } catch (error) {
    next(error);
  }
});

adminMonetizationRouter.post('/admin/monetization/ad-revenue-share-rules', validate({ body: createAdRevenueShareRuleSchema }), async (req, res, next) => {
  try {
    const rule = await prisma.adRevenueShareRule.create({ data: { ...req.body, createdById: req.user!.id } });
    await recordFinancialAudit({ actorId: req.user!.id, action: 'AD_REVENUE_SHARE_RULE_CREATED', entityType: 'AdRevenueShareRule', entityId: rule.id, metadata: req.body });
    res.status(201).json({ ...rule, creatorSharePercent: rule.creatorSharePercent.toFixed(2), platformSharePercent: rule.platformSharePercent.toFixed(2) });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Creator monetization status
// -----------------------------------------------------------------------

adminMonetizationRouter.get('/admin/monetization/creators', validate({ query: adminListCreatorMonetizationQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const records = await prisma.creatorMonetization.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(decoded ? { OR: [{ statusUpdatedAt: { lt: new Date(decoded.createdAt) } }, { statusUpdatedAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ statusUpdatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { creator: { select: { id: true, email: true, phone: true, followerCount: true } } },
    });

    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.statusUpdatedAt.toISOString(), id: last.id }) : null;

    res.status(200).json({
      creators: page.map((r) => ({
        creatorId: r.creatorId,
        email: r.creator.email,
        phone: r.creator.phone,
        followerCount: r.creator.followerCount,
        status: r.status,
        activatedAt: r.activatedAt,
        statusReason: r.statusReason,
        statusUpdatedAt: r.statusUpdatedAt,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

adminMonetizationRouter.patch('/admin/monetization/creators/:id/status', validate({ body: updateCreatorMonetizationStatusSchema }), async (req, res, next) => {
  try {
    const creatorId = req.params.id!;
    const { status, reason } = req.body;

    const existing = await prisma.creatorMonetization.upsert({
      where: { creatorId },
      create: { creatorId, status: 'NOT_ELIGIBLE' },
      update: {},
    });

    const updated = await prisma.creatorMonetization.update({
      where: { creatorId },
      data: {
        status,
        statusReason: reason,
        statusUpdatedAt: new Date(),
        statusUpdatedById: req.user!.id,
        // Set ONCE, the first time ACTIVE is ever reached — never cleared
        // or moved on a later suspend/re-activate (brief §2: "the effective
        // monetization activation timestamp... must be stored").
        activatedAt: status === 'ACTIVE' && !existing.activatedAt ? new Date() : undefined,
      },
    });

    await recordFinancialAudit({
      actorId: req.user!.id,
      action: 'CREATOR_MONETIZATION_STATUS_CHANGED',
      entityType: 'CreatorMonetization',
      entityId: updated.id,
      metadata: { creatorId, fromStatus: existing.status, toStatus: status, reason },
    });

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Ad revenue inspection + reversal
// -----------------------------------------------------------------------

adminMonetizationRouter.get('/admin/monetization/ad-revenue', validate({ query: adminListAdRevenueQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit, creatorId, videoId, status } = req.query as unknown as { cursor?: string; limit: number; creatorId?: string; videoId?: string; status?: string };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const events = await prisma.adRevenueEvent.findMany({
      where: {
        ...(creatorId ? { creatorId } : {}),
        ...(videoId ? { videoId } : {}),
        ...(status ? { status: status as never } : {}),
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    res.status(200).json({
      events: page.map((e) => ({
        ...e,
        creatorSharePercentSnapshot: e.creatorSharePercentSnapshot?.toFixed(2) ?? null,
        platformSharePercentSnapshot: e.platformSharePercentSnapshot?.toFixed(2) ?? null,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

adminMonetizationRouter.post('/admin/monetization/ad-revenue/:id/reverse', validate({ body: reverseAdRevenueEventSchema }), async (req, res, next) => {
  try {
    const result = await reverseAdRevenueEvent({ originalEventId: req.params.id!, reason: req.body.reason, idempotencyKey: req.body.idempotencyKey });
    await recordFinancialAudit({
      actorId: req.user!.id,
      action: 'AD_REVENUE_EVENT_REVERSED',
      entityType: 'AdRevenueEvent',
      entityId: result.event.id,
      metadata: { originalEventId: req.params.id, reason: req.body.reason },
    });
    res.status(201).json({ ...result.event, creatorEarningsBalance: result.creatorEarningsBalance });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Aggregate summary
// -----------------------------------------------------------------------

adminMonetizationRouter.get('/admin/monetization/summary', async (_req, res, next) => {
  try {
    const [grossTotal, creatorTotal, platformTotal, preMonetizationTotal, statusCounts] = await Promise.all([
      prisma.adRevenueEvent.aggregate({ _sum: { grossRevenueMinorUnits: true } }),
      prisma.adRevenueEvent.aggregate({ _sum: { creatorShareMinorUnits: true } }),
      prisma.adRevenueEvent.aggregate({ _sum: { platformShareMinorUnits: true } }),
      prisma.adRevenueEvent.aggregate({ where: { wasMonetizationActive: false }, _sum: { grossRevenueMinorUnits: true } }),
      prisma.creatorMonetization.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    res.status(200).json({
      grossRevenueMinorUnits: grossTotal._sum.grossRevenueMinorUnits ?? 0,
      creatorShareMinorUnits: creatorTotal._sum.creatorShareMinorUnits ?? 0,
      platformShareMinorUnits: platformTotal._sum.platformShareMinorUnits ?? 0,
      preMonetizationRevenueMinorUnits: preMonetizationTotal._sum.grossRevenueMinorUnits ?? 0,
      creatorsByStatus: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])),
    });
  } catch (error) {
    next(error);
  }
});
