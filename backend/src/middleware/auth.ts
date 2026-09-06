import type { NextFunction, Request, Response } from 'express';
import type { UserStatus } from '@prisma/client';

import { verifyAccessToken } from '@/lib/tokens';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  status: UserStatus;
  ageVerified: boolean;
  createdAt: Date;
  isAdmin: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
    sessionId?: string;
  }
}

function extractBearerToken(req: Request): string {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AppError('UNAUTHORIZED', 'Missing or malformed Authorization header');
  }
  return header.slice('Bearer '.length).trim();
}

export interface ResolvedAuth {
  user: AuthenticatedUser;
  sessionId: string;
}

/**
 * The one place an access token is turned into "this is who's making the
 * request, and their session/account are still valid" — shared by
 * `requireAuth` (HTTP) and the realtime layer's socket handshake (Step 5,
 * see lib/realtime.ts) so a suspension/ban takes effect identically on both
 * transports instead of two auth checks drifting apart.
 *
 * Verifies the access token AND that its session is still live (not revoked,
 * not expired). This costs an extra query per request compared to a purely
 * stateless JWT check, but it's what makes logout and admin suspension take
 * effect immediately instead of waiting out the access token's TTL.
 */
export async function resolveAuth(token: string): Promise<ResolvedAuth> {
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired access token');
  }

  const session = await prisma.session.findUnique({ where: { id: payload.sid } });
  if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt < new Date()) {
    throw new AppError('UNAUTHORIZED', 'Session is no longer valid');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired access token');
  }

  if (user.status !== 'ACTIVE') {
    throw new AppError('FORBIDDEN', `Account is ${user.status.toLowerCase().replace('_', ' ')}`);
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      status: user.status,
      ageVerified: user.ageVerified,
      createdAt: user.createdAt,
      isAdmin: user.isAdmin,
    },
    sessionId: session.id,
  };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req);
    const { user, sessionId } = await resolveAuth(token);
    req.user = user;
    req.sessionId = sessionId;
    next();
  } catch (error) {
    next(error);
  }
}
