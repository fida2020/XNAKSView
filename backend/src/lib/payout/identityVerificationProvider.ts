import { randomUUID } from 'crypto';

import { env, isTest } from '@/config/env';
import { logger } from '@/lib/logger';
import { verifyAirwallexWebhookSignature } from '@/lib/payout/airwallexClient';
import { getPayeeStatus, isPayoneerConfigured, verifyPayoneerWebhookSignature } from '@/lib/payout/payoneerClient';
import type { ProviderResult } from '@/lib/payout/payoutProvider';

/**
 * Automatic identity verification (KYC) — kept as its OWN pluggable seam,
 * separate from `PayoutProvider`, because the two real candidate providers
 * model KYC differently: Airwallex would need a separate Connected-Account
 * product; Payoneer bundles KYC into the SAME payee-registration call as
 * the bank account (`PayoneerPayoutProvider.createBeneficiary`). Neither is
 * approved/credentialed for XNAKView yet — see the Step 9 completion
 * report. TikTok's own KYC vendor and internal logic are NOT PUBLICLY
 * VERIFIABLE and are not reproduced here; this is XNAKView's own build
 * decision.
 */
export type IdentityVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface StartVerificationInput {
  creatorId: string;
  country: string;
  /** Required for a Payoneer-routed verification — Payoneer's KYC is on the payee entity created by `PayoutProvider.createBeneficiary`, not a separate session. */
  existingPayoutBeneficiaryId?: string;
}

export interface StartVerificationOutcome {
  providerReferenceId: string;
  hostedUrl: string | null;
  status: IdentityVerificationStatus;
}

export const KYC_PROVIDER_NAMES = ['PAYONEER', 'AIRWALLEX'] as const;
export type KycProviderName = (typeof KYC_PROVIDER_NAMES)[number];

export interface IdentityVerificationProvider {
  readonly name: KycProviderName | 'MOCK';
  isConfigured(): boolean;
  startVerification(input: StartVerificationInput): Promise<ProviderResult<{ outcome: StartVerificationOutcome }>>;
  getStatus(providerReferenceId: string): Promise<ProviderResult<{ status: IdentityVerificationStatus }>>;
  verifyWebhookSignature(payloadWithoutSignature: unknown, signatureHex: string): boolean;
}

function isAirwallexKycConfigured(): boolean {
  return Boolean(env.AIRWALLEX_KYC_CLIENT_ID && env.AIRWALLEX_KYC_API_KEY);
}

const AIRWALLEX_KYC_BASE_URL = env.AIRWALLEX_ENV === 'prod' ? 'https://api.airwallex.com' : 'https://api-demo.airwallex.com';

class AirwallexKycProvider implements IdentityVerificationProvider {
  readonly name = 'AIRWALLEX' as const;

  isConfigured(): boolean {
    return isAirwallexKycConfigured();
  }

  async startVerification(input: StartVerificationInput): Promise<ProviderResult<{ outcome: StartVerificationOutcome }>> {
    if (!this.isConfigured()) {
      return { configured: false, reason: 'Identity verification is not configured on this server (set AIRWALLEX_KYC_CLIENT_ID/AIRWALLEX_KYC_API_KEY)' };
    }
    try {
      const response = await fetch(`${AIRWALLEX_KYC_BASE_URL}/api/v1/accounts/create`, {
        method: 'POST',
        headers: { 'x-client-id': env.AIRWALLEX_KYC_CLIENT_ID!, 'x-api-key': env.AIRWALLEX_KYC_API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { xnakview_creator_id: input.creatorId }, primary_contact: {}, country: input.country }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; onboarding_url?: string; status?: string; message?: string };
      if (!response.ok || !body.id) {
        throw new Error(body.message ?? `Airwallex KYC account creation failed (HTTP ${response.status})`);
      }
      return { configured: true, outcome: { providerReferenceId: body.id, hostedUrl: body.onboarding_url ?? `${AIRWALLEX_KYC_BASE_URL}/onboarding/${body.id}`, status: 'PENDING' } };
    } catch (error) {
      logger.error({ err: error }, 'Airwallex KYC start-verification request failed');
      throw error;
    }
  }

  async getStatus(providerReferenceId: string): Promise<ProviderResult<{ status: IdentityVerificationStatus }>> {
    if (!this.isConfigured()) {
      return { configured: false, reason: 'Identity verification is not configured on this server (set AIRWALLEX_KYC_CLIENT_ID/AIRWALLEX_KYC_API_KEY)' };
    }
    const response = await fetch(`${AIRWALLEX_KYC_BASE_URL}/api/v1/accounts/${encodeURIComponent(providerReferenceId)}`, {
      headers: { 'x-client-id': env.AIRWALLEX_KYC_CLIENT_ID!, 'x-api-key': env.AIRWALLEX_KYC_API_KEY! },
    });
    const body = (await response.json().catch(() => ({}))) as { status?: string };
    const status: IdentityVerificationStatus = body.status === 'ACTIVE' ? 'VERIFIED' : body.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    return { configured: true, status };
  }

  verifyWebhookSignature(payloadWithoutSignature: unknown, signatureHex: string): boolean {
    return verifyAirwallexWebhookSignature(payloadWithoutSignature, signatureHex);
  }
}

class PayoneerKycProvider implements IdentityVerificationProvider {
  readonly name = 'PAYONEER' as const;

