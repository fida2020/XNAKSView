import { Router } from 'express';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { updateMessagingSettingsSchema } from '@/schemas/messaging.schema';

export const messagingSettingsRouter = Router();

function serialize(settings: { whoCanMessage: string; showActivityStatus: boolean } | null) {
  return {
    whoCanMessage: settings?.whoCanMessage ?? 'MUTUAL_FOLLOWERS',
    showActivityStatus: settings?.showActivityStatus ?? true,
  };
}

messagingSettingsRouter.get('/me/messaging-settings', requireAuth, async (req, res, next) => {
  try {
    const settings = await prisma.messagingPrivacySettings.findUnique({ where: { userId: req.user!.id } });
    res.status(200).json(serialize(settings));
  } catch (error) {
    next(error);
  }
});

messagingSettingsRouter.patch(
  '/me/messaging-settings',
  requireAuth,
  validate({ body: updateMessagingSettingsSchema }),
  async (req, res, next) => {
    try {
      const settings = await prisma.messagingPrivacySettings.upsert({
        where: { userId: req.user!.id },
        create: {
          userId: req.user!.id,
          whoCanMessage: req.body.whoCanMessage ?? 'MUTUAL_FOLLOWERS',
          showActivityStatus: req.body.showActivityStatus ?? true,
        },
        update: {
          ...(req.body.whoCanMessage !== undefined ? { whoCanMessage: req.body.whoCanMessage } : {}),
          ...(req.body.showActivityStatus !== undefined ? { showActivityStatus: req.body.showActivityStatus } : {}),
        },
      });
      res.status(200).json(serialize(settings));
    } catch (error) {
      next(error);
    }
  },
);
