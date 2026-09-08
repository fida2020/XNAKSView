import { randomUUID } from 'crypto';

import { isTest } from '@/config/env';
import * as airwallex from '@/lib/payout/airwallexClient';
import * as payoneer from '@/lib/payout/payoneerClient';

/**
 * Country-aware payout provider abstraction (brief: "build a country-aware
 * payout provider abstraction"). Multiple real implementations behind one
 * interface — `withdrawalOrchestrator.ts` never hard-codes a provider name;
 * it reads `CountryPayoutCapability.providerPriority` for the creator's
 * country and uses the first one that reports itself actually configured.
 * Neither Payoneer nor Airwallex is approved/credentialed for XNAKView yet
 * (see the Step 9 completion report) — both report `configured: false`
 * until real credentials exist.
 */
export type ProviderResult<T> = ({ configured: true } & T) | { configured: false; reason: string };

export interface BankFieldDescriptor {
  key: string;
  label: string;
  type: 'text' | 'select';
  required: boolean;
  options?: { value: string; label: string }[];
}

export interface CreateBeneficiaryInput {
  country: string;
  currency: string;
  accountHolderName: string;
  bankDetails: Record<string, string>;
}

export interface BeneficiaryOutcome {
  beneficiaryId: string;
  /** VERIFIED = bank details (and, for Payoneer, KYC) accepted immediately; PENDING = provider will confirm asynchronously; REJECTED = rejected at submission (e.g. name/account mismatch). */
  status: 'VERIFIED' | 'PENDING' | 'REJECTED';
  rejectionReason?: string;
}

export interface CreatePayoutInput {
  beneficiaryId: string;
  amountMinorUnits: number;
  currency: string;
  idempotencyKey: string;
}

export interface PayoutOutcome {
  providerPayoutId: string;
  /** PENDING = accepted, awaiting provider confirmation via webhook; PAID/FAILED can also come back synchronously for a provider that confirms inline. */
  status: 'PENDING' | 'PAID' | 'FAILED';
  failureReason?: string;
}

export const PAYOUT_PROVIDER_NAMES = ['PAYONEER', 'AIRWALLEX'] as const;
export type PayoutProviderName = (typeof PAYOUT_PROVIDER_NAMES)[number];

export interface PayoutProvider {
  readonly name: PayoutProviderName | 'MOCK';
  /** Always true for the real providers here (they exist in code) — distinct from `isConfigured()`, which is "do real credentials exist," and from Payoneer/Airwallex's actual account-approval status, which no runtime check can answer (see the completion report). */
  isConfigured(): boolean;
  getBankFieldSchema(country: string, currency: string): Promise<ProviderResult<{ fields: BankFieldDescriptor[] }>>;
  createBeneficiary(input: CreateBeneficiaryInput): Promise<ProviderResult<{ outcome: BeneficiaryOutcome }>>;
  createPayout(input: CreatePayoutInput): Promise<ProviderResult<{ outcome: PayoutOutcome }>>;
  getPayoutStatus(providerPayoutId: string): Promise<ProviderResult<{ status: PayoutOutcome['status'] }>>;
  verifyWebhookSignature(payloadWithoutSignature: unknown, signatureHex: string): boolean;
}

class AirwallexPayoutProvider implements PayoutProvider {
  readonly name = 'AIRWALLEX' as const;

  isConfigured(): boolean {
    return airwallex.isAirwallexPayoutsConfigured();
  }

  async getBankFieldSchema(country: string, currency: string): Promise<ProviderResult<{ fields: BankFieldDescriptor[] }>> {
    const result = await airwallex.getBeneficiaryFormSchema(country, currency);
    if (!result.configured) return { configured: false, reason: result.reason };
    return { configured: true, fields: result.schema.fields };
  }

  async createBeneficiary(input: CreateBeneficiaryInput): Promise<ProviderResult<{ outcome: BeneficiaryOutcome }>> {
    const result = await airwallex.createBeneficiary({
      country: input.country,
      currency: input.currency,
      entityType: 'PERSONAL',
      accountHolderName: input.accountHolderName,
      bankDetails: input.bankDetails,
    });
    if (!result.configured) return { configured: false, reason: result.reason };
    const status = result.result.status === 'ACTIVE' ? 'VERIFIED' : result.result.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    return { configured: true, outcome: { beneficiaryId: result.result.beneficiaryId, status } };
  }

