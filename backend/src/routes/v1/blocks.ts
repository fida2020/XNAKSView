import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { isOnline } from '@/lib/realtime';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { createAuthRateLimiter } from '@/middleware/rateLimit';
import { AppError } from '@/utils/AppError';

export const blocksRouter = Router();

const blockLimiter = createAuthRateLimiter(60 * 1000, 30, 'user-block');

blocksRouter.post('/users/:id/block', requireAuth, blockLimiter, async (req, res, next) => {
  try {
    const blockedId = req.params.id!;
    if (blockedId === req.user!.id) {
      throw new AppError('BAD_REQUEST', 'You cannot block yourself');
    }
    const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!target) {
      throw new AppError('NOT_FOUND', 'User not found');
    }

    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: req.user!.id, blockedId } },
      create: { blockerId: req.user!.id, blockedId },
      update: {},
    });

    res.status(201).json({ blockedId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(201).json({ blockedId: req.params.id });
      return;
    }
    next(error);
  }
});

blocksRouter.delete('/users/:id/block', requireAuth, blockLimiter, async (req, res, next) => {
  try {
    await prisma.userBlock.deleteMany({ where: { blockerId: req.user!.id, blockedId: req.params.id! } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// `/me/...`, not `/users/blocked` — avoids ever colliding with another
// router's `/users/:id` pattern regardless of mount order (see
// routes/v1/index.ts for the LIVE routers' version of this same problem).
blocksRouter.get('/me/blocked-users', requireAuth, async (req, res, next) => {
  try {
    const blocks = await prisma.userBlock.findMany({
      where: { blockerId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: { blocked: { select: { id: true, profile: { select: { username: true, displayName: true, avatarUrl: true } } } } },
    });
    res.status(200).json({
      users: blocks.map((b) => ({
        id: b.blocked.id,
        username: b.blocked.profile?.username ?? null,
        displayName: b.blocked.profile?.displayName ?? null,
        avatarUrl: b.blocked.profile?.avatarUrl ?? null,
        blockedAt: b.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * A user's own live/last-active status — respects the *target's* privacy
 * setting, and returns a flat "unknown" (never an error) for a blocked
 * relationship in either direction, matching the rule that a block or
 * privacy setting must not be distinguishable from "this user just has
 * presence hidden."
 */
blocksRouter.get('/users/:id/presence', requireAuth, async (req, res, next) => {
  try {
    const targetId = req.params.id!;
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, lastActiveAt: true } });
    if (!target) {
      throw new AppError('NOT_FOUND', 'User not found');
    }

    const blocked = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: req.user!.id, blockedId: targetId },
          { blockerId: targetId, blockedId: req.user!.id },
        ],
      },
    });
    const settings = await prisma.messagingPrivacySettings.findUnique({ where: { userId: targetId } });
    const showActivity = !blocked && (settings?.showActivityStatus ?? true);

    res.status(200).json({
      online: showActivity ? await isOnline(targetId) : false,
      lastActiveAt: showActivity ? (target.lastActiveAt?.toISOString() ?? null) : null,
    });
  } catch (error) {
    next(error);
  }
});
