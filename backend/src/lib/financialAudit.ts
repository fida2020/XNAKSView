import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * Every admin action that changes money-adjacent configuration (a rate, a
 * catalog price, a withdrawal decision, a fraud hold) writes one row here —
 * an append-only audit trail, separate from the ledgers themselves, so
 * "who changed what and when" is answerable without diffing raw table
 * history. Never used to record the financial movements themselves (that's
 * what the CoinLedger/DiamondLedger/EarningsLedger/PlatformRevenueLedger
 * rows are for) — only the administrative decisions around them.
 *
 * Step 9: `actorId: null` records a SYSTEM-triggered decision (the
 * automatic withdrawal pipeline approving/paying/failing a withdrawal,
 * `fraudRiskEngine.ts` raising a hold) — never a fabricated "system user"
 * row, just an honest absence of a human actor.
 */
export async function recordFinancialAudit(params: { actorId: string | null; action: string; entityType: string; entityId: string; metadata?: Prisma.InputJsonValue }): Promise<void> {
  await prisma.financialAuditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata,
    },
  });
}
