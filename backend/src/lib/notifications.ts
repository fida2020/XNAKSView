import { emitToUser } from '@/lib/realtime';

/**
 * A clean seam between "something happened that a user should be told
 * about" and "how it actually reaches them" — so a real push provider
 * (FCM/APNs) can be added later as a second implementation without callers
 * (routes/v1/messages.ts, routes/v1/calls.ts) changing at all.
 *
 * Today there is exactly one implementation: forwarding onto the realtime
 * gateway (lib/realtime.ts), which only reaches a currently-connected
 * client — there is no background/killed-app delivery yet. That's a real
 * gap, not hidden: see docs/STEP5_PROGRESS.md.
 */
export type NotificationType =
  | 'NEW_MESSAGE'
  | 'MESSAGE_REQUEST'
  | 'INCOMING_VOICE_CALL'
  | 'MISSED_CALL';

export interface NotificationDispatcher {
  notify(userId: string, type: NotificationType, payload: Record<string, unknown>): void;
}

class RealtimeNotificationDispatcher implements NotificationDispatcher {
  notify(userId: string, type: NotificationType, payload: Record<string, unknown>): void {
    emitToUser(userId, `notification:${type}`, payload);
  }
}

export const notificationDispatcher: NotificationDispatcher = new RealtimeNotificationDispatcher();
