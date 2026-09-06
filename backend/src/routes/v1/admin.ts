import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { enforceAccountStatus } from '@/lib/accountEnforcement';
import { serializeLiveSession } from '@/lib/liveAccess';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { serializeVideo } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { requireAdmin } from '@/middleware/requireAdmin';
import { validate } from '@/middleware/validate';
import {
  adminCreateBlockedWordSchema,
  adminEnforceAccountStatusSchema,
  adminListConversationsQuerySchema,
  adminListLiveQuerySchema,
  adminListReportsQuerySchema,
  adminListVideosQuerySchema,
} from '@/schemas/admin.schema';
import { AppError } from '@/utils/AppError';

export const adminRouter = Router();

// Every /admin/* route requires both a valid session (requireAuth) AND the
// isAdmin flag (requireAdmin) — see middleware/requireAdmin.ts for why that
// flag, not a fuller role system, is the right amount of machinery for
// Step 4. Before this, these endpoints were gated by requireAuth only,
// which meant any registered user could read report PII and, worse, mutate
// the LIVE chat keyword filter; that gap is what this line closes.
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get(
  '/admin/videos',
  validate({ query: adminListVideosQuerySchema }),
  async (req, res, next) => {
    try {
      const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      const videos = await prisma.video.findMany({
        where: {
          ...(status ? { status: status as never } : {}),
          ...(decoded
            ? {
                OR: [
                  { createdAt: { lt: new Date(decoded.createdAt) } },
                  { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { user: { select: { id: true, email: true, phone: true } } },
      });

      const hasMore = videos.length > limit;
      const page = hasMore ? videos.slice(0, limit) : videos;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      res.status(200).json({
        videos: page.map((video) => ({
          ...serializeVideo(video),
          owner: { id: video.user.id, email: video.user.email, phone: video.user.phone },
        })),
        nextCursor,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get('/admin/videos/:id', async (req, res, next) => {
  try {
    const video = await prisma.video.findUnique({
      where: { id: req.params.id! },
      include: {
        user: { select: { id: true, email: true, phone: true } },
        reports: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!video) {
      throw new AppError('NOT_FOUND', 'Video not found');
    }

    res.status(200).json({
      ...serializeVideo(video),
      owner: { id: video.user.id, email: video.user.email, phone: video.user.phone },
      reports: video.reports,
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get(
  '/admin/reports',
  validate({ query: adminListReportsQuerySchema }),
  async (req, res, next) => {
    try {
      const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      const reports = await prisma.videoReport.findMany({
        where: {
          ...(status ? { status: status as never } : {}),
          ...(decoded
            ? {
                OR: [
                  { createdAt: { lt: new Date(decoded.createdAt) } },
                  { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          video: { select: { id: true, caption: true, status: true, userId: true } },
          reporter: { select: { id: true, email: true, phone: true } },
        },
      });

      const hasMore = reports.length > limit;
      const page = hasMore ? reports.slice(0, limit) : reports;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      res.status(200).json({ reports: page, nextCursor });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get('/admin/reports/:id', async (req, res, next) => {
  try {
    const report = await prisma.videoReport.findUnique({
      where: { id: req.params.id! },
      include: {
        video: true,
        reporter: { select: { id: true, email: true, phone: true } },
      },
    });
    if (!report) {
      throw new AppError('NOT_FOUND', 'Report not found');
    }

    res.status(200).json({
      ...report,
      video: serializeVideo(report.video),
    });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// LIVE inspection
// -----------------------------------------------------------------------

adminRouter.get(
  '/admin/live',
  validate({ query: adminListLiveQuerySchema }),
  async (req, res, next) => {
    try {
      const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      const liveSessions = await prisma.liveSession.findMany({
        where: {
          ...(status ? { status: status as never } : {}),
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
        include: { host: { select: { id: true, email: true, phone: true } } },
      });

      const hasMore = liveSessions.length > limit;
      const page = hasMore ? liveSessions.slice(0, limit) : liveSessions;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.startedAt.toISOString(), id: last.id }) : null;

      res.status(200).json({
        liveSessions: page.map((session) => ({
          ...serializeLiveSession(session),
          hostAccount: { id: session.host.id, email: session.host.email, phone: session.host.phone },
        })),
        nextCursor,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get('/admin/live/:id', async (req, res, next) => {
  try {
    const liveSession = await prisma.liveSession.findUnique({
      where: { id: req.params.id! },
      include: {
        host: { select: { id: true, email: true, phone: true } },
        reports: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!liveSession) {
      throw new AppError('NOT_FOUND', 'LIVE session not found');
    }

    res.status(200).json({
      ...serializeLiveSession(liveSession),
      hostAccount: { id: liveSession.host.id, email: liveSession.host.email, phone: liveSession.host.phone },
      reports: liveSession.reports,
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get(
  '/admin/live-reports',
  validate({ query: adminListReportsQuerySchema }),
  async (req, res, next) => {
    try {
      const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      const reports = await prisma.liveReport.findMany({
        where: {
          ...(status ? { status: status as never } : {}),
          ...(decoded
            ? {
                OR: [
                  { createdAt: { lt: new Date(decoded.createdAt) } },
                  { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          liveSession: { select: { id: true, title: true, status: true, hostId: true } },
          reporter: { select: { id: true, email: true, phone: true } },
        },
      });

      const hasMore = reports.length > limit;
      const page = hasMore ? reports.slice(0, limit) : reports;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      res.status(200).json({ reports: page, nextCursor });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get('/admin/live-reports/:id', async (req, res, next) => {
  try {
    const report = await prisma.liveReport.findUnique({
      where: { id: req.params.id! },
      include: {
        liveSession: true,
        reporter: { select: { id: true, email: true, phone: true } },
      },
    });
    if (!report) {
      throw new AppError('NOT_FOUND', 'Report not found');
    }

    res.status(200).json({
      ...report,
      liveSession: serializeLiveSession(report.liveSession),
    });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// LIVE chat keyword filter (blocked words) — admin-only configuration.
// -----------------------------------------------------------------------

adminRouter.get('/admin/live-blocked-words', async (_req, res, next) => {
  try {
    const words = await prisma.liveBlockedWord.findMany({ orderBy: { word: 'asc' } });
    res.status(200).json({ words });
  } catch (error) {
    next(error);
  }
});

adminRouter.post(
  '/admin/live-blocked-words',
  validate({ body: adminCreateBlockedWordSchema }),
  async (req, res, next) => {
    try {
      const word = await prisma.liveBlockedWord.create({ data: { word: req.body.word } });
      res.status(201).json(word);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        next(new AppError('CONFLICT', 'This word is already blocked'));
        return;
      }
      next(error);
    }
  },
);

adminRouter.delete('/admin/live-blocked-words/:id', async (req, res, next) => {
  try {
    await prisma.liveBlockedWord.delete({ where: { id: req.params.id! } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// Account enforcement — the manual path for suspending/banning an account.
// This is deliberately the ONLY place `enforceAccountStatus` is called
// today; a future automated abuse-detection system calls the same library
// function (see lib/accountEnforcement.ts), not this route, so both paths
// share one set of rules (e.g. "can't touch an admin account") instead of
// duplicating them.
// -----------------------------------------------------------------------

adminRouter.post(
  '/admin/users/:id/status',
  validate({ body: adminEnforceAccountStatusSchema }),
  async (req, res, next) => {
    try {
      const updated = await enforceAccountStatus({
        userId: req.params.id!,
        status: req.body.status,
        actorId: req.user!.id,
        reason: req.body.reason,
      });

      res.status(200).json({
        id: updated.id,
        status: updated.status,
        statusReason: updated.statusReason,
        statusUpdatedAt: updated.statusUpdatedAt,
        statusUpdatedById: updated.statusUpdatedById,
      });
    } catch (error) {
      next(error);
    }
  },
);

// -----------------------------------------------------------------------
// Chat + calls inspection (Step 5) — same read-only-unless-noted convention
// as the LIVE section above. Conversation *content* (message text/voice) is
// intentionally NOT exposed here beyond what a report already surfaces —
// inspecting a report shows the reported message; browsing a conversation's
// full history is not a Step 5 admin capability.
// -----------------------------------------------------------------------

adminRouter.get(
  '/admin/conversations',
  validate({ query: adminListConversationsQuerySchema }),
  async (req, res, next) => {
    try {
      const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new AppError('BAD_REQUEST', 'Invalid cursor');
      }

      const conversations = await prisma.conversation.findMany({
        where: {
          ...(status ? { status: status as never } : {}),
          ...(decoded
            ? {
                OR: [
                  { createdAt: { lt: new Date(decoded.createdAt) } },
                  { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          participantOne: { select: { id: true, email: true, phone: true } },
          participantTwo: { select: { id: true, email: true, phone: true } },
        },
      });

      const hasMore = conversations.length > limit;
      const page = hasMore ? conversations.slice(0, limit) : conversations;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      res.status(200).json({
        conversations: page.map((c) => ({
          id: c.id,
          status: c.status,
          initiatedById: c.initiatedById,
          lastMessageAt: c.lastMessageAt,
          createdAt: c.createdAt,
          participants: [
            { id: c.participantOne.id, email: c.participantOne.email, phone: c.participantOne.phone },
            { id: c.participantTwo.id, email: c.participantTwo.email, phone: c.participantTwo.phone },
          ],
        })),
        nextCursor,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get('/admin/conversations/:id', async (req, res, next) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id! },
      include: {
        participantOne: { select: { id: true, email: true, phone: true } },
        participantTwo: { select: { id: true, email: true, phone: true } },
        reports: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!conversation) {
      throw new AppError('NOT_FOUND', 'Conversation not found');
    }

    res.status(200).json({
      id: conversation.id,
      status: conversation.status,
      initiatedById: conversation.initiatedById,
      lastMessageAt: conversation.lastMessageAt,
      createdAt: conversation.createdAt,
      participants: [
        { id: conversation.participantOne.id, email: conversation.participantOne.email, phone: conversation.participantOne.phone },
        { id: conversation.participantTwo.id, email: conversation.participantTwo.email, phone: conversation.participantTwo.phone },
      ],
      reports: conversation.reports,
    });
  } catch (error) {
    next(error);
  }
});

function decodeReportCursor(cursor: string | undefined) {
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) {
    throw new AppError('BAD_REQUEST', 'Invalid cursor');
  }
  return decoded;
}

function paginateReports<T extends { id: string; createdAt: Date }>(items: T[], limit: number) {
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { page, nextCursor };
}

adminRouter.get(
  '/admin/message-reports',
  validate({ query: adminListReportsQuerySchema }),
  async (req, res, next) => {
    try {
      const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
      const decoded = decodeReportCursor(cursor);

      const reports = await prisma.messageReport.findMany({
        where: {
          ...(status ? { status: status as never } : {}),
          ...(decoded
            ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          message: { select: { id: true, conversationId: true, senderId: true, type: true, text: true, deletedAt: true } },
          reporter: { select: { id: true, email: true, phone: true } },
        },
      });

      const { page, nextCursor } = paginateReports(reports, limit);
      res.status(200).json({ reports: page, nextCursor });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get(
  '/admin/conversation-reports',
  validate({ query: adminListReportsQuerySchema }),
  async (req, res, next) => {
    try {
      const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
      const decoded = decodeReportCursor(cursor);

      const reports = await prisma.conversationReport.findMany({
        where: {
          ...(status ? { status: status as never } : {}),
          ...(decoded
            ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          conversation: { select: { id: true, status: true, participantOneId: true, participantTwoId: true } },
          reporter: { select: { id: true, email: true, phone: true } },
        },
      });

      const { page, nextCursor } = paginateReports(reports, limit);
      res.status(200).json({ reports: page, nextCursor });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get(
  '/admin/call-reports',
  validate({ query: adminListReportsQuerySchema }),
  async (req, res, next) => {
    try {
      const { cursor, limit, status } = req.query as unknown as { cursor?: string; limit: number; status?: string };
      const decoded = decodeReportCursor(cursor);

      const reports = await prisma.callReport.findMany({
        where: {
          ...(status ? { status: status as never } : {}),
          ...(decoded
            ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          call: { select: { id: true, callerId: true, calleeId: true, type: true, status: true } },
          reporter: { select: { id: true, email: true, phone: true } },
        },
      });

      const { page, nextCursor } = paginateReports(reports, limit);
      res.status(200).json({ reports: page, nextCursor });
    } catch (error) {
      next(error);
    }
  },
);