  async createPayout(input: CreatePayoutInput): Promise<ProviderResult<{ outcome: PayoutOutcome }>> {
    const result = await airwallex.createTransfer({
      beneficiaryId: input.beneficiaryId,
      amountMinorUnits: input.amountMinorUnits,
      currency: input.currency,
      reason: 'Creator withdrawal',
      requestId: input.idempotencyKey,
    });
    if (!result.configured) return { configured: false, reason: result.reason };
    return { configured: true, outcome: { providerPayoutId: result.result.transferId, status: 'PENDING' } };
  }

  async getPayoutStatus(providerPayoutId: string): Promise<ProviderResult<{ status: PayoutOutcome['status'] }>> {
    const result = await airwallex.getTransferStatus(providerPayoutId);
    if (!result.configured) return { configured: false, reason: result.reason };
    const status = result.status === 'PAID' ? 'PAID' : result.status === 'FAILED' || result.status === 'CANCELLED' ? 'FAILED' : 'PENDING';
    return { configured: true, status };
  }

  verifyWebhookSignature(payloadWithoutSignature: unknown, signatureHex: string): boolean {
    return airwallex.verifyAirwallexWebhookSignature(payloadWithoutSignature, signatureHex);
  }
}

class PayoneerPayoutProvider implements PayoutProvider {
  readonly name = 'PAYONEER' as const;

  isConfigured(): boolean {
    return payoneer.isPayoneerConfigured();
  }

  async getBankFieldSchema(country: string, currency: string): Promise<ProviderResult<{ fields: BankFieldDescriptor[] }>> {
    const result = await payoneer.getPayeeRegistrationFields(country, currency);
    if (!result.configured) return { configured: false, reason: result.reason };
    return { configured: true, fields: result.fields };
  }

  async createBeneficiary(input: CreateBeneficiaryInput): Promise<ProviderResult<{ outcome: BeneficiaryOutcome }>> {
    const payeeId = randomUUID();
    const result = await payoneer.registerPayee({ payeeId, country: input.country, currency: input.currency, accountHolderName: input.accountHolderName, bankDetails: input.bankDetails });
    if (!result.configured) return { configured: false, reason: result.reason };
    // Payoneer bundles bank-detail collection AND KYC into one payee-registration flow.
    const status = result.result.status === 'active' || result.result.status === 'ACTIVE' ? 'VERIFIED' : result.result.status === 'rejected' || result.result.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    return { configured: true, outcome: { beneficiaryId: result.result.payeeId, status } };
  }

  async createPayout(input: CreatePayoutInput): Promise<ProviderResult<{ outcome: PayoutOutcome }>> {
    const result = await payoneer.createPayout({ payeeId: input.beneficiaryId, amountMinorUnits: input.amountMinorUnits, currency: input.currency, description: 'XNAKView creator withdrawal', clientReferenceId: input.idempotencyKey });
    if (!result.configured) return { configured: false, reason: result.reason };
    return { configured: true, outcome: { providerPayoutId: result.result.paymentId, status: 'PENDING' } };
  }

  async getPayoutStatus(providerPayoutId: string): Promise<ProviderResult<{ status: PayoutOutcome['status'] }>> {
    const result = await payoneer.getPayoutStatus(providerPayoutId);
    if (!result.configured) return { configured: false, reason: result.reason };
    const normalized = result.status.toUpperCase();
    const status = normalized === 'PAID' || normalized === 'COMPLETED' ? 'PAID' : normalized === 'FAILED' || normalized === 'CANCELLED' || normalized === 'REJECTED' ? 'FAILED' : 'PENDING';
    return { configured: true, status };
  }

  verifyWebhookSignature(payloadWithoutSignature: unknown, signatureHex: string): boolean {
    return payoneer.verifyPayoneerWebhookSignature(payloadWithoutSignature, signatureHex);
  }
}

