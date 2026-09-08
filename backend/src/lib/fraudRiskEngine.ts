import { prisma } from '@/lib/prisma';

/**
 * In-house, deterministic fraud/risk rules over XNAKView's own ledger data
 * — no external vendor needed or fabricated for this part (unlike
 * KYC/payout, there's no single well-known "the" fraud API to integrate
 * against). Tripping a rule auto-creates a `FraudHold` (`createdById: null`
 * — system-raised, not an admin) which blocks the withdrawal via the
 * existing `checkWithdrawalEligibility` check; CLEARING a hold stays an
 * admin action (a disclosed, deliberate exception — a compliance backstop,
 * not the routine per-withdrawal approval the brief objects to).
 */
export interface RiskAssessmentInput {
  creatorId: string;
  amountMinorUnits: number;
  payoutMethod: { country: string; verifiedAt: Date | null };
  profileCountry: string | null;
}

export interface RiskAssessmentResult {
  blocked: boolean;
  reason?: string;
}

const VELOCITY_WINDOW_HOURS = 24;
const VELOCITY_MAX_REQUESTS = 3;
const AMOUNT_ANOMALY_MULTIPLIER = 3;
const NEW_PAYOUT_METHOD_COOLDOWN_HOURS = 24;

export async function assessWithdrawalRisk(input: RiskAssessmentInput): Promise<RiskAssessmentResult> {
  const now = Date.now();

  const velocityWindowStart = new Date(now - VELOCITY_WINDOW_HOURS * 60 * 60 * 1000);
  const recentWithdrawalCount = await prisma.withdrawal.count({
    where: { creatorId: input.creatorId, createdAt: { gte: velocityWindowStart } },
  });
  if (recentWithdrawalCount >= VELOCITY_MAX_REQUESTS) {
    return { blocked: true, reason: `${recentWithdrawalCount} withdrawal requests in the last ${VELOCITY_WINDOW_HOURS}h (limit ${VELOCITY_MAX_REQUESTS})` };
  }

  if (input.payoutMethod.verifiedAt && now - input.payoutMethod.verifiedAt.getTime() < NEW_PAYOUT_METHOD_COOLDOWN_HOURS * 60 * 60 * 1000) {
    return { blocked: true, reason: `Payout method was verified less than ${NEW_PAYOUT_METHOD_COOLDOWN_HOURS}h ago` };
  }

  if (input.profileCountry && input.profileCountry !== input.payoutMethod.country) {
    return { blocked: true, reason: `Payout method country (${input.payoutMethod.country}) does not match profile country (${input.profileCountry})` };
  }

  const trailingWindowStart = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const wallet = await prisma.creatorEarningsWallet.findUnique({ where: { creatorId: input.creatorId } });
  if (wallet) {
    const trailingCredits = await prisma.creatorEarningsLedgerEntry.aggregate({
      where: { walletId: wallet.id, direction: 'CREDIT', createdAt: { gte: trailingWindowStart } },
      _sum: { amountMinorUnits: true },
    });
    const trailingEarned = trailingCredits._sum.amountMinorUnits ?? 0;
    if (trailingEarned > 0 && input.amountMinorUnits > trailingEarned * AMOUNT_ANOMALY_MULTIPLIER) {
      return { blocked: true, reason: `Withdrawal amount far exceeds trailing 30-day earnings (${input.amountMinorUnits} vs ${trailingEarned})` };
    }
  }

  return { blocked: false };
}

export async function createAutomaticFraudHold(userId: string, reason: string): Promise<void> {
  const existing = await prisma.fraudHold.findFirst({ where: { userId, status: 'ACTIVE' } });
  if (existing) return;
  await prisma.fraudHold.create({ data: { userId, reason, createdById: null } });
}

// ---------------------------------------------------------------------------
// Step 10 — extends (never duplicates) the above: every check here writes a
// persisted `RiskAssessment` row (brief §7: "risk score + reason codes +
// evidence references + recommended action"), whether or not it blocked
// anything, so risk posture is queryable/auditable over time — not just a
// pass/fail return value like `assessWithdrawalRisk` above.
// ---------------------------------------------------------------------------

export interface RiskCheckResult {
  blocked: boolean;
  riskScore: number;
  reasonCodes: string[];
}

async function recordRiskAssessment(params: {
  subjectType: 'USER' | 'ACCOUNT_CREATION' | 'WITHDRAWAL' | 'PAYOUT_METHOD' | 'GIFT_TRANSACTION';
  subjectId: string;
  userId?: string;
  riskScore: number;
  reasonCodes: string[];
  recommendedAction: string;
  blocked: boolean;
}): Promise<void> {
  await prisma.riskAssessment.create({
    data: {
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      userId: params.userId,
      riskScore: Math.min(100, Math.max(0, params.riskScore)),
      reasonCodes: params.reasonCodes,
      recommendedAction: params.recommendedAction,
      blocked: params.blocked,
    },
  });
}

