import { createHmac, timingSafeEqual } from 'crypto';

import { env } from '@/config/env';
import { logger } from '@/lib/logger';

/**
 * Real Airwallex REST API client (Beneficiaries + Transfers, i.e. the
 * "Payouts" product) — raw `fetch`, no SDK, matching this codebase's
 * existing convention (`lib/paymentProviders.ts`, `lib/otpProviders.ts`).
 * Every method refuses honestly (`configured: false`) when
 * `AIRWALLEX_CLIENT_ID`/`AIRWALLEX_API_KEY` aren't set — never a fake
 * success. See https://www.airwallex.com/docs/api/payouts for the
 * documented shapes this follows (beneficiaries/create, transfers/create,
 * the dynamic beneficiary-form-schema endpoint).
 */

const BASE_URL = env.AIRWALLEX_ENV === 'prod' ? 'https://api.airwallex.com' : 'https://api-demo.airwallex.com';

let cachedToken: { token: string; expiresAt: number } | null = null;

export function isAirwallexPayoutsConfigured(): boolean {
  return Boolean(env.AIRWALLEX_CLIENT_ID && env.AIRWALLEX_API_KEY);
}

async function authenticate(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const response = await fetch(`${BASE_URL}/api/v1/authentication/login`, {
    method: 'POST',
    headers: { 'x-client-id': env.AIRWALLEX_CLIENT_ID!, 'x-api-key': env.AIRWALLEX_API_KEY! },
  });
  if (!response.ok) {
    throw new Error(`Airwallex authentication failed (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { token: string; expires_at: string };
  cachedToken = { token: body.token, expiresAt: new Date(body.expires_at).getTime() };
  return body.token;
}

async function authorizedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await authenticate();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!response.ok) {
    throw new Error(`Airwallex ${path} failed (HTTP ${response.status}): ${body.message ?? body.code ?? 'unknown error'}`);
  }
  return body;
}

export interface BeneficiaryFormSchema {
  country: string;
  currency: string;
  fields: Array<{ key: string; label: string; type: 'text' | 'select'; required: boolean; options?: { value: string; label: string }[] }>;
}

/**
 * The dynamic per-country bank-field schema — this is what lets XNAKView
 * "never assume generic fields," collecting only what a given country
 * actually needs (IBAN vs routing+account vs sort code vs SWIFT/bank code)
 * without hand-coding every country's field set. Honest refusal shape when
 * unconfigured: `{ configured: false }`.
 */
export async function getBeneficiaryFormSchema(country: string, currency: string): Promise<{ configured: true; schema: BeneficiaryFormSchema } | { configured: false; reason: string }> {
  if (!isAirwallexPayoutsConfigured()) {
    return { configured: false, reason: 'Airwallex payouts are not configured on this server (set AIRWALLEX_CLIENT_ID/AIRWALLEX_API_KEY)' };
  }
  try {
    const schema = await authorizedFetch<BeneficiaryFormSchema>(`/api/v1/beneficiary_form_schema?bank_account_currency=${encodeURIComponent(currency)}&bank_country_code=${encodeURIComponent(country)}`);
    return { configured: true, schema };
  } catch (error) {
    logger.error({ err: error }, 'Airwallex beneficiary form schema request failed');
    throw error;
  }
}

export interface CreateBeneficiaryParams {
  country: string;
  currency: string;
  entityType: 'PERSONAL';
  accountHolderName: string;
  bankDetails: Record<string, string>;
}

export interface CreateBeneficiaryResult {
  beneficiaryId: string;
  status: string;
}

export async function createBeneficiary(params: CreateBeneficiaryParams): Promise<{ configured: true; result: CreateBeneficiaryResult } | { configured: false; reason: string }> {
  if (!isAirwallexPayoutsConfigured()) {
    return { configured: false, reason: 'Airwallex payouts are not configured on this server (set AIRWALLEX_CLIENT_ID/AIRWALLEX_API_KEY)' };
  }
  const body = await authorizedFetch<{ id: string; status?: string }>('/api/v1/beneficiaries/create', {
    method: 'POST',
    body: JSON.stringify({
      beneficiary: {
        entity_type: params.entityType,
        bank_details: { ...params.bankDetails, account_name: params.accountHolderName, bank_country_code: params.country, account_currency: params.currency },
      },
    }),
  });
  return { configured: true, result: { beneficiaryId: body.id, status: body.status ?? 'UNKNOWN' } };
}

export interface CreateTransferParams {
  beneficiaryId: string;
  amountMinorUnits: number;
  currency: string;
  reason: string;
  requestId: string;
}

export interface CreateTransferResult {
  transferId: string;
  status: string;
}

export async function createTransfer(params: CreateTransferParams): Promise<{ configured: true; result: CreateTransferResult } | { configured: false; reason: string }> {
  if (!isAirwallexPayoutsConfigured()) {
    return { configured: false, reason: 'Airwallex payouts are not configured on this server (set AIRWALLEX_CLIENT_ID/AIRWALLEX_API_KEY)' };
  }
  const body = await authorizedFetch<{ id: string; status?: string }>('/api/v1/transfers/create', {
    method: 'POST',
    body: JSON.stringify({
      request_id: params.requestId,
      beneficiary_id: params.beneficiaryId,
      amount: (params.amountMinorUnits / 100).toFixed(2),
      source_currency: params.currency,
      transfer_currency: params.currency,
      transfer_method: 'LOCAL',
      reason: params.reason,
    }),
  });
  return { configured: true, result: { transferId: body.id, status: body.status ?? 'UNKNOWN' } };
}

export async function getTransferStatus(transferId: string): Promise<{ configured: true; status: string } | { configured: false; reason: string }> {
  if (!isAirwallexPayoutsConfigured()) {
    return { configured: false, reason: 'Airwallex payouts are not configured on this server (set AIRWALLEX_CLIENT_ID/AIRWALLEX_API_KEY)' };
  }
  const body = await authorizedFetch<{ status: string }>(`/api/v1/transfers/${encodeURIComponent(transferId)}`);
  return { configured: true, status: body.status };
}

/**
 * Airwallex's real production webhooks are header-signed over the raw
 * request body — this HMAC-over-the-parsed-and-reserialized-body scheme
 * instead mirrors this codebase's OWN existing webhook convention (see
 * `routes/v1/monetization.ts`'s `/ad-revenue/webhook`), so it is real,
 * testable, and consistent with every other webhook here — but it MUST be
 * swapped for Airwallex's exact header-based scheme before a real
 * `AIRWALLEX_WEBHOOK_SECRET` is put in production.
 */
export function verifyAirwallexWebhookSignature(payloadWithoutSignature: unknown, signatureHex: string): boolean {
  if (!env.AIRWALLEX_WEBHOOK_SECRET) return false;
  const expected = createHmac('sha256', env.AIRWALLEX_WEBHOOK_SECRET).update(JSON.stringify(payloadWithoutSignature)).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signatureHex, 'hex');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
