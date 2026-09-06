import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

import { env } from '@/config/env';
import { logger } from '@/lib/logger';

export interface GenerateTokenParams {
  roomName: string;
  identity: string;
  displayName?: string;
  canPublish: boolean;
}

/**
 * Everything the rest of the app needs from a real-time streaming engine.
 * LiveKit (self-hosted, open source WebRTC SFU) is the only implementation
 * today — see docs/STEP4_PROGRESS.md for why it was chosen. Swapping to a
 * different provider (or LiveKit Cloud) later means writing one new class
 * implementing this interface; no route or model changes.
 */
export interface LiveStreamingProvider {
  /** Idempotent: creating a room that already exists is not an error. */
  createRoom(roomName: string): Promise<void>;
  /** Idempotent: deleting a room that doesn't exist is not an error. */
  deleteRoom(roomName: string): Promise<void>;
  /** A signed, short-lived token the client uses to connect directly to the media server. */
  generateToken(params: GenerateTokenParams): Promise<string>;
  /** The server's own live count of connected participants — 0 if the room doesn't exist. */
  getParticipantCount(roomName: string): Promise<number>;
  /** The WebSocket URL clients should connect to (never a secret). */
  readonly wsUrl: string;
}

class LiveKitStreamingProvider implements LiveStreamingProvider {
  private readonly roomService: RoomServiceClient;

  readonly wsUrl = env.LIVEKIT_WS_URL;

  constructor() {
    this.roomService = new RoomServiceClient(env.LIVEKIT_HOST, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }

  async createRoom(roomName: string): Promise<void> {
    await this.roomService.createRoom({ name: roomName, emptyTimeout: 5 * 60 });
  }

  async deleteRoom(roomName: string): Promise<void> {
    try {
      await this.roomService.deleteRoom(roomName);
    } catch (error) {
      // LiveKit returns a not-found error for an already-gone room — that's
      // the desired end state, not a failure.
      logger.debug({ err: error, roomName }, 'deleteRoom: room already gone');
    }
  }

  async generateToken({ roomName, identity, displayName, canPublish }: GenerateTokenParams): Promise<string> {
    const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity,
      name: displayName,
      // Short-lived: a viewer/host reconnecting after this expires simply
      // requests a fresh token from our API (which re-checks the LiveSession
      // is still live) rather than holding a long-lived credential.
      ttl: '10m',
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });
    return token.toJwt();
  }

  async getParticipantCount(roomName: string): Promise<number> {
    try {
      const participants = await this.roomService.listParticipants(roomName);
      return participants.length;
    } catch {
      return 0;
    }
  }
}

export const liveStreamingProvider: LiveStreamingProvider = new LiveKitStreamingProvider();

export function liveRoomName(liveSessionId: string): string {
  return `live-${liveSessionId}`;
}
