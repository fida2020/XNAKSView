import type { LiveSession } from '@prisma/client';

import type { AuthorSummary } from '@/lib/videoAccess';

interface SerializeLiveSessionExtras {
  host?: AuthorSummary;
  isOwnSession?: boolean;
}

export function serializeLiveSession(liveSession: LiveSession, extras: SerializeLiveSessionExtras = {}) {
  return {
    id: liveSession.id,
    hostId: liveSession.hostId,
    host: extras.host,
    title: liveSession.title,
    category: liveSession.category,
    thumbnailUrl: liveSession.thumbnailKey ? `/api/v1/live/${liveSession.id}/thumbnail` : null,
    status: liveSession.status,
    viewerCount: liveSession.viewerCount,
    peakViewerCount: liveSession.peakViewerCount,
    isOwnSession: extras.isOwnSession,
    maxGuestSlots: liveSession.maxGuestSlots,
    subscriberOnlyChat: liveSession.subscriberOnlyChat,
    replayEnabled: liveSession.replayEnabled,
    replayStatus: liveSession.replayStatus,
    startedAt: liveSession.startedAt,
    endedAt: liveSession.endedAt,
  };
}
