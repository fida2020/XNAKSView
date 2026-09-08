import { createHmac, timingSafeEqual } from 'crypto';

import { env } from '@/config/env';
import { logger } from '@/lib/logger';

/**
 * Real Payoneer White-Label Registration & Payouts + Mass Payout API client
 * — raw `fetch`, no SDK, matching this codebase's convention. Requires a
 * Payoneer-approved `programId` (issued only after Payoneer's
 * Partnerships/Compliance review — see the Step 9 completion report's
 * "Payoneer integration status"), not just a client id/secret. Every
 * method refuses honestly (`configured: false`) when
 * `PAYONEER_CLIENT_ID`/`PAYONEER_CLIENT_SECRET`/`PAYONEER_PROGRAM_ID`
 * aren't all set — never a fake payee, never a fake payout. Endpoint
 * shapes follow Payoneer's published White-Label Registration & Payouts
 * and Mass Payout API docs (developer.payoneer.com); exact field names
 * should be re-verified against the live docs once real sandbox
 * credentials are issued, the same disclosed caveat as `airwallexClient.ts`.
 */

const BASE_URL = env.PAYONEER_ENV === 'production' ? 'https://api.payoneer.com' : 'https://api.sandbox.payoneer.com';

export function isPayoneerConfigured(): boolean {
  return Boolean(env.PAYONEER_CLIENT_ID && env.PAYONEER_CLIENT_SECRET && env.PAYONEER_PROGRAM_ID);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function authenticate(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const response = await fetch(`${BASE_URL}/v2/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.PAYONEER_CLIENT_ID!, client_secret: env.PAYONEER_CLIENT_SECRET!, scope: 'read write' }),
  });
  if (!response.ok) {
    throw new Error(`Payoneer authentication failed (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

async function authorizedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await authenticate();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!response.ok) {
    throw new Error(`Payoneer ${path} failed (HTTP ${response.status}): ${body.message ?? body.code ?? 'unknown error'}`);
  }
  return body;
}

export interface PayeeRegistrationField {
  key: string;
  label: string;
  type: 'text' | 'select';
  required: boolean;
  options?: { value: string; label: string }[];
}

/** "Get Register Payee Format" — the dynamic per-country payee/bank field schema. */
export async function getPayeeRegistrationFields(country: string, currency: string): Promise<{ configured: true; fields: PayeeRegistrationField[] } | { configured: false; reason: string }> {
  if (!isPayoneerConfigured()) {
    return { configured: false, reason: 'Payoneer is not configured on this server (requires Partnerships/Compliance approval + PAYONEER_CLIENT_ID/PAYONEER_CLIENT_SECRET/PAYONEER_PROGRAM_ID)' };
  }
  try {
    const body = await authorizedFetch<{ fields: PayeeRegistrationField[] }>(
      `/v4/programs/${encodeURIComponent(env.PAYONEER_PROGRAM_ID!)}/payees/register/format?country=${encodeURIComponent(country)}&currency=${encodeURIComponent(currency)}&payee_type=individual`,
    );
    return { configured: true, fields: body.fields };
  } catch (error) {
    logger.error({ err: error }, 'Payoneer payee registration format request failed');
    throw error;
  }
}

export interface RegisterPayeeParams {
  payeeId: string;
  country: string;
  currency: string;
  accountHolderName: string;
  bankDetails: Record<string, string>;
}

export interface RegisterPayeeResult {
  payeeId: string;
  /** Payoneer's onboarding + KYC status for this payee in one field — this provider bundles bank-detail collection and identity/KYC into a single payee-registration flow, unlike Airwallex's separate KYC product. */
  status: string;
}

export async function registerPayee(params: RegisterPayeeParams): Promise<{ configured: true; result: RegisterPayeeResult } | { configured: false; reason: string }> {
  if (!isPayoneerConfigured()) {
    return { configured: false, reason: 'Payoneer is not configured on this server (requires Partnerships/Compliance approval + PAYONEER_CLIENT_ID/PAYONEER_CLIENT_SECRET/PAYONEER_PROGRAM_ID)' };
  }
  const body = await authorizedFetch<{ payee_id: string; status: string }>(`/v4/programs/${encodeURIComponent(env.PAYONEER_PROGRAM_ID!)}/payees`, {
    method: 'POST',
    body: JSON.stringify({
      payee_id: params.payeeId,
      type: 'individual',
      country: params.country,
      payment_method: { currency: params.currency, account_holder_name: params.accountHolderName, ...params.bankDetails },
    }),
  });
  return { configured: true, result: { payeeId: body.payee_id, status: body.status } };
}

export async function getPayeeStatus(payeeId: string): Promise<{ configured: true; status: string } | { configured: false; reason: string }> {
  if (!isPayoneerConfigured()) {
    return { configured: false, reason: 'Payoneer is not configured on this server (requires Partnerships/Compliance approval + PAYONEER_CLIENT_ID/PAYONEER_CLIENT_SECRET/PAYONEER_PROGRAM_ID)' };
  }
  const body = await authorizedFetch<{ status: string }>(`/v4/programs/${encodeURIComponent(env.PAYONEER_PROGRAM_ID!)}/payees/${encodeURIComponent(payeeId)}`);
  return { configured: true, status: body.status };
}

export interface CreatePayoutParams {
  payeeId: string;
  amountMinorUnits: number;
  currency: string;
  description: string;
  clientReferenceId: string;
}

export interface CreatePayoutResult {
  paymentId: string;
  status: string;
}

/** Mass Payout API — single-payment call (a real batch endpoint exists too; XNAKView submits one payout per Withdrawal for idempotency clarity). */
export async function createPayout(params: CreatePayoutParams): Promise<{ configured: true; result: CreatePayoutResult } | { configured: false; reason: string }> {
  if (!isPayoneerConfigured()) {
    return { configured: false, reason: 'Payoneer is not configured on this server (requires Partnerships/Compliance approval + PAYONEER_CLIENT_ID/PAYONEER_CLIENT_SECRET/PAYONEER_PROGRAM_ID)' };
  }
  const body = await authorizedFetch<{ payment_id: string; status: string }>(`/v4/programs/${encodeURIComponent(env.PAYONEER_PROGRAM_ID!)}/payouts`, {
    method: 'POST',
    body: JSON.stringify({
      client_reference_id: params.clientReferenceId,
      payee_id: params.payeeId,
      amount: (params.amountMinorUnits / 100).toFixed(2),
      currency: params.currency,
      description: params.description,
    }),
  });
  return { configured: true, result: { paymentId: body.payment_id, status: body.status } };
}

export async function getPayoutStatus(paymentId: string): Promise<{ configured: true; status: string } | { configured: false; reason: string }> {
  if (!isPayoneerConfigured()) {
    return { configured: false, reason: 'Payoneer is not configured on this server (requires Partnerships/Compliance approval + PAYONEER_CLIENT_ID/PAYONEER_CLIENT_SECRET/PAYONEER_PROGRAM_ID)' };
  }
  const body = await authorizedFetch<{ status: string }>(`/v4/programs/${encodeURIComponent(env.PAYONEER_PROGRAM_ID!)}/payouts/${encodeURIComponent(paymentId)}`);
  return { configured: true, status: body.status };
}

/**
 * Payoneer's real production webhook signing scheme is not confirmed from
 * public docs alone — this HMAC-over-the-parsed-and-reserialized-body
 * scheme mirrors this codebase's own established webhook convention (same
 * disclosed caveat as `airwallexClient.ts`'s webhook verifier) and must be
 * re-verified against Payoneer's actual webhook documentation once a real
 * `PAYONEER_WEBHOOK_SECRET` is issued.
 */
export function verifyPayoneerWebhookSignature(payloadWithoutSignature: unknown, signatureHex: string): boolean {
  if (!env.PAYONEER_WEBHOOK_SECRET) return false;
  const expected = createHmac('sha256', env.PAYONEER_WEBHOOK_SECRET).update(JSON.stringify(payloadWithoutSignature)).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signatureHex, 'hex');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
