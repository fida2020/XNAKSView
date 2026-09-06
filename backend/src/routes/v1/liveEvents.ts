import { Router } from 'express';

import { checkLiveEligibility } from '@/lib/liveEligibility';
import { liveRoomName, liveStreamingProvider } from '@/lib/liveStreaming';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { fetchAuthorSummaries } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import {
  createLiveEventSchema,
  listLiveEventsQuerySchema,
  rescheduleLiveEventSchema,
} from '@/schemas/live.schema';
import { AppError } from '@/utils/AppError';

/**
 * LIVE scheduling ("LIVE events"). A creator announces an upcoming LIVE so
 * followers can discover it ahead of time and set a reminder; starting the
 * event creates a real LiveSession the same way `POST /live` does. This is
 * the "LIVE discovery / upcoming LIVE / scheduled LIVE events" foundation —
 * actual push-notification delivery for reminders is a later step's
 * notification-fan-out infrastructure (see docs/STEP4_PROGRESS.md); this
 * router only records who asked to be reminded.
 */
export const liveEventsRouter = Router();

const eventLimiter = createAuthRateLimiter(60 * 60 * 1000, 20, 'live-event');
const reminderLimiter = createAuthRateLimiter(60 * 1000, 30, 'live-event-reminder');

async function loadEventOrThrow(id: string) {
  const event = await prisma.liveEvent.findUnique({ where: { id } });
  if (!event) {
    throw new AppError('NOT_FOUND', 'LIVE event not found');
  }
  return event;
}

function serializeEvent(event: {
  id: string;
  hostId: string;
  title: string;
  description: string | null;
  category: string | null;
  scheduledAt: Date;
  status: string;
  liveSessionId: string | null;
  createdAt: Date;
}) {
  return {
    id: event.id,
    hostId: event.hostId,
    title: event.title,
    description: event.description,
    category: event.category,
    scheduledAt: event.scheduledAt,
    status: event.status,
    liveSessionId: event.liveSessionId,
    createdAt: event.createdAt,
  };
}

liveEventsRouter.post(
  '/live/events',
  requireAuth,
  eventLimiter,
  validate({ body: createLiveEventSchema }),
  async (req, res, next) => {
    try {
      const { title, description, category, scheduledAt } = req.body;
      const event = await prisma.liveEvent.create({
        data: { hostId: req.user!.id, title, description, category, scheduledAt },
      });
      res.status(201).json(serializeEvent(event));
    } catch (error) {
      next(error);
    }
  },
);

