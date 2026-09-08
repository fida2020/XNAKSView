import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { liveRoomName, liveStreamingProvider } from '@/lib/liveStreaming';
import { prisma } from '@/lib/prisma';
import { fetchAuthorSummaries } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { inviteGuestSchema } from '@/schemas/live.schema';
import { AppError } from '@/utils/AppError';

/**
 * Co-host and multi-guest foundation for Step 4 — a single scalable
 * `LiveGuestSlot` model backs both a classic single co-host (role: CO_HOST)
 * and multi-guest (role: GUEST, several rows at once); LiveSession.maxGuestSlots
 * is the only thing that changes between the two, not the schema or these
 * routes. `canPublish: true` tokens are issued the same way a host's is, so
 * an accepted guest can genuinely publish audio/video into the room —
 * that part is real. What Step 4 does NOT build is mobile UI to render more
 * than the host's single video tile (see docs/STEP4_PROGRESS.md) — the
 * backend contract is ready for that UI in a following step.
 */
export const liveGuestsRouter = Router();

const guestActionLimiter = createAuthRateLimiter(60 * 1000, 30, 'live-guest');

async function loadSessionOrThrow(id: string) {
  const liveSession = await prisma.liveSession.findUnique({ where: { id } });
  if (!liveSession) {
    throw new AppError('NOT_FOUND', 'LIVE session not found');
  }
  return liveSession;
}

liveGuestsRouter.post(
  '/live/:id/guests/invite',
  requireAuth,
  guestActionLimiter,
  validate({ body: inviteGuestSchema }),
  async (req, res, next) => {
    try {
      const liveSession = await loadSessionOrThrow(req.params.id!);
      if (liveSession.hostId !== req.user!.id) {
        throw new AppError('FORBIDDEN', 'Only the host can invite a co-host/guest');
      }
      if (liveSession.status !== 'LIVE') {
        throw new AppError('CONFLICT', 'This LIVE session has ended');
      }

      const { userId, role } = req.body;
      if (userId === liveSession.hostId) {
        throw new AppError('BAD_REQUEST', 'The host cannot invite themself');
      }

      const slot = await prisma.liveGuestSlot.upsert({
        where: { liveSessionId_userId: { liveSessionId: liveSession.id, userId } },
        create: { liveSessionId: liveSession.id, userId, role, invitedById: req.user!.id, status: 'INVITED' },
        update: { role, status: 'INVITED', respondedAt: null, leftAt: null, invitedById: req.user!.id },
      });

      res.status(201).json({
        id: slot.id,
        liveSessionId: slot.liveSessionId,
        userId: slot.userId,
        role: slot.role,
        status: slot.status,
      });
    } catch (error) {
      next(error);
    }
  },
);

