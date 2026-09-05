import { Router } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { upsertProfileSchema } from '@/schemas/profile.schema';
import { AppError } from '@/utils/AppError';

export const profileRouter = Router();

function serializeProfile(profile: {
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  country: string | null;
  city: string | null;
}) {
  return {
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    country: profile.country,
    city: profile.city,
  };
}

profileRouter.get('/profile', requireAuth, async (req, res, next) => {
  try {
    // req.user.id is the only source of "whose profile" — there is no
    // route parameter, so a user can never read/write another user's
    // profile through this endpoint.
    const profile = await prisma.profile.findUnique({ where: { userId: req.user!.id } });
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Profile has not been created yet');
    }
    res.status(200).json(serializeProfile(profile));
  } catch (error) {
    next(error);
  }
});

profileRouter.put('/profile', requireAuth, validate({ body: upsertProfileSchema }), async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { username, displayName, bio, avatarUrl, country, city } = req.body;

    const profile = await prisma.profile.upsert({
      where: { userId },
      create: { userId, username, displayName, bio, avatarUrl, country, city },
      update: { username, displayName, bio, avatarUrl, country, city },
    });

    res.status(200).json(serializeProfile(profile));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('CONFLICT', 'Username is already taken'));
      return;
    }
    next(error);
  }
});
