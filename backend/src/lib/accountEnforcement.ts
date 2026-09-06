import type { UserStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

const ENFORCEABLE_STATUSES: readonly UserStatus[] = ['ACTIVE', 'SUSPENDED', 'BANNED'];

export interface EnforceAccountStatusInput {
  userId: string;
  status: UserStatus;
  actorId: string;
  reason?: string;
}

/**
 * The single place `User.status` is ever changed for moderation purposes —
 * called directly by the manual admin endpoint today (routes/v1/admin.ts),
 * and the intended call site for an automated abuse-detection system later
 * (see docs/STEP4_PROGRESS.md). Centralizing it here means that future
 * caller doesn't need to know about `statusReason`/`statusUpdatedAt`
 * bookkeeping or re-derive the "can't touch another admin" rule.
 *
 * Enforcement is immediate: `requireAuth` re-reads `status` from the
 * database on every request (not from the JWT), so a banned/suspended
 * user's very next authenticated call is rejected — no token revocation or
 * cache invalidation needed.
 */
export async function enforceAccountStatus({ userId, status, actorId, reason }: EnforceAccountStatusInput) {
  if (!ENFORCEABLE_STATUSES.includes(status)) {
    throw new AppError('BAD_REQUEST', `Cannot set account status to ${status} through this action`);
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    throw new AppError('NOT_FOUND', 'User not found');
  }
  if (target.isAdmin) {
    throw new AppError('FORBIDDEN', 'Cannot change the status of an admin account through this action');
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      status,
      statusReason: reason ?? null,
      statusUpdatedAt: new Date(),
      statusUpdatedById: actorId,
    },
  });
}
