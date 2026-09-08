import type { GamificationNotificationType, Prisma, PrismaClient } from '@prisma/client';

import { emitToUser } from '@/lib/realtime';

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Deliberately separate from `recordActivity` (lib/activityFeed.ts) — that
 * model requires a distinct human `actorId` and is scoped to social
 * activity (likes/comments/follows). A "you leveled up" or "badge earned"
 * event is system-generated with no actor, so it gets its own durable,
 * paginated `GamificationNotification` row instead of being force-fit into
 * `ActivityNotification`. Same posture otherwise: the database row is
 * always the source of truth, the realtime push is purely additive.
 */
export async function sendGamificationNotification(
  tx: Tx,
  userId: string,
  type: GamificationNotificationType,
  payload?: Prisma.InputJsonValue,
): Promise<void> {
  const notification = await tx.gamificationNotification.create({ data: { userId, type, payload } });
  emitToUser(userId, 'gamification:notification', { id: notification.id, type, payload: payload ?? null, createdAt: notification.createdAt });
}
