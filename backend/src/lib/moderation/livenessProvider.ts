import { randomUUID } from 'crypto';

import { isTest } from '@/config/env';
import type { LivenessCheckOutcome, LivenessProvider, ProviderResult } from '@/lib/moderation/types';

/**
 * Real selfie-liveness vendors (e.g. a dedicated liveness-check product,
 * or a liveness add-on from a KYC vendor) are NOT wired up in this
 * codebase — no credentials for one exist in this environment. Kept as its
 * own interface, separate from Step 9's `IdentityVerificationProvider`,
 * because a real integration may run liveness as an independent step
 * (before or alongside document KYC) via a different vendor product. See
 * the Step 10 completion report's "identity/liveness/duplicate-account
 * status" section.
 */
class UnconfiguredLivenessProvider implements LivenessProvider {
  readonly name = 'NONE';

  isConfigured(): boolean {
    return false;
  }

  async checkLiveness(): Promise<ProviderResult<{ outcome: LivenessCheckOutcome }>> {
    return { configured: false, reason: 'Liveness verification is not configured on this server — no liveness vendor is set up' };
  }
}

/** Deterministic test double. `selfieImageUrl` containing "SIMULATE_FAIL_LIVENESS" -> FAILED; anything else -> PASSED. */
class MockLivenessProvider implements LivenessProvider {
  readonly name = 'MOCK';

  isConfigured(): boolean {
    return true;
  }

  async checkLiveness(input: { selfieImageUrl: string }): Promise<ProviderResult<{ outcome: LivenessCheckOutcome }>> {
    const providerReferenceId = `mock-liveness-${randomUUID()}`;
    if (input.selfieImageUrl.includes('SIMULATE_FAIL_LIVENESS')) {
      return { configured: true, outcome: { status: 'FAILED', providerReferenceId } };
    }
    return { configured: true, outcome: { status: 'PASSED', providerReferenceId } };
  }
}

const unconfiguredProvider = new UnconfiguredLivenessProvider();
const mockProvider = new MockLivenessProvider();

export function getLivenessProvider(): LivenessProvider {
  return isTest ? mockProvider : unconfiguredProvider;
}