  isConfigured(): boolean {
    return isPayoneerConfigured();
  }

  async startVerification(input: StartVerificationInput): Promise<ProviderResult<{ outcome: StartVerificationOutcome }>> {
    if (!this.isConfigured()) {
      return { configured: false, reason: 'Identity verification is not configured on this server (Payoneer requires Partnerships/Compliance approval + PAYONEER_CLIENT_ID/PAYONEER_CLIENT_SECRET/PAYONEER_PROGRAM_ID)' };
    }
    if (!input.existingPayoutBeneficiaryId) {
      throw new Error('Payoneer identity verification requires a payout method (bank account) to be added first — KYC is bundled into payee registration');
    }
    const result = await getPayeeStatus(input.existingPayoutBeneficiaryId);
    if (!result.configured) return { configured: false, reason: result.reason };
    const normalized = result.status.toUpperCase();
    const status: IdentityVerificationStatus = normalized === 'ACTIVE' ? 'VERIFIED' : normalized === 'REJECTED' ? 'REJECTED' : 'PENDING';
    return { configured: true, outcome: { providerReferenceId: input.existingPayoutBeneficiaryId, hostedUrl: null, status } };
  }

  async getStatus(providerReferenceId: string): Promise<ProviderResult<{ status: IdentityVerificationStatus }>> {
    const result = await getPayeeStatus(providerReferenceId);
    if (!result.configured) return { configured: false, reason: result.reason };
    const normalized = result.status.toUpperCase();
    const status: IdentityVerificationStatus = normalized === 'ACTIVE' ? 'VERIFIED' : normalized === 'REJECTED' ? 'REJECTED' : 'PENDING';
    return { configured: true, status };
  }

  verifyWebhookSignature(payloadWithoutSignature: unknown, signatureHex: string): boolean {
    return verifyPayoneerWebhookSignature(payloadWithoutSignature, signatureHex);
  }
}

/**
 * Deterministic test double, `NODE_ENV=test` only. `startVerification`
 * always returns PENDING with a mock hosted URL; tests drive VERIFIED/
 * REJECTED themselves via the webhook route (matching the real
 * asynchronous-onboarding shape). `country === 'ZZ'` throws immediately for
 * negative-path tests needing a synchronous provider outage.
 */
class MockIdentityVerificationProvider implements IdentityVerificationProvider {
  readonly name = 'MOCK' as const;

  isConfigured(): boolean {
    return true;
  }

  async startVerification(input: StartVerificationInput): Promise<ProviderResult<{ outcome: StartVerificationOutcome }>> {
    if (input.country === 'ZZ') {
      throw new Error('Simulated KYC provider outage');
    }
    const providerReferenceId = `mock-kyc-${randomUUID()}`;
    return { configured: true, outcome: { providerReferenceId, hostedUrl: `https://mock-kyc.local/session/${providerReferenceId}`, status: 'PENDING' } };
  }

  async getStatus(): Promise<ProviderResult<{ status: IdentityVerificationStatus }>> {
    return { configured: true, status: 'PENDING' };
  }

  verifyWebhookSignature(): boolean {
    return true;
  }
}

const providers: Record<KycProviderName, IdentityVerificationProvider> = {
  PAYONEER: new PayoneerKycProvider(),
  AIRWALLEX: new AirwallexKycProvider(),
};
const mockIdentityVerificationProvider = new MockIdentityVerificationProvider();

export function getAllIdentityVerificationProviders(): IdentityVerificationProvider[] {
  return isTest ? [mockIdentityVerificationProvider] : Object.values(providers);
}

export function getIdentityVerificationProviderByName(providerName: string): IdentityVerificationProvider | null {
  if (isTest) return mockIdentityVerificationProvider;
  if (providerName === 'PAYONEER' || providerName === 'AIRWALLEX') return providers[providerName];
  return null;
}

/** Same "first configured wins, else null" resolution as `payoutProvider.ts`'s `resolveConfiguredProvider` — kept independent since KYC and payout providers can differ per country. */
export function resolveConfiguredKycProvider(priority: string[]): IdentityVerificationProvider | null {
  if (isTest) return mockIdentityVerificationProvider;
  for (const name of priority) {
    const provider = getIdentityVerificationProviderByName(name);
    if (provider && provider.isConfigured()) return provider;
  }
  return null;
}