liveEventsRouter.get(
  '/live/events',
  requireAuth,
  validate({ query: listLiveEventsQuerySchema }),
  async (req, res, next) => {
    try {
      const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      const events = await prisma.liveEvent.findMany({
        where: {
          status: (status as never) ?? 'SCHEDULED',
          ...(decoded
            ? {
                OR: [
                  { scheduledAt: { gt: new Date(decoded.createdAt) } },
                  { scheduledAt: new Date(decoded.createdAt), id: { gt: decoded.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });

      const hasMore = events.length > limit;
      const page = hasMore ? events.slice(0, limit) : events;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.scheduledAt.toISOString(), id: last.id }) : null;

      const authors = await fetchAuthorSummaries([...new Set(page.map((event) => event.hostId))]);

      res.status(200).json({
        events: page.map((event) => ({ ...serializeEvent(event), host: authors.get(event.hostId) })),
        nextCursor,
      });
    } catch (error) {
      next(error);
    }
  },
);

liveEventsRouter.get('/live/events/:id', requireAuth, async (req, res, next) => {
  try {
    const event = await loadEventOrThrow(req.params.id!);
    const authors = await fetchAuthorSummaries([event.hostId]);
    res.status(200).json({ ...serializeEvent(event), host: authors.get(event.hostId) });
  } catch (error) {
    next(error);
  }
});

liveEventsRouter.patch(
  '/live/events/:id',
  requireAuth,
  validate({ body: rescheduleLiveEventSchema }),
  async (req, res, next) => {
    try {
      const event = await loadEventOrThrow(req.params.id!);
      if (event.hostId !== req.user!.id) {
        throw new AppError('FORBIDDEN', 'You can only reschedule your own LIVE event');
      }
      if (event.status !== 'SCHEDULED') {
        throw new AppError('CONFLICT', 'Only a scheduled LIVE event can be rescheduled');
      }

      const updated = await prisma.liveEvent.update({
        where: { id: event.id },
        data: { scheduledAt: req.body.scheduledAt },
      });
      res.status(200).json(serializeEvent(updated));
    } catch (error) {
      next(error);
    }
  },
);

liveEventsRouter.post('/live/events/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const event = await loadEventOrThrow(req.params.id!);
    if (event.hostId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only cancel your own LIVE event');
    }
    if (event.status !== 'SCHEDULED') {
      throw new AppError('CONFLICT', 'Only a scheduled LIVE event can be cancelled');
    }

    const updated = await prisma.liveEvent.update({ where: { id: event.id }, data: { status: 'CANCELLED' } });
    res.status(200).json(serializeEvent(updated));
  } catch (error) {
    next(error);
  }
});

liveEventsRouter.post('/live/events/:id/start', requireAuth, async (req, res, next) => {
  try {
    const event = await loadEventOrThrow(req.params.id!);
    if (event.hostId !== req.user!.id) {
      throw new AppError('FORBIDDEN', 'You can only start your own LIVE event');
    }
    if (event.status !== 'SCHEDULED') {
      throw new AppError('CONFLICT', 'This LIVE event is not scheduled');
    }

    // Same gate `POST /live` enforces — starting through a scheduled event
    // must not be a way to skip age/account-age eligibility.
    const eligibility = checkLiveEligibility({
      ageVerified: req.user!.ageVerified,
      accountCreatedAt: req.user!.createdAt,
    });
    if (!eligibility.eligible) {
      throw new AppError('FORBIDDEN', eligibility.reason ?? 'You are not eligible to go LIVE');
    }

    const liveSession = await prisma.liveSession.create({
      data: { hostId: req.user!.id, title: event.title, category: event.category, status: 'LIVE' },
    });

    const roomName = liveRoomName(liveSession.id);
    await liveStreamingProvider.createRoom(roomName);
    const token = await liveStreamingProvider.generateToken({
      roomName,
      identity: req.user!.id,
      canPublish: true,
    });

    const updatedEvent = await prisma.liveEvent.update({
      where: { id: event.id },
      data: { status: 'STARTED', liveSessionId: liveSession.id },
    });

    res.status(201).json({
      event: serializeEvent(updatedEvent),
      liveSessionId: liveSession.id,
      token,
      wsUrl: liveStreamingProvider.wsUrl,
    });
  } catch (error) {
    next(error);
  }
});

liveEventsRouter.post('/live/events/:id/remind', requireAuth, reminderLimiter, async (req, res, next) => {
  try {
    const event = await loadEventOrThrow(req.params.id!);
    if (event.status !== 'SCHEDULED') {
      throw new AppError('CONFLICT', 'This LIVE event is no longer scheduled');
    }

    await prisma.liveEventReminder.upsert({
      where: { liveEventId_userId: { liveEventId: event.id, userId: req.user!.id } },
      create: { liveEventId: event.id, userId: req.user!.id },
      update: {},
    });

    res.status(201).json({ liveEventId: event.id, reminded: true });
  } catch (error) {
    next(error);
  }
});

liveEventsRouter.delete('/live/events/:id/remind', requireAuth, async (req, res, next) => {
  try {
    await loadEventOrThrow(req.params.id!);
    await prisma.liveEventReminder.deleteMany({
      where: { liveEventId: req.params.id!, userId: req.user!.id },
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
