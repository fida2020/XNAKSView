import { randomUUID } from 'crypto';

import { Router } from 'express';

import { GAMIFICATION_CONFIG_KEYS, getDefaultGamificationConfig, getGamificationConfig, setGamificationConfig } from '@/lib/gamification/config';
import { computeLeaderboard } from '@/lib/gamification/leaderboards';
import { recordXP } from '@/lib/gamification/xpEngine';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { requireAdmin } from '@/middleware/requireAdmin';
import { validate } from '@/middleware/validate';
import {
  adminXpAdjustmentSchema,
  createAchievementSchema,
  createBadgeSchema,
  gamificationConfigKeySchema,
  listQuerySchema,
  recomputeLeaderboardSchema,
  setGamificationConfigBodySchema,
  setGamificationConfigParamsSchema,
  updateAchievementSchema,
  updateBadgeSchema,
} from '@/schemas/gamification.schema';
import { AppError } from '@/utils/AppError';

/**
 * Admin surface for Step 11 — badge/achievement catalog, gamification
 * config (versioned, never edited in place — see config.ts), leaderboard
 * recompute, XP bonus grants, and read-only visibility into fraud-excluded
 * events. Routine gamification (XP, level-ups, badge/achievement unlocks)
 * is fully automated end-to-end (see lib/gamification/events.ts) — nothing
 * here is required for normal operation, same posture as
 * adminTrustSafetyRouter's own doc comment.
 */
export const adminGamificationRouter = Router();
adminGamificationRouter.use(requireAuth, requireAdmin);

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
// Configuration — every current value + its default, and the full version
// history for that key (see config.ts's "never edited in place" doc comment).
// ---------------------------------------------------------------------------

adminGamificationRouter.get('/admin/gamification/config', async (_req, res, next) => {
  try {
    const entries = await Promise.all(
      GAMIFICATION_CONFIG_KEYS.map(async (key) => ({
        key,
        value: await getGamificationConfig(key),
        default: getDefaultGamificationConfig(key),
      })),
    );
    res.status(200).json({ config: entries });
  } catch (error) {
    next(error);
  }
});

adminGamificationRouter.get('/admin/gamification/config/:key/history', validate({ params: setGamificationConfigParamsSchema, query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const rows = await prisma.gamificationConfig.findMany({
      where: { key: req.params.key as never, ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(rows, limit);
    res.status(200).json({ history: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

adminGamificationRouter.put(
  '/admin/gamification/config/:key',
  validate({ params: setGamificationConfigParamsSchema, body: setGamificationConfigBodySchema }),
  async (req, res, next) => {
    try {
      const key = gamificationConfigKeySchema.parse(req.params.key);
      await setGamificationConfig(key, req.body.value as never, req.user!.id);
      await prisma.gamificationAuditLog.create({
        data: { actorId: req.user!.id, action: 'CONFIG_UPDATED', entityType: 'GamificationConfig', entityId: key, metadata: req.body.value },
      });
      res.status(201).json({ key, value: req.body.value });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Badge catalog
// ---------------------------------------------------------------------------

adminGamificationRouter.get('/admin/gamification/badges', async (_req, res, next) => {
  try {
    const badges = await prisma.badge.findMany({ orderBy: { sortOrder: 'asc' } });
    res.status(200).json({ badges });
  } catch (error) {
    next(error);
  }
});

adminGamificationRouter.post('/admin/gamification/badges', validate({ body: createBadgeSchema }), async (req, res, next) => {
  try {
    const badge = await prisma.badge.create({ data: req.body });
    await prisma.gamificationAuditLog.create({ data: { actorId: req.user!.id, action: 'BADGE_CREATED', entityType: 'Badge', entityId: badge.id } });
    res.status(201).json(badge);
  } catch (error) {
    next(error);
  }
});

adminGamificationRouter.patch('/admin/gamification/badges/:id', validate({ body: updateBadgeSchema }), async (req, res, next) => {
  try {
    const badge = await prisma.badge.update({ where: { id: req.params.id }, data: req.body });
    await prisma.gamificationAuditLog.create({ data: { actorId: req.user!.id, action: 'BADGE_UPDATED', entityType: 'Badge', entityId: badge.id, metadata: req.body } });
    res.status(200).json(badge);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Achievement catalog
// ---------------------------------------------------------------------------

adminGamificationRouter.get('/admin/gamification/achievements', async (_req, res, next) => {
  try {
    const achievements = await prisma.achievement.findMany({ orderBy: { sortOrder: 'asc' } });
    res.status(200).json({ achievements });
  } catch (error) {
    next(error);
  }
});

adminGamificationRouter.post('/admin/gamification/achievements', validate({ body: createAchievementSchema }), async (req, res, next) => {
  try {
    const achievement = await prisma.achievement.create({ data: req.body });
    await prisma.gamificationAuditLog.create({ data: { actorId: req.user!.id, action: 'ACHIEVEMENT_CREATED', entityType: 'Achievement', entityId: achievement.id } });
    res.status(201).json(achievement);
  } catch (error) {
    next(error);
  }
});

adminGamificationRouter.patch('/admin/gamification/achievements/:id', validate({ body: updateAchievementSchema }), async (req, res, next) => {
  try {
    const achievement = await prisma.achievement.update({ where: { id: req.params.id }, data: req.body });
    await prisma.gamificationAuditLog.create({ data: { actorId: req.user!.id, action: 'ACHIEVEMENT_UPDATED', entityType: 'Achievement', entityId: achievement.id, metadata: req.body } });
    res.status(200).json(achievement);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

adminGamificationRouter.post('/admin/gamification/leaderboards/recompute', validate({ body: recomputeLeaderboardSchema }), async (req, res, next) => {
  try {
    const snapshot = await computeLeaderboard(req.body.type, req.body.period, req.body.scopeId ?? '');
    res.status(200).json(snapshot);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// XP bonus grants (positive-only — see adminXpAdjustmentSchema's doc comment)
// ---------------------------------------------------------------------------

adminGamificationRouter.post('/admin/gamification/xp-adjustments', validate({ body: adminXpAdjustmentSchema }), async (req, res, next) => {
  try {
    const result = await recordXP({
      ledger: req.body.ledger,
      userId: req.body.userId,
      sourceType: 'ADMIN_ADJUSTMENT',
      sourceRefId: randomUUID(),
      amount: req.body.amount,
      metadata: { reason: req.body.reason, grantedById: req.user!.id },
    });
    await prisma.gamificationAuditLog.create({
      data: { actorId: req.user!.id, action: 'XP_BONUS_GRANTED', entityType: 'User', entityId: req.body.userId, metadata: req.body },
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Anti-abuse visibility — fraud-excluded events, read-only (clearing a
// FraudHold stays the existing Step 9/10 admin route, not duplicated here).
// ---------------------------------------------------------------------------

adminGamificationRouter.get('/admin/gamification/excluded-xp-events', validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const events = await prisma.xPEvent.findMany({
      where: { excludedAsFraud: true, ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(events, limit);
    res.status(200).json({ excludedEvents: page, nextCursor });
  } catch (error) {
    next(error);
  }
});

adminGamificationRouter.get('/admin/gamification/audit-logs', validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
    const logs = await prisma.gamificationAuditLog.findMany({
      where: cursorWhere(cursor),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const { page, nextCursor } = paginate(logs, limit);
    res.status(200).json({ auditLogs: page, nextCursor });
  } catch (error) {
    next(error);
  }
});
