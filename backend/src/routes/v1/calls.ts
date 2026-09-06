import { randomUUID } from 'crypto';

import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { env } from '@/config/env';
import { isBlockedEitherDirection } from '@/lib/messagingAccess';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { notificationDispatcher } from '@/lib/notifications';
import { emitToUser } from '@/lib/realtime';
import { liveStreamingProvider } from '@/lib/liveStreaming';
import { fetchAuthorSummaries } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { createCallSchema, listCallsQuerySchema, reportCallSchema } from '@/schemas/messaging.schema';
import { AppError } from '@/utils/AppError';

/**
 * 1:1 voice/video calls, real WebRTC via the same self-hosted LiveKit
 * `LiveStreamingProvider` Step 4 LIVE uses (lib/liveStreaming.ts) — a call
 * is just a two-participant room with a short lifecycle around it. The
 * server is authoritative for every relationship (caller/callee identity,
 * who may accept/decline/end, block/ban checks) — a client never asserts
 * anything about call ownership beyond "which call id am I acting on."
 */
export const callsRouter = Router();

const initiateLimiter = createAuthRateLimiter(60 * 1000, 6, 'call-initiate');
const actionLimiter = createAuthRateLimiter(60 * 1000, 30, 'call-action');
const reportLimiter = createAuthRateLimiter(60 * 60 * 1000, 10, 'call-report');

function callRoomName(callId: string): string {
  return `call-${callId}`;
}

function serializeCall(call: {
  id: string;
  callerId: string;
  calleeId: string;
  type: string;
  status: string;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  failureReason: string | null;
}) {
  return {
    id: call.id,
    callerId: call.callerId,
    calleeId: call.calleeId,
    type: call.type,
    status: call.status,
    startedAt: call.startedAt.toISOString(),
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    durationSeconds: call.durationSeconds,
    failureReason: call.failureReason,
  };
}

async function loadCallOrThrow(id: string) {
  const call = await prisma.call.findUnique({ where: { id } });
  if (!call) {
    throw new AppError('NOT_FOUND', 'Call not found');
  }
  return call;
}

function assertParticipant(call: { callerId: string; calleeId: string }, userId: string) {
  if (call.callerId !== userId && call.calleeId !== userId) {
    throw new AppError('NOT_FOUND', 'Call not found');
  }
}

// In-memory ring timers — a real limitation of not having a job queue: a
// server restart mid-ring loses the scheduled timeout (the call would stay
// RINGING until one side acts on it, or the client-side timeout gives up
// and calls /cancel). See docs/STEP5_PROGRESS.md.
const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearRingTimer(callId: string): void {
  const timer = ringTimers.get(callId);
  if (timer) {
    clearTimeout(timer);
    ringTimers.delete(callId);
  }
}

async function endCallAs(callId: string, status: 'MISSED' | 'DECLINED' | 'CANCELLED' | 'ENDED' | 'FAILED', failureReason?: string) {
  clearRingTimer(callId);
  const call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call || call.status === 'ENDED' || call.status === 'DECLINED' || call.status === 'CANCELLED' || call.status === 'MISSED' || call.status === 'FAILED') {
    return call;
  }
  const now = new Date();
  const updated = await prisma.call.update({
    where: { id: callId },
    data: {
      status,
      endedAt: now,
      failureReason,
      durationSeconds: call.answeredAt ? Math.round((now.getTime() - call.answeredAt.getTime()) / 1000) : null,
    },
  });
  await liveStreamingProvider.deleteRoom(callRoomName(callId));
  return updated;
}

function scheduleRingTimeout(callId: string, callerId: string, calleeId: string) {
  const timer = setTimeout(() => {
    void endCallAs(callId, 'MISSED').then((updated) => {
      if (!updated) return;
      emitToUser(callerId, 'call:missed', { callId });
      emitToUser(calleeId, 'call:missed', { callId });
      // The callee is the one who "missed" it — they're the one who should
      // see "missed call from X" the next time they open the app.
      notificationDispatcher.notify(calleeId, 'MISSED_CALL', { callId });
    });
  }, env.CALL_RING_TIMEOUT_SECONDS * 1000);
  ringTimers.set(callId, timer);
}

