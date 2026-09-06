import type { ActivityType, Prisma, PrismaClient } from '@prisma/client';

import { emitToUser } from '@/lib/realtime';

type Tx = PrismaClient | Prisma.TransactionClient;

interface RecordActivityParams {
  recipientId: string;
  actorId: string;
  type: ActivityType;
  videoId?: string;
  commentId?: string;
}

/**
 * The persisted, paginated Activity tab (brief O) — distinct from
 * lib/notifications.ts's ephemeral `NotificationDispatcher` (messages/calls
 * only). Never records self-activity (liking/commenting/following/
 * mentioning yourself doesn't notify you), and pushes a lightweight
 * `activity:new` realtime event so an open app can bump its unread badge
 * without polling — the realtime push is purely additive, the database row
 * is always the source of truth (same posture as Step 5's messaging).
 */
export async function recordActivity(tx: Tx, params: RecordActivityParams): Promise<void> {
  const { recipientId, actorId, type, videoId, commentId } = params;
  if (recipientId === actorId) return;

  const activity = await tx.activityNotification.create({
    data: { recipientId, actorId, type, videoId, commentId },
  });
  emitToUser(recipientId, 'activity:new', { id: activity.id, type, actorId, videoId, commentId });
}
