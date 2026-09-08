import { prisma } from '@/lib/prisma';
import type { MonetizationStatus } from '@prisma/client';

export interface EligibilityRuleSnapshot {
  id: string | null;
  minFollowers: number;
  minLifetimeVideoViews: number;
  minAccountAgeDays: number;
  requireGoodStanding: boolean;
  allowedRegions: string[];
}

/** No admin-configured rule yet = nobody can qualify — a safe default that never fabricates a requirement XNAKView hasn't actually set. */
const UNCONFIGURED_RULE: EligibilityRuleSnapshot = {
  id: null,
  minFollowers: Number.MAX_SAFE_INTEGER,
  minLifetimeVideoViews: Number.MAX_SAFE_INTEGER,
  minAccountAgeDays: Number.MAX_SAFE_INTEGER,
  requireGoodStanding: true,
  allowedRegions: [],
};

/** The currently-active, effective-dated eligibility policy (brief §4 — admin-configurable, never a hard-coded copy of another platform's real requirements). */
export async function getCurrentEligibilityRule(): Promise<EligibilityRuleSnapshot> {
  const now = new Date();
  const rule = await prisma.monetizationEligibilityRule.findFirst({
    where: { active: true, effectiveFrom: { lte: now }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!rule) return UNCONFIGURED_RULE;
  return {
    id: rule.id,
    minFollowers: rule.minFollowers,
    minLifetimeVideoViews: rule.minLifetimeVideoViews,
    minAccountAgeDays: rule.minAccountAgeDays,
    requireGoodStanding: rule.requireGoodStanding,
    allowedRegions: rule.allowedRegions,
  };
}

export interface EligibilityRequirement {
  key: string;
  label: string;
  required: number | string;
  current: number | string;
  met: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  requirements: EligibilityRequirement[];
  rule: EligibilityRuleSnapshot;
}

/**
 * Computes whether a creator satisfies the CURRENT eligibility rule —
 * server-side only, the mobile client never decides this (brief §4). Every
 * number is real: followers/account age come straight from `User`,
 * lifetime views are a fresh SUM over the creator's own PUBLIC READY
 * videos (never a client-supplied or cached count).
 */
export async function evaluateEligibility(creatorId: string): Promise<EligibilityResult> {
  const rule = await getCurrentEligibilityRule();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: creatorId },
    include: { profile: { select: { country: true } } },
  });

  const viewTotal = await prisma.video.aggregate({
    where: { userId: creatorId, status: 'READY', visibility: 'PUBLIC' },
    _sum: { viewCount: true },
  });
  const lifetimeViews = viewTotal._sum.viewCount ?? 0;

  const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000));
  const isGoodStanding = user.status === 'ACTIVE';
  const regionAllowed = rule.allowedRegions.length === 0 || (user.profile?.country != null && rule.allowedRegions.includes(user.profile.country));

  const requirements: EligibilityRequirement[] = [
    { key: 'followers', label: 'Followers', required: rule.minFollowers, current: user.followerCount, met: user.followerCount >= rule.minFollowers },
    { key: 'lifetimeViews', label: 'Lifetime video views', required: rule.minLifetimeVideoViews, current: lifetimeViews, met: lifetimeViews >= rule.minLifetimeVideoViews },
    { key: 'accountAge', label: 'Account age (days)', required: rule.minAccountAgeDays, current: accountAgeDays, met: accountAgeDays >= rule.minAccountAgeDays },
  ];
  if (rule.requireGoodStanding) {
    requirements.push({ key: 'goodStanding', label: 'Account in good standing', required: 'ACTIVE', current: user.status, met: isGoodStanding });
  }
  if (rule.allowedRegions.length > 0) {
    requirements.push({ key: 'region', label: 'Available region', required: rule.allowedRegions.join(', '), current: user.profile?.country ?? 'unknown', met: regionAllowed });
  }

  return { eligible: requirements.every((r) => r.met), requirements, rule };
}

/** Every status a system-driven recompute is allowed to move the record into/out of — anything past ELIGIBLE (PENDING_REVIEW/ACTIVE/SUSPENDED/DISABLED) is an admin decision (brief §5/§12), never silently overwritten by an automatic eligibility recheck. */
const SYSTEM_MANAGED_STATUSES: MonetizationStatus[] = ['NOT_ELIGIBLE', 'ELIGIBLE'];

/**
 * Re-evaluates a creator's eligibility and, ONLY if they're currently in a
 * system-managed status (NOT_ELIGIBLE/ELIGIBLE), flips between those two
 * to match reality. Once an admin has moved a creator into
 * PENDING_REVIEW/ACTIVE/SUSPENDED/DISABLED, this function is a no-op for
 * them — those transitions are exclusively admin-driven.
 */
export async function refreshMonetizationStatus(creatorId: string): Promise<{ status: MonetizationStatus; eligible: boolean }> {
  const existing = await prisma.creatorMonetization.upsert({
    where: { creatorId },
    create: { creatorId, status: 'NOT_ELIGIBLE' },
    update: {},
  });

  if (!SYSTEM_MANAGED_STATUSES.includes(existing.status)) {
    return { status: existing.status, eligible: existing.status === 'ACTIVE' };
  }

  const { eligible } = await evaluateEligibility(creatorId);
  const nextStatus: MonetizationStatus = eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE';

  if (nextStatus !== existing.status) {
    await prisma.creatorMonetization.update({
      where: { creatorId },
      data: { status: nextStatus, statusReason: eligible ? 'Automatically marked eligible' : 'No longer meets eligibility requirements', statusUpdatedAt: new Date(), statusUpdatedById: null },
    });
  }

  return { status: nextStatus, eligible };
}
