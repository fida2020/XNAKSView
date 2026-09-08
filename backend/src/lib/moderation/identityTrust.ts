import { createHmac } from 'crypto';

import { Prisma } from '@prisma/client';

import { env } from '@/config/env';
import { prisma } from '@/lib/prisma';

/**
 * "One verified identity = one account" (locked XNAKView rule, brief §6).
 * Never stores the raw document/national-ID number — `providerReferenceId`
 * is the KYC provider's OWN reference for the verified identity (already
 * the least-sensitive real identifier Step 9's `IdentityVerificationProvider`
 * exposes), turned into a one-way HMAC so XNAKView itself never holds
 * anything resembling the underlying document data.
 */

function getSecret(): string {
  return env.IDENTITY_FINGERPRINT_SECRET ?? env.JWT_ACCESS_SECRET;
}

export function computeIdentityFingerprint(provider: string, providerReferenceId: string): string {
  return createHmac('sha256', getSecret()).update(`${provider}:${providerReferenceId}`).digest('hex');
}

export type IdentityTrustCheckResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Called once a `Verification` transitions to APPROVED (see
 * `routes/v1/payoutWebhooks.ts`'s IDENTITY_VERIFIED handler). Blocks a
 * second account from verifying with the SAME real-world identity, and
 * specifically blocks any account from reusing an identity that belongs to
 * a permanently banned account (ban-evasion prevention) — never a blind
 * keyword/name match, this is keyed off the KYC provider's own resolved
 * identity.
 */
export async function registerVerifiedIdentity(userId: string, provider: string, providerReferenceId: string): Promise<IdentityTrustCheckResult> {
  const identityFingerprintHash = computeIdentityFingerprint(provider, providerReferenceId);

  const existing = await prisma.identityTrustSignal.findUnique({ where: { identityFingerprintHash } });
  if (existing && existing.userId !== userId) {
    if (existing.status === 'REVOKED_BANNED') {
      return { allowed: false, reason: 'This identity is associated with a permanently banned XNAKView account and cannot verify a new one' };
    }
    return { allowed: false, reason: 'This identity is already linked to another XNAKView account' };
  }

  try {
    await prisma.identityTrustSignal.upsert({
      where: { userId },
      create: { userId, identityFingerprintHash, verificationProvider: provider },
      update: { identityFingerprintHash, verificationProvider: provider, status: 'ACTIVE', revokedAt: null },
    });
  } catch (error) {
    // A genuine (rare) race: two different accounts resolved to the SAME
    // identity fingerprint concurrently and both passed the check above
    // before either committed — the DB's own unique constraint is the
    // final backstop, surfaced as the same honest refusal rather than a
    // raw constraint-violation error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { allowed: false, reason: 'This identity is already linked to another XNAKView account' };
    }
    throw error;
  }

  return { allowed: true };
}

/** Read-only check used by suspicious-signup/ban-evasion risk assessment (fraudRiskEngine.ts) — never blocks by itself, only informs a risk score. */
export async function findIdentityTrustSignal(userId: string) {
  return prisma.identityTrustSignal.findUnique({ where: { userId } });
}
