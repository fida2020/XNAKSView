import { Router } from 'express';

import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { serializeVideo } from '@/lib/videoAccess';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { adminListReportsQuerySchema, adminListVideosQuerySchema } from '@/schemas/admin.schema';
import { AppError } from '@/utils/AppError';

export const adminRouter = Router();

// NOTE: there is no admin role/permission concept in the schema yet (see
// docs/STEP2_PROGRESS.md and docs/STEP3_PROGRESS.md) — these endpoints are
// gated by `requireAuth` only, same as every other authenticated endpoint.
// They exist to inspect content (read-only), not to moderate it; role-based
// access control is real future work, not simulated here.

adminRouter.get(
  '/admin/videos',
  requireAuth,
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

adminRouter.get('/admin/videos/:id', requireAuth, async (req, res, next) => {
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
  requireAuth,
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

adminRouter.get('/admin/reports/:id', requireAuth, async (req, res, next) => {
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
