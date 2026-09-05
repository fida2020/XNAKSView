import { Router } from 'express';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';

export const meRouter = Router();

meRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      include: { profile: true },
    });

    res.status(200).json({
      id: user.id,
      email: user.email,
      phone: user.phone,
      status: user.status,
      ageVerified: user.ageVerified,
      createdAt: user.createdAt,
      profile: user.profile
        ? {
            username: user.profile.username,
            displayName: user.profile.displayName,
            bio: user.profile.bio,
            avatarUrl: user.profile.avatarUrl,
            country: user.profile.country,
            city: user.profile.city,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});