callsRouter.post('/calls', requireAuth, initiateLimiter, validate({ body: createCallSchema }), async (req, res, next) => {
  try {
    const callerId = req.user!.id;
    const { calleeId, type } = req.body;

    if (calleeId === callerId) {
      throw new AppError('BAD_REQUEST', 'You cannot call yourself');
    }

    const callee = await prisma.user.findUnique({ where: { id: calleeId }, select: { id: true, status: true } });
    if (!callee || callee.status !== 'ACTIVE') {
      throw new AppError('NOT_FOUND', 'User not found');
    }

    if (await isBlockedEitherDirection(callerId, calleeId)) {
      throw new AppError('FORBIDDEN', 'You cannot call this user right now');
    }

    // Serializable, not a plain read-then-write: two concurrent initiations
    // (the same caller double-tapping, or two different callers dialing the
    // same callee at once) could otherwise both read "nobody's busy" before
    // either commits, creating two simultaneous RINGING calls for the same
    // person — the same class of race Step 4's guest-slot accept had.
    // Postgres aborts one side as a serialization failure, caught below.
    const activeStatuses: Prisma.CallWhereInput['status'] = { in: ['RINGING', 'ACCEPTED'] };
    const callId = randomUUID();
    const roomName = callRoomName(callId);

    let call;
    let calleeBusy = false;
    try {
      call = await prisma.$transaction(
        async (tx) => {
          const [callerBusyRow, calleeBusyRow] = await Promise.all([
            tx.call.findFirst({ where: { OR: [{ callerId }, { calleeId: callerId }], status: activeStatuses } }),
            tx.call.findFirst({ where: { OR: [{ callerId: calleeId }, { calleeId }], status: activeStatuses } }),
          ]);
          if (callerBusyRow) {
            throw new AppError('CONFLICT', 'You are already in a call');
          }
          if (calleeBusyRow) {
            calleeBusy = true;
            return tx.call.create({
              data: { callerId, calleeId, type, status: 'BUSY', roomName: '', endedAt: new Date() },
            });
          }
          return tx.call.create({ data: { id: callId, callerId, calleeId, type, status: 'RINGING', roomName } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new AppError('CONFLICT', 'Please try calling again');
      }
      throw error;
    }

    if (calleeBusy) {
      res.status(200).json({ call: serializeCall(call) });
      return;
    }

    await liveStreamingProvider.createRoom(roomName);
    const token = await liveStreamingProvider.generateToken({ roomName, identity: callerId, canPublish: true });

    scheduleRingTimeout(call.id, callerId, calleeId);

    const callerSummary = (await fetchAuthorSummaries([callerId])).get(callerId);
    emitToUser(calleeId, 'call:incoming', { call: serializeCall(call), caller: callerSummary });
    notificationDispatcher.notify(calleeId, type === 'VIDEO' ? 'INCOMING_VIDEO_CALL' : 'INCOMING_VOICE_CALL', {
      callId: call.id,
      callerId,
    });

    res.status(201).json({ call: serializeCall(call), token, wsUrl: liveStreamingProvider.wsUrl });
  } catch (error) {
    next(error);
  }
});

callsRouter.post('/calls/:id/accept', requireAuth, actionLimiter, async (req, res, next) => {
  try {
    const call = await loadCallOrThrow(req.params.id!);
    if (call.calleeId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'Only the callee can accept this call');
    }
    if (call.status !== 'RINGING') {
      throw new AppError('CONFLICT', 'This call is no longer ringing');
    }

    clearRingTimer(call.id);
    const updated = await prisma.call.update({ where: { id: call.id }, data: { status: 'ACCEPTED', answeredAt: new Date() } });

    const token = await liveStreamingProvider.generateToken({
      roomName: call.roomName,
      identity: req.user!.id,
      canPublish: true,
    });

    emitToUser(call.callerId, 'call:accepted', { callId: call.id });
    res.status(200).json({ call: serializeCall(updated), token, wsUrl: liveStreamingProvider.wsUrl });
  } catch (error) {
    next(error);
  }
});

callsRouter.post('/calls/:id/decline', requireAuth, actionLimiter, async (req, res, next) => {
  try {
    const call = await loadCallOrThrow(req.params.id!);
    if (call.calleeId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'Only the callee can decline this call');
    }
    if (call.status !== 'RINGING') {
      throw new AppError('CONFLICT', 'This call is no longer ringing');
    }

    const updated = await endCallAs(call.id, 'DECLINED');
    emitToUser(call.callerId, 'call:declined', { callId: call.id });
    res.status(200).json({ call: serializeCall(updated!) });
  } catch (error) {
    next(error);
  }
});

callsRouter.post('/calls/:id/cancel', requireAuth, actionLimiter, async (req, res, next) => {
  try {
    const call = await loadCallOrThrow(req.params.id!);
    if (call.callerId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'Only the caller can cancel this call');
    }
    if (call.status !== 'RINGING') {
      throw new AppError('CONFLICT', 'This call is no longer ringing');
    }

    const updated = await endCallAs(call.id, 'CANCELLED');
    emitToUser(call.calleeId, 'call:cancelled', { callId: call.id });
    res.status(200).json({ call: serializeCall(updated!) });
  } catch (error) {
    next(error);
  }
});

