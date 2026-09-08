import type { NextFunction, Request, Response } from 'express';
import type { UserStatus } from '@prisma/client';

import { verifyAccessToken } from '@/lib/tokens';
import { tryAutoLiftExpiredRestriction } from '@/lib/moderation/enforcementService';
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
/**
 * Token+session+user resolution WITHOUT the "account must be ACTIVE" gate
 * — used by `resolveAuth` below and by the two Step 10 routes a
 * BANNED/SUSPENDED user must still be able to reach: viewing their own
 * Account Status and submitting an appeal (brief §10's appeal lifecycle
 * would otherwise be unreachable by the very account it exists for). Every
 * other route keeps going through `resolveAuth`/`requireAuth`.
 */
async function resolveAuthAllowingRestricted(token: string): Promise<ResolvedAuth> {
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

  let user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired access token');
  }

  // A Step 10 TEMPORARY_ACCOUNT_RESTRICT self-heals once its own `expiresAt`
  // passes — checked here (the SUSPENDED path only, never on every request)
  // rather than via a cron job. See enforcementService.ts's doc comment.
  if (user.status === 'SUSPENDED' && (await tryAutoLiftExpiredRestriction(user.id))) {
    user = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
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

export async function resolveAuth(token: string): Promise<ResolvedAuth> {
  const resolved = await resolveAuthAllowingRestricted(token);
  if (resolved.user.status !== 'ACTIVE') {
    throw new AppError('FORBIDDEN', `Account is ${resolved.user.status.toLowerCase().replace('_', ' ')}`);
  }
  return resolved;
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

/**
 * Same token/session validation as `requireAuth`, but never rejects a
 * BANNED/SUSPENDED/DELETED account — DELETED is still rejected as
 * "account no longer exists" from the caller's perspective. Use ONLY for
 * the safety-notification surfaces a restricted account must still be able
 * to reach (Account Status, submitting an appeal); every other route must
 * keep using `requireAuth`.
 */
export async function requireAuthAllowRestricted(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req);
    const { user, sessionId } = await resolveAuthAllowingRestricted(token);
    if (user.status === 'DELETED') {
      throw new AppError('FORBIDDEN', 'Account is deleted');
    }
    req.user = user;
    req.sessionId = sessionId;
    next();
  } catch (error) {
    next(error);
  }
}
