import { Router } from 'express';

import { createSafetyReport } from '@/lib/moderation/safetyReportService';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { createSafetyReportSchema, listQuerySchema } from '@/schemas/moderation.schema';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { AppError } from '@/utils/AppError';

/**
 * Normalized reporting (brief §8) — the single reporting endpoint across
 * every reportable target, replacing the fragmented per-content-type
 * report routes for NEW reports (see `schema.prisma`'s `SafetyReport` doc
 * comment). Most severe content is already gone by the time a report would
 * even be filed (brief §11: automation-first) — this exists for the
 * violations automated detection didn't catch or that need a human's
 * read (impersonation, off-platform context, nuanced harassment).
 */
export const safetyReportsRouter = Router();

const reportLimiter = createAuthRateLimiter(60 * 1000, 20, 'safety-report');

safetyReportsRouter.post('/safety/reports', requireAuth, reportLimiter, validate({ body: createSafetyReportSchema }), async (req, res, next) => {
  try {
    const report = await createSafetyReport({
      reporterId: req.user!.id,
      targetType: req.body.targetType,
      targetId: req.body.targetId,
      targetUserId: req.body.targetUserId,
      reasonCategory: req.body.reasonCategory,
      details: req.body.details,
    });
    res.status(201).json({ id: report.id, status: report.status, createdAt: report.createdAt });
  } catch (error) {
    next(error);
  }
});

/** A reporter can see their own report history (never someone else's) — mirrors the withdrawal-history pattern elsewhere. */
safetyReportsRouter.get('/safety/reports', requireAuth, validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');

    const reports = await prisma.safetyReport.findMany({
      where: {
        reporterId: req.user!.id,
        ...(decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = reports.length > limit;
    const page = hasMore ? reports.slice(0, limit) : reports;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    res.status(200).json({
      reports: page.map((r) => ({ id: r.id, targetType: r.targetType, targetId: r.targetId, reasonCategory: r.reasonCategory, status: r.status, createdAt: r.createdAt })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});
