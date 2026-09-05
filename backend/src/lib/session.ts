import type { DevicePlatform } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { generateRefreshToken, hashRefreshToken, parseDurationMs, signAccessToken } from '@/lib/tokens';
import { env } from '@/config/env';

export interface DeviceInput {
  deviceIdentifier: string;
  platform: DevicePlatform;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresAt: Date;
}

async function upsertDevice(userId: string, device?: DeviceInput): Promise<string | undefined> {
  if (!device) return undefined;

  const record = await prisma.device.upsert({
    where: {
      userId_deviceIdentifier: {
        userId,
        deviceIdentifier: device.deviceIdentifier,
      },
    },
    create: {
      userId,
      deviceIdentifier: device.deviceIdentifier,
      platform: device.platform,
    },
    update: {
      platform: device.platform,
      lastSeenAt: new Date(),
    },
  });

  return record.id;
}

/** Creates a new session (and access/refresh token pair) for a user, optionally tying it to a device. */
export async function issueSession(userId: string, device?: DeviceInput): Promise<IssuedTokens> {
  const deviceId = await upsertDevice(userId, device);

  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_TTL));

  const session = await prisma.session.create({
    data: {
      userId,
      deviceId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiresAt,
    },
  });

  const accessToken = signAccessToken({ sub: userId, sid: session.id });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: env.JWT_ACCESS_TTL,
    refreshTokenExpiresAt,
  };
}

/** Rotates a valid, unrevoked session: revokes it and issues a fresh session carrying the same device link. */
export async function rotateSession(sessionId: string): Promise<IssuedTokens> {
  const current = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });

  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });

  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_TTL));

  const next = await prisma.session.create({
    data: {
      userId: current.userId,
      deviceId: current.deviceId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiresAt,
    },
  });

  const accessToken = signAccessToken({ sub: current.userId, sid: next.id });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: env.JWT_ACCESS_TTL,
    refreshTokenExpiresAt,
  };
}
