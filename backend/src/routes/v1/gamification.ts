import type { LeaderboardPeriod, LeaderboardType } from '@prisma/client';
import { Router } from 'express';

import { getFanClubView, joinFanClub, leaveFanClub } from '@/lib/gamification/fanClub';
import { getLeaderboard } from '@/lib/gamification/leaderboards';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import { fanClubParamsSchema, leaderboardQuerySchema, listQuerySchema } from '@/schemas/gamification.schema';
import { AppError } from '@/utils/AppError';

/**
 * User-facing Step 11 endpoints — Levels, badges, achievements, streaks,
 * Fan Club, notifications, global leaderboards. Team management lives in
 * `routes/v1/teams.ts`; admin configuration lives in
 * `routes/v1/adminGamification.ts`.
 */
export const gamificationRouter = Router();

const fanClubActionLimiter = createAuthRateLimiter(60 * 1000, 10, 'fan-club-action');

function cursorWhere(cursor: string | undefined) {
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) throw new AppError('BAD_REQUEST', 'Invalid cursor');
  return decoded ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] } : {};
}

function paginate<T extends { id: string; createdAt: Date }>(items: T[], limit: number) {
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { page, nextCursor };
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

gamificationRouter.get('/gamification/level', requireAuth, async (req, res, next) => {
  try {
    const level = await prisma.userLevel.findUnique({ where: { userId: req.user!.id } });
    res.status(200).json(
      level ?? { userId: req.user!.id, currentLevel: 1, currentXP: 0, lifetimeXP: 0, nextLevelXP: 100 },
    );
  } catch (error) {
    next(error);
  }
});

gamificationRouter.get('/gamification/creator-level', requireAuth, async (req, res, next) => {
  try {
    const level = await prisma.creatorLevel.findUnique({ where: { userId: req.user!.id } });
    res.status(200).json(
      level ?? { userId: req.user!.id, currentLevel: 1, currentXP: 0, lifetimeXP: 0, nextLevelXP: 150 },
    );
  } catch (error) {
    next(error);
  }
});

gamificationRouter.get('/gamification/level-history', requireAuth, validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const events = await prisma.levelUpEvent.findMany({
      where: { userId: req.user!.id, ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(events, limit);
    res.status(200).json({ levelUps: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Badges & achievements
// ---------------------------------------------------------------------------

gamificationRouter.get('/gamification/badges', requireAuth, async (req, res, next) => {
  try {
    const earned = await prisma.userBadge.findMany({
      where: { userId: req.user!.id },
      include: { badge: true },
      orderBy: { earnedAt: 'desc' },
    });
    res.status(200).json({
      badges: earned.map((ub) => ({
        id: ub.badge.id,
        slug: ub.badge.slug,
        name: ub.badge.name,
        description: ub.badge.description,
        iconKey: ub.badge.iconKey,
        category: ub.badge.category,
        earnedAt: ub.earnedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

gamificationRouter.get('/gamification/achievements', requireAuth, async (req, res, next) => {
  try {
    const [achievements, progress] = await Promise.all([
      prisma.achievement.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.userAchievement.findMany({ where: { userId: req.user!.id } }),
    ]);
    const byAchievementId = new Map(progress.map((p) => [p.achievementId, p]));

    res.status(200).json({
      achievements: achievements.map((a) => {
        const p = byAchievementId.get(a.id);
        return {
          id: a.id,
          slug: a.slug,
          name: a.name,
          description: a.description,
          category: a.category,
          xpReward: a.xpReward,
          progressValue: p?.progressValue ?? 0,
          unlockedAt: p?.unlockedAt ?? null,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

gamificationRouter.get('/gamification/streaks', requireAuth, async (req, res, next) => {
  try {
    const streaks = await prisma.streak.findMany({ where: { userId: req.user!.id } });
    res.status(200).json({ streaks });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Fan Club
// ---------------------------------------------------------------------------

gamificationRouter.get('/gamification/fan-clubs/:creatorId', requireAuth, validate({ params: fanClubParamsSchema }), async (req, res, next) => {
  try {
    const view = await getFanClubView(req.params.creatorId!, req.user!.id);
    if (!view) {
      res.status(200).json({ exists: false });
      return;
    }
    res.status(200).json({ exists: true, ...view });
  } catch (error) {
    next(error);
  }
});

gamificationRouter.post(
  '/gamification/fan-clubs/:creatorId/join',
  requireAuth,
  fanClubActionLimiter,
  validate({ params: fanClubParamsSchema }),
  async (req, res, next) => {
    try {
      await joinFanClub(req.user!.id, req.params.creatorId!);
      res.status(200).json({ joined: true });
    } catch (error) {
      next(error);
    }
  },
);

gamificationRouter.post(
  '/gamification/fan-clubs/:creatorId/leave',
  requireAuth,
  fanClubActionLimiter,
  validate({ params: fanClubParamsSchema }),
  async (req, res, next) => {
    try {
      await leaveFanClub(req.user!.id, req.params.creatorId!);
      res.status(200).json({ joined: false });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Leaderboards (global — never exposes a suspended/fraud-excluded subject,
// see leaderboards.ts's own exclusion logic)
// ---------------------------------------------------------------------------

gamificationRouter.get('/gamification/leaderboards', requireAuth, validate({ query: leaderboardQuerySchema }), async (req, res, next) => {
  try {
    const { type, period, scopeId } = req.query as unknown as { type: LeaderboardType; period: LeaderboardPeriod; scopeId?: string };
    if (type === 'FAN_CLUB_XP' && !scopeId) {
      throw new AppError('BAD_REQUEST', 'scopeId (a Fan Club id) is required for the FAN_CLUB_XP leaderboard');
    }
    const { snapshot, entries } = await getLeaderboard(type, period, scopeId ?? '');
    res.status(200).json({
      type: snapshot.type,
      period: snapshot.period,
      periodKey: snapshot.periodKey,
      computedAt: snapshot.computedAt,
      entries: entries.map((e) => ({ subjectId: e.subjectId, rank: e.rank, score: e.score.toString() })),
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Gamification notifications
// ---------------------------------------------------------------------------

gamificationRouter.get('/gamification/notifications', requireAuth, validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const notifications = await prisma.gamificationNotification.findMany({
      where: { userId: req.user!.id, ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(notifications, limit);
    res.status(200).json({ notifications: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

gamificationRouter.post('/gamification/notifications/:id/read', requireAuth, async (req, res, next) => {
  try {
    const updated = await prisma.gamificationNotification.updateMany({
      where: { id: req.params.id, userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(200).json({ updated: updated.count > 0 });
  } catch (error) {
    next(error);
  }
});