const GIFT_VELOCITY_WINDOW_MINUTES = 10;
const GIFT_VELOCITY_MAX_SENDS = 20;
const COORDINATED_GIFTING_WINDOW_MINUTES = 15;
const COORDINATED_GIFTING_MIN_DISTINCT_SENDERS = 8;

/**
 * Gift-send fraud signals (brief §7: "coordinated gifting", "abnormal gift
 * velocity", "self-gifting attempts"). Self-gifting is already structurally
 * impossible (`giftService.ts`'s `sendGift` rejects `recipientId ===
 * senderId` before this ever runs) — this covers the two signals that
 * genuinely need a risk score rather than a hard structural rule. Velocity
 * is evaluated PER SENDER; coordinated gifting is evaluated PER RECIPIENT
 * (many distinct senders converging on one account in a short window).
 * `blocked` reuses the SAME `FraudHold` Step 9's withdrawal path already
 * checks — one hold, one compliance backstop, not a parallel gift-only one.
 */
export async function assessGiftingRisk(input: { senderId: string; recipientId: string }): Promise<RiskCheckResult> {
  const reasonCodes: string[] = [];
  let riskScore = 0;

  const velocityWindowStart = new Date(Date.now() - GIFT_VELOCITY_WINDOW_MINUTES * 60 * 1000);
  const recentSendCount = await prisma.giftTransaction.count({ where: { senderId: input.senderId, createdAt: { gte: velocityWindowStart } } });
  if (recentSendCount >= GIFT_VELOCITY_MAX_SENDS) {
    riskScore += 60;
    reasonCodes.push(`GIFT_VELOCITY_EXCEEDED:${recentSendCount}_in_${GIFT_VELOCITY_WINDOW_MINUTES}m`);
  }

  const coordinatedWindowStart = new Date(Date.now() - COORDINATED_GIFTING_WINDOW_MINUTES * 60 * 1000);
  const recentSendersToRecipient = await prisma.giftTransaction.findMany({
    where: { recipientId: input.recipientId, createdAt: { gte: coordinatedWindowStart } },
    select: { senderId: true },
    distinct: ['senderId'],
  });
  if (recentSendersToRecipient.length >= COORDINATED_GIFTING_MIN_DISTINCT_SENDERS) {
    riskScore += 40;
    reasonCodes.push(`COORDINATED_GIFTING_SUSPECTED:${recentSendersToRecipient.length}_distinct_senders_in_${COORDINATED_GIFTING_WINDOW_MINUTES}m`);
  }

  const activeFraudHold = await prisma.fraudHold.findFirst({ where: { userId: input.senderId, status: 'ACTIVE' } });
  if (activeFraudHold) reasonCodes.push('ACTIVE_FRAUD_HOLD');
  const blocked = Boolean(activeFraudHold);

  await recordRiskAssessment({
    subjectType: 'GIFT_TRANSACTION',
    subjectId: `${input.senderId}->${input.recipientId}`,
    userId: input.senderId,
    riskScore,
    reasonCodes,
    recommendedAction: blocked ? 'BLOCK' : reasonCodes.length ? 'HOLD_FOR_REVIEW' : 'ALLOW',
    blocked,
  });

  return { blocked, riskScore, reasonCodes };
}

const ACCOUNT_CREATION_WINDOW_MINUTES = 60;
const ACCOUNT_CREATION_MAX_PER_IP = 5;

/**
 * Rapid-account-creation signal (brief §7). Deliberately INFORMATIONAL only
 * (`blocked` is always false) — an IP alone (shared NAT, campus/office
 * networks, mobile carriers) is too weak a signal to block real users on
 * without a device-fingerprint layer this codebase doesn't have yet (a
 * disclosed limitation — see the Step 10 completion report). Still
 * produces a real, queryable `RiskAssessment` an admin can act on.
 */
export async function assessAccountCreationRisk(ipAddress: string | null): Promise<RiskCheckResult> {
  if (!ipAddress) return { blocked: false, riskScore: 0, reasonCodes: [] };

  const windowStart = new Date(Date.now() - ACCOUNT_CREATION_WINDOW_MINUTES * 60 * 1000);
  const recentCount = await prisma.riskAssessment.count({ where: { subjectType: 'ACCOUNT_CREATION', subjectId: ipAddress, createdAt: { gte: windowStart } } });

  const reasonCodes: string[] = [];
  let riskScore = 0;
  if (recentCount >= ACCOUNT_CREATION_MAX_PER_IP) {
    riskScore = 50;
    reasonCodes.push(`RAPID_ACCOUNT_CREATION:${recentCount + 1}_from_same_ip_in_${ACCOUNT_CREATION_WINDOW_MINUTES}m`);
  }

  await recordRiskAssessment({
    subjectType: 'ACCOUNT_CREATION',
    subjectId: ipAddress,
    riskScore,
    reasonCodes,
    recommendedAction: reasonCodes.length ? 'HOLD_FOR_REVIEW' : 'ALLOW',
    blocked: false,
  });

  return { blocked: false, riskScore, reasonCodes };
}
