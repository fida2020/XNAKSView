import { Router } from 'express';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { createLiveMatchSchema, matchScoreSchema } from '@/schemas/live.schema';
import { AppError } from '@/utils/AppError';

/**
 * LIVE Match / Battle foundation — two hosts' own LiveSessions are paired,
 * viewers' "support" contributes to a side's score, and the match ends with
 * a winner. Deliberately has no Coins/Gifts wiring: score increments here
 * come from an authenticated participant call, not a real gift-value
 * ledger — that integration is explicit future work once Coins/Gifts exist
 * (see docs/STEP4_PROGRESS.md for the planned hook).
 *
 * Consent: creating a match only proposes it (PENDING) — the challenger
 * cannot also accept their own challenge. Only the challenged host
 * (sessionB, the `opponentSessionId` the challenger named) can accept or
 * decline, matching the guest-invite flow's invite/accept/decline shape.
 * This is what stops one host from unilaterally forcing another into a
 * battle.
 */
export const liveMatchesRouter = Router();

const matchActionLimiter = createAuthRateLimiter(60 * 1000, 30, 'live-match');

async function loadMatchOrThrow(id: string) {
  const match = await prisma.liveMatch.findUnique({ where: { id } });
  if (!match) {
    throw new AppError('NOT_FOUND', 'LIVE match not found');
  }
  return match;
}

function serializeMatch(match: {
  id: string;
  sessionAId: string;
  sessionBId: string;
  status: string;
  scoreA: number;
  scoreB: number;
  winnerSessionId: string | null;
  durationSeconds: number;
  startedAt: Date | null;
  endedAt: Date | null;
}) {
  return {
    id: match.id,
    sessionAId: match.sessionAId,
    sessionBId: match.sessionBId,
    status: match.status,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    winnerSessionId: match.winnerSessionId,
    durationSeconds: match.durationSeconds,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
  };
}

liveMatchesRouter.post(
  '/live/:id/match',
  requireAuth,
  matchActionLimiter,
  validate({ body: createLiveMatchSchema }),
  async (req, res, next) => {
    try {
      const sessionA = await prisma.liveSession.findUnique({ where: { id: req.params.id! } });
      if (!sessionA) throw new AppError('NOT_FOUND', 'LIVE session not found');
      if (sessionA.hostId !== req.user!.id) {
        throw new AppError('FORBIDDEN', 'Only the host can challenge another session to a LIVE Match from their own session');
      }
      if (sessionA.status !== 'LIVE') {
        throw new AppError('CONFLICT', 'Your LIVE session has ended');
      }

      const { opponentSessionId, durationSeconds } = req.body;
      if (opponentSessionId === sessionA.id) {
        throw new AppError('BAD_REQUEST', 'A LIVE session cannot battle itself');
      }

      const sessionB = await prisma.liveSession.findUnique({ where: { id: opponentSessionId } });
      if (!sessionB || sessionB.status !== 'LIVE') {
        throw new AppError('BAD_REQUEST', 'The opposing LIVE session is not currently live');
      }

      // A PENDING challenge is a proposal, not a battle — it only becomes
      // ACTIVE once the challenged host (sessionB) explicitly accepts below.
      const match = await prisma.liveMatch.create({
        data: {
          sessionAId: sessionA.id,
          sessionBId: sessionB.id,
          durationSeconds,
          status: 'PENDING',
        },
      });

      res.status(201).json(serializeMatch(match));
    } catch (error) {
      next(error);
    }
  },
);

async function assertMatchParticipant(matchId: string, userId: string) {
  const match = await loadMatchOrThrow(matchId);
  const [sessionA, sessionB] = await Promise.all([
    prisma.liveSession.findUnique({ where: { id: match.sessionAId } }),
    prisma.liveSession.findUnique({ where: { id: match.sessionBId } }),
  ]);
  if (sessionA?.hostId !== userId && sessionB?.hostId !== userId) {
    throw new AppError('FORBIDDEN', 'Only a participating host can manage this LIVE Match');
  }
  return { match, sessionA, sessionB };
}

/** Only the challenged host (sessionB) may respond to a pending challenge. */
async function assertChallengedHost(matchId: string, userId: string) {
  const match = await loadMatchOrThrow(matchId);
  const sessionB = await prisma.liveSession.findUnique({ where: { id: match.sessionBId } });
  if (sessionB?.hostId !== userId) {
    throw new AppError('FORBIDDEN', 'Only the challenged host can respond to this LIVE Match request');
  }
  return { match, sessionB };
}

