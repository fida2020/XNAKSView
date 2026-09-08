import { Router } from 'express';

import { prisma } from '@/lib/prisma';
import { requireAuthAllowRestricted } from '@/middleware/auth';

/**
 * TikTok-style "Account Status" (brief §9) — lets a user understand their
 * own standing, removed content, restrictions, warnings, and appeal
 * history WITHOUT ever exposing internal fraud scoring, detection-rule
 * internals, provider names, confidence scores, or `RiskAssessment` rows —
 * none of that is queried or returned here, deliberately, not just
 * filtered out after the fact.
 */
export const accountStatusRouter = Router();

// requireAuthAllowRestricted (not requireAuth) — a BANNED/SUSPENDED
// account must still be able to see its own standing; that's the entire
// point of this endpoint (brief §9/§10).
accountStatusRouter.get('/account/status', requireAuthAllowRestricted, async (req, res, next) => {
  try {
    const actions = await prisma.enforcementAction.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { appeals: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    res.status(200).json({
      accountStanding: req.user!.status,
      enforcementHistory: actions.map((action) => ({
        id: action.id,
        actionType: action.actionType,
        category: action.category,
        reason: action.reason,
        contentType: action.contentType,
        status: action.status,
        createdAt: action.createdAt,
        expiresAt: action.expiresAt,
        reversedAt: action.reversedAt,
        reversalReason: action.reversalReason,
        appeal: action.appeals[0]
          ? { id: action.appeals[0].id, status: action.appeals[0].status, decidedAt: action.appeals[0].decidedAt, decisionNotes: action.appeals[0].decisionNotes }
          : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});