callsRouter.post('/calls/:id/end', requireAuth, actionLimiter, async (req, res, next) => {
  try {
    const call = await loadCallOrThrow(req.params.id!);
    assertParticipant(call, req.user!.id);
    if (call.status !== 'ACCEPTED') {
      throw new AppError('CONFLICT', 'This call is not active');
    }

    const updated = await endCallAs(call.id, 'ENDED');
    const otherId = call.callerId === req.user!.id ? call.calleeId : call.callerId;
    emitToUser(otherId, 'call:ended', { callId: call.id });
    res.status(200).json({ call: serializeCall(updated!) });
  } catch (error) {
    next(error);
  }
});

callsRouter.get('/calls/:id', requireAuth, async (req, res, next) => {
  try {
    const call = await loadCallOrThrow(req.params.id!);
    assertParticipant(call, req.user!.id);
    res.status(200).json(serializeCall(call));
  } catch (error) {
    next(error);
  }
});

callsRouter.get('/calls', requireAuth, validate({ query: listCallsQuerySchema }), async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new AppError('BAD_REQUEST', 'Invalid cursor');
    }

    const calls = await prisma.call.findMany({
      where: {
        OR: [{ callerId: userId }, { calleeId: userId }],
        ...(decoded
          ? {
              OR: [
                { startedAt: { lt: new Date(decoded.createdAt) } },
                { startedAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = calls.length > limit;
    const page = hasMore ? calls.slice(0, limit) : calls;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.startedAt.toISOString(), id: last.id }) : null;

    const otherIds = [...new Set(page.map((c) => (c.callerId === userId ? c.calleeId : c.callerId)))];
    const authors = await fetchAuthorSummaries(otherIds);

    res.status(200).json({
      calls: page.map((c) => ({
        ...serializeCall(c),
        otherUser: authors.get(c.callerId === userId ? c.calleeId : c.callerId),
        direction: c.callerId === userId ? 'OUTGOING' : 'INCOMING',
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

callsRouter.post('/calls/:id/report', requireAuth, reportLimiter, validate({ body: reportCallSchema }), async (req, res, next) => {
  try {
    const call = await loadCallOrThrow(req.params.id!);
    assertParticipant(call, req.user!.id);

    const report = await prisma.callReport.create({
      data: { callId: call.id, reporterId: req.user!.id, reason: req.body.reason, description: req.body.description },
    });
    res.status(201).json({ id: report.id, callId: report.callId, status: report.status });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('CONFLICT', 'You have already reported this call'));
      return;
    }
    next(error);
  }
});
