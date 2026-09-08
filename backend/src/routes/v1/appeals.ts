import { Router } from 'express';

import { submitAppeal } from '@/lib/moderation/appealsService';
import { prisma } from '@/lib/prisma';
import { requireAuthAllowRestricted } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { submitAppealSchema } from '@/schemas/moderation.schema';
import { AppError } from '@/utils/AppError';

/**
 * Real appeal lifecycle (brief §10): submit -> automated re-evaluation (see
 * `appealsService.ts`) or human review -> accepted/rejected -> the
 * underlying enforcement is reversed/restored on ACCEPTED. Never deletes
 * the original enforcement/audit history.
 */
export const appealsRouter = Router();

const appealLimiter = createAuthRateLimiter(60 * 1000, 10, 'appeal-submit');

// requireAuthAllowRestricted — a banned/suspended user must be able to
// appeal the very enforcement that restricted them (brief §10).
appealsRouter.post('/enforcement-actions/:id/appeal', requireAuthAllowRestricted, appealLimiter, validate({ body: submitAppealSchema }), async (req, res, next) => {
  try {
    const appeal = await submitAppeal(req.params.id!, req.user!.id, req.body.reason);
    res.status(201).json({ id: appeal.id, status: appeal.status, decisionNotes: appeal.decisionNotes });
  } catch (error) {
    next(error);
  }
});

appealsRouter.get('/appeals/:id', requireAuthAllowRestricted, async (req, res, next) => {
  try {
    const appeal = await prisma.appeal.findUnique({ where: { id: req.params.id! } });
    if (!appeal || appeal.submittedById !== req.user!.id) {
      throw new AppError('NOT_FOUND', 'Appeal not found');
    }
    res.status(200).json({ id: appeal.id, status: appeal.status, decidedAt: appeal.decidedAt, decisionNotes: appeal.decisionNotes, createdAt: appeal.createdAt });
  } catch (error) {
    next(error);
  }
});