liveGuestsRouter.post('/live/:id/guests/accept', requireAuth, guestActionLimiter, async (req, res, next) => {
  try {
    const liveSession = await loadSessionOrThrow(req.params.id!);
    if (liveSession.status !== 'LIVE') {
      throw new AppError('CONFLICT', 'This LIVE session has ended');
    }

    const slot = await prisma.liveGuestSlot.findUnique({
      where: { liveSessionId_userId: { liveSessionId: liveSession.id, userId: req.user!.id } },
    });
    if (!slot || slot.status !== 'INVITED') {
      throw new AppError('NOT_FOUND', 'No pending invite for this LIVE session');
    }

    // Serializable, not just wrapped in a transaction: a plain read-then-write
    // (count active slots, then update) still lets two concurrent accepts
    // both read "1 free slot" before either commits, overrunning
    // maxGuestSlots. Serializable isolation makes Postgres abort one of the
    // two conflicting transactions instead — caught below as a 409.
    let updated;
    try {
      updated = await prisma.$transaction(
        async (tx) => {
          const activeCount = await tx.liveGuestSlot.count({ where: { liveSessionId: liveSession.id, status: 'ACTIVE' } });
          if (activeCount >= liveSession.maxGuestSlots) {
            throw new AppError('CONFLICT', 'This LIVE session has no free guest slots right now');
          }
          return tx.liveGuestSlot.update({
            where: { id: slot.id },
            data: { status: 'ACTIVE', respondedAt: new Date(), joinedAt: new Date() },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new AppError('CONFLICT', 'This LIVE session has no free guest slots right now');
      }
      throw error;
    }

    const token = await liveStreamingProvider.generateToken({
      roomName: liveRoomName(liveSession.id),
      identity: req.user!.id,
      canPublish: true,
    });

    res.status(200).json({
      id: updated.id,
      role: updated.role,
      status: updated.status,
      token,
      wsUrl: liveStreamingProvider.wsUrl,
    });
  } catch (error) {
    next(error);
  }
});

liveGuestsRouter.post('/live/:id/guests/decline', requireAuth, guestActionLimiter, async (req, res, next) => {
  try {
    const liveSession = await loadSessionOrThrow(req.params.id!);
    const slot = await prisma.liveGuestSlot.findUnique({
      where: { liveSessionId_userId: { liveSessionId: liveSession.id, userId: req.user!.id } },
    });
    if (!slot || slot.status !== 'INVITED') {
      throw new AppError('NOT_FOUND', 'No pending invite for this LIVE session');
    }

    const updated = await prisma.liveGuestSlot.update({
      where: { id: slot.id },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    res.status(200).json({ id: updated.id, status: updated.status });
  } catch (error) {
    next(error);
  }
});

liveGuestsRouter.post('/live/:id/guests/:userId/remove', requireAuth, guestActionLimiter, async (req, res, next) => {
  try {
    const liveSession = await loadSessionOrThrow(req.params.id!);
    if (liveSession.hostId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'Only the host can remove a co-host/guest');
    }

    const slot = await prisma.liveGuestSlot.findUnique({
      where: { liveSessionId_userId: { liveSessionId: liveSession.id, userId: req.params.userId! } },
    });
    if (!slot || slot.status !== 'ACTIVE') {
      throw new AppError('NOT_FOUND', 'This user is not an active co-host/guest');
    }

    const updated = await prisma.liveGuestSlot.update({
      where: { id: slot.id },
      data: { status: 'REMOVED', leftAt: new Date() },
    });
    res.status(200).json({ id: updated.id, status: updated.status });
  } catch (error) {
    next(error);
  }
});

liveGuestsRouter.post('/live/:id/guests/leave', requireAuth, guestActionLimiter, async (req, res, next) => {
  try {
    const liveSession = await loadSessionOrThrow(req.params.id!);
    const slot = await prisma.liveGuestSlot.findUnique({
      where: { liveSessionId_userId: { liveSessionId: liveSession.id, userId: req.user!.id } },
    });
    if (!slot || slot.status !== 'ACTIVE') {
      throw new AppError('NOT_FOUND', 'You are not an active co-host/guest in this LIVE session');
    }

    const updated = await prisma.liveGuestSlot.update({
      where: { id: slot.id },
      data: { status: 'LEFT', leftAt: new Date() },
    });
    res.status(200).json({ id: updated.id, status: updated.status });
  } catch (error) {
    next(error);
  }
});

liveGuestsRouter.get('/live/:id/guests', requireAuth, async (req, res, next) => {
  try {
    const liveSession = await loadSessionOrThrow(req.params.id!);
    const slots = await prisma.liveGuestSlot.findMany({
      where: { liveSessionId: liveSession.id, status: { in: ['INVITED', 'ACTIVE'] } },
      orderBy: { createdAt: 'asc' },
    });
    // Step 7: a viewer needs to know who a guest actually IS to target a
    // Gift at them (and to make sense of "Gift sent to @username" in the
    // realtime event) — the same batch author lookup already used for
    // video/LIVE-session author embedding, not a per-guest N+1 fetch.
    const authors = await fetchAuthorSummaries(slots.map((slot) => slot.userId));
    res.status(200).json({
      guests: slots.map((slot) => ({
        id: slot.id,
        userId: slot.userId,
        role: slot.role,
        status: slot.status,
        user: authors.get(slot.userId) ?? null,
      })),
      maxGuestSlots: liveSession.maxGuestSlots,
    });
  } catch (error) {
    next(error);
  }
});