/**
 * Deterministic test double — used only when `NODE_ENV=test`, per the
 * brief's own instruction to "test at minimum with mocked/sandbox provider
 * flows." Control the outcome by naming the payout method's
 * `accountHolderName`:
 *   - contains "SIMULATE_REJECT_BENEFICIARY" -> createBeneficiary REJECTED
 *   - contains "SIMULATE_REJECT_AT_SUBMIT"   -> createPayout throws (submission failure)
 *   - anything else                          -> createPayout returns PENDING; the
 *     test then drives PAID/FAILED itself via the webhook route, exercising
 *     the real confirmation path end-to-end.
 */
class MockPayoutProvider implements PayoutProvider {
  readonly name = 'MOCK' as const;
  private beneficiaries = new Map<string, CreateBeneficiaryInput>();

  isConfigured(): boolean {
    return true;
  }

  async getBankFieldSchema(country: string): Promise<ProviderResult<{ fields: BankFieldDescriptor[] }>> {
    const common: BankFieldDescriptor[] = [{ key: 'accountNumber', label: 'Account number', type: 'text', required: true }];
    const byCountry: Record<string, BankFieldDescriptor[]> = {
      PK: [...common, { key: 'iban', label: 'IBAN', type: 'text', required: true }],
      IN: [...common, { key: 'ifscCode', label: 'IFSC code', type: 'text', required: true }],
      GB: [...common, { key: 'sortCode', label: 'Sort code', type: 'text', required: true }],
      US: [...common, { key: 'routingNumber', label: 'Routing number', type: 'text', required: true }],
      DE: [{ key: 'iban', label: 'IBAN', type: 'text', required: true }, { key: 'bic', label: 'BIC/SWIFT', type: 'text', required: true }],
    };
    return { configured: true, fields: byCountry[country] ?? [...common, { key: 'swiftCode', label: 'SWIFT/BIC', type: 'text', required: true }] };
  }

  async createBeneficiary(input: CreateBeneficiaryInput): Promise<ProviderResult<{ outcome: BeneficiaryOutcome }>> {
    const beneficiaryId = `mock-ben-${randomUUID()}`;
    if (input.accountHolderName.includes('SIMULATE_REJECT_BENEFICIARY')) {
      return { configured: true, outcome: { beneficiaryId, status: 'REJECTED', rejectionReason: 'Simulated: bank account holder name mismatch' } };
    }
    this.beneficiaries.set(beneficiaryId, input);
    return { configured: true, outcome: { beneficiaryId, status: 'VERIFIED' } };
  }

  async createPayout(input: CreatePayoutInput): Promise<ProviderResult<{ outcome: PayoutOutcome }>> {
    const beneficiary = this.beneficiaries.get(input.beneficiaryId);
    if (beneficiary?.accountHolderName.includes('SIMULATE_REJECT_AT_SUBMIT')) {
      throw new Error('Simulated provider rejection at submission (invalid destination)');
    }
    return { configured: true, outcome: { providerPayoutId: `mock-transfer-${input.idempotencyKey}`, status: 'PENDING' } };
  }

  async getPayoutStatus(): Promise<ProviderResult<{ status: PayoutOutcome['status'] }>> {
    return { configured: true, status: 'PENDING' };
  }

  verifyWebhookSignature(): boolean {
    return true;
  }
}

const providers: Record<PayoutProviderName, PayoutProvider> = {
  PAYONEER: new PayoneerPayoutProvider(),
  AIRWALLEX: new AirwallexPayoutProvider(),
};
const mockPayoutProvider = new MockPayoutProvider();

/** Every provider that exists in code, real name included — used by the admin status endpoint to report REQUIRES_APPROVAL/configured state (never "approved", which no runtime check can answer). */
export function getAllPayoutProviders(): PayoutProvider[] {
  return isTest ? [mockPayoutProvider] : Object.values(providers);
}

export function getPayoutProviderByName(providerName: string): PayoutProvider | null {
  if (isTest) return mockPayoutProvider;
  if (providerName === 'PAYONEER' || providerName === 'AIRWALLEX') return providers[providerName];
  return null;
}

/** Picks the first provider in `priority` that reports itself actually configured. `null` = none configured for this country — the caller must surface "payout service unavailable," never fall through to a fake provider. */
export function resolveConfiguredProvider(priority: string[]): PayoutProvider | null {
  if (isTest) return mockPayoutProvider;
  for (const name of priority) {
    const provider = getPayoutProviderByName(name);
    if (provider && provider.isConfigured()) return provider;
  }
  return null;
}