liveMatchesRouter.post('/live/matches/:matchId/accept', requireAuth, async (req, res, next) => {
  try {
    const { match, sessionB } = await assertChallengedHost(req.params.matchId!, req.user!.id);
    if (match.status !== 'PENDING') {
      throw new AppError('CONFLICT', 'This LIVE Match request is no longer pending');
    }
    if (sessionB?.status !== 'LIVE') {
      throw new AppError('CONFLICT', 'Your LIVE session has ended');
    }

    const sessionA = await prisma.liveSession.findUnique({ where: { id: match.sessionAId } });
    if (sessionA?.status !== 'LIVE') {
      throw new AppError('CONFLICT', 'The challenging LIVE session is no longer live');
    }

    const updated = await prisma.liveMatch.update({
      where: { id: match.id },
      data: { status: 'ACTIVE', startedAt: new Date() },
    });
    res.status(200).json(serializeMatch(updated));
  } catch (error) {
    next(error);
  }
});

liveMatchesRouter.post('/live/matches/:matchId/decline', requireAuth, async (req, res, next) => {
  try {
    const { match } = await assertChallengedHost(req.params.matchId!, req.user!.id);
    if (match.status !== 'PENDING') {
      throw new AppError('CONFLICT', 'This LIVE Match request is no longer pending');
    }

    const updated = await prisma.liveMatch.update({
      where: { id: match.id },
      data: { status: 'CANCELLED' },
    });
    res.status(200).json(serializeMatch(updated));
  } catch (error) {
    next(error);
  }
});

/**
 * Score contribution requires the caller to actually be there: the host of
 * either side, an active viewer of either session, or an active co-host/
 * guest of either session. Previously this only checked `requireAuth`,
 * which let any registered account (never having joined anything) inflate
 * either score — fixed here.
 */
async function assertCanScoreMatch(sessionAId: string, sessionBId: string, userId: string): Promise<void> {
  const sessionIds = [sessionAId, sessionBId];

  const [sessionA, sessionB] = await Promise.all([
    prisma.liveSession.findUnique({ where: { id: sessionAId }, select: { hostId: true } }),
    prisma.liveSession.findUnique({ where: { id: sessionBId }, select: { hostId: true } }),
  ]);
  if (sessionA?.hostId === userId || sessionB?.hostId === userId) return;

  const activeViewer = await prisma.liveViewer.findFirst({
    where: { userId, leftAt: null, liveSessionId: { in: sessionIds } },
    select: { id: true },
  });
  if (activeViewer) return;

  const activeGuest = await prisma.liveGuestSlot.findFirst({
    where: { userId, status: 'ACTIVE', liveSessionId: { in: sessionIds } },
    select: { id: true },
  });
  if (activeGuest) return;

  throw new AppError('FORBIDDEN', 'Only a participant or viewer of one of these LIVE sessions can score this LIVE Match');
}

liveMatchesRouter.post(
  '/live/matches/:matchId/score',
  requireAuth,
  matchActionLimiter,
  validate({ body: matchScoreSchema }),
  async (req, res, next) => {
    try {
      const match = await loadMatchOrThrow(req.params.matchId!);
      if (match.status !== 'ACTIVE') {
        throw new AppError('CONFLICT', 'This LIVE Match is not active');
      }

      await assertCanScoreMatch(match.sessionAId, match.sessionBId, req.user!.id);

      const { side, increment } = req.body;
      const updated = await prisma.liveMatch.update({
        where: { id: match.id },
        data: side === 'A' ? { scoreA: { increment } } : { scoreB: { increment } },
      });

      res.status(200).json(serializeMatch(updated));
    } catch (error) {
      next(error);
    }
  },
);

liveMatchesRouter.post('/live/matches/:matchId/end', requireAuth, async (req, res, next) => {
  try {
    const { match } = await assertMatchParticipant(req.params.matchId!, req.user!.id);
    if (match.status !== 'ACTIVE') {
      throw new AppError('CONFLICT', 'This LIVE Match is not active');
    }

    const winnerSessionId =
      match.scoreA === match.scoreB ? null : match.scoreA > match.scoreB ? match.sessionAId : match.sessionBId;

    const updated = await prisma.liveMatch.update({
      where: { id: match.id },
      data: { status: 'ENDED', endedAt: new Date(), winnerSessionId },
    });
    res.status(200).json(serializeMatch(updated));
  } catch (error) {
    next(error);
  }
});

liveMatchesRouter.get('/live/matches/:matchId', requireAuth, async (req, res, next) => {
  try {
    const match = await loadMatchOrThrow(req.params.matchId!);
    res.status(200).json(serializeMatch(match));
  } catch (error) {
    next(error);
  }
});
