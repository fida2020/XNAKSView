import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { app, registerAdmin, registerUser } from '@/test/helpers';

/**
 * Step 9 — automated, provider-agnostic global creator payouts. Every test
 * hits the real backend against live Postgres/Redis (this codebase's
 * established testing philosophy for financial-critical code — see
 * `earningsExchange.test.ts`), with `NODE_ENV=test` forcing
 * `MockPayoutProvider`/`MockIdentityVerificationProvider`
 * (`lib/payout/payoutProvider.ts`/`identityVerificationProvider.ts`) instead
 * of a real Payoneer/Airwallex call. Nothing here asserts a specific
 * provider is "approved" — only that the country-aware routing, KYC, fraud
 * checks, atomic ledger hold/reversal, webhook confirmation, and idempotency
 * plumbing all behave correctly against the abstraction.
 */

let fixtureCounter = 0;
function uniqueSlug(prefix: string): string {
  fixtureCounter += 1;
  return `${prefix}-${Date.now()}-${fixtureCounter}`;
}

interface CountryFixture {
  countryCode: string;
  currency: string;
  provider: 'PAYONEER' | 'AIRWALLEX';
  expectedFieldKeys: string[];
  bankDetails: Record<string, string>;
}

/** PK/IN/GB/US/DE — required by the brief as initial automated test countries. Never the complete supported-country list: `CountryPayoutCapability` (admin-configurable, seeded here only for these five) is the sole source of truth for which countries are actually enabled. */
const COUNTRIES: CountryFixture[] = [
  { countryCode: 'PK', currency: 'PKR', provider: 'PAYONEER', expectedFieldKeys: ['accountNumber', 'iban'], bankDetails: { accountNumber: '1234567890', iban: 'PK36SCBL0000001123456702' } },
  { countryCode: 'IN', currency: 'INR', provider: 'AIRWALLEX', expectedFieldKeys: ['accountNumber', 'ifscCode'], bankDetails: { accountNumber: '000123456789', ifscCode: 'HDFC0000123' } },
  { countryCode: 'GB', currency: 'GBP', provider: 'AIRWALLEX', expectedFieldKeys: ['accountNumber', 'sortCode'], bankDetails: { accountNumber: '12345678', sortCode: '040004' } },
  { countryCode: 'US', currency: 'USD', provider: 'PAYONEER', expectedFieldKeys: ['accountNumber', 'routingNumber'], bankDetails: { accountNumber: '000123456789', routingNumber: '021000021' } },
  { countryCode: 'DE', currency: 'EUR', provider: 'AIRWALLEX', expectedFieldKeys: ['iban', 'bic'], bankDetails: { iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' } },
];

const DEFAULT_CAPABILITY = { minPayoutMinorUnits: 5000, maxPayoutMinorUnits: 100_000_000, feeFixedMinorUnits: 100, feePercentBps: 250, estimatedProcessingDays: 3 };

/** Fixture setup (not the thing under test) — direct-Prisma upsert, matching this file's own `seedEarnings` convention, so the suite is safely re-runnable against a persistent dev DB (`countryCode` is `@unique`, and `country_payout_capabilities` is intentionally NOT in `test/setup.ts`'s truncate list). */
async function seedCapability(fixture: CountryFixture, overrides: Partial<typeof DEFAULT_CAPABILITY & { enabled: boolean }> = {}): Promise<void> {
  const values = { ...DEFAULT_CAPABILITY, ...overrides, enabled: overrides.enabled ?? true };
  await prisma.countryPayoutCapability.upsert({
    where: { countryCode: fixture.countryCode },
    create: { countryCode: fixture.countryCode, currency: fixture.currency, providerPriority: [fixture.provider], ...values },
    update: { currency: fixture.currency, providerPriority: [fixture.provider], ...values },
  });
}

async function seedEarnings(creatorId: string, amountMinorUnits: number, currency: string): Promise<void> {
  const wallet = await prisma.creatorEarningsWallet.upsert({
    where: { creatorId },
    create: { creatorId, balanceMinorUnits: amountMinorUnits, currency },
    update: { balanceMinorUnits: { increment: amountMinorUnits }, currency },
  });
  await prisma.creatorEarningsLedgerEntry.create({
    data: { walletId: wallet.id, direction: 'CREDIT', type: 'ADJUSTMENT', amountMinorUnits, currency, beforeBalance: 0, afterBalance: wallet.balanceMinorUnits, idempotencyKey: uniqueSlug('seed-earnings') },
  });
}

async function getEarningsBalance(token: string): Promise<number> {
  const res = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${token}`);
  return res.body.balanceMinorUnits as number;
}

/** Adds+verifies a bank account and drives identity verification to VERIFIED via the real webhook route (mirroring how a real provider would call back), then backdates the payout method's `verifiedAt` PAST the fraud engine's 24h new-method cooldown — that cooldown gets its own dedicated test below; every other test needs it out of the way. */
async function onboardCreator(token: string, fixture: CountryFixture, accountHolderName = 'Test Creator'): Promise<{ payoutMethodId: string }> {
  const addRes = await request(app)
    .post('/api/v1/creator/payout-method')
    .set('Authorization', `Bearer ${token}`)
    .send({ country: fixture.countryCode, currency: fixture.currency, accountHolderName, bankDetails: fixture.bankDetails });
  expect(addRes.status).toBe(200);
  expect(addRes.body.status).toBe('VERIFIED');

  await prisma.creatorPayoutMethod.update({ where: { id: addRes.body.id }, data: { verifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

  const startRes = await request(app).post('/api/v1/creator/identity-verification/start').set('Authorization', `Bearer ${token}`).send({ country: fixture.countryCode });
  expect(startRes.status).toBe(201);
  expect(startRes.body.status).toBe('PENDING');

  const verification = await prisma.verification.findUniqueOrThrow({ where: { id: startRes.body.id } });
  const webhookRes = await request(app)
    .post(`/api/v1/webhooks/payout/${fixture.provider}`)
    .send({ eventType: 'IDENTITY_VERIFIED', externalEventId: uniqueSlug('kyc-webhook'), providerReferenceId: verification.providerReferenceId, signature: 'test' });
  expect(webhookRes.status).toBe(200);

  const check = await request(app).get('/api/v1/creator/identity-verification').set('Authorization', `Bearer ${token}`);
  expect(check.body.verification.status).toBe('APPROVED');

  return { payoutMethodId: addRes.body.id };
}

describe('Step 9 payouts — dynamic bank fields (country-aware)', () => {
  it.each(COUNTRIES)('$countryCode ($currency, routed to $provider) returns provider-specific, non-hardcoded bank fields', async (fixture) => {
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();

    const res = await request(app)
      .get('/api/v1/creator/payout-method/schema')
      .query({ country: fixture.countryCode, currency: fixture.currency })
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`);

    expect(res.status).toBe(200);
    const keys = (res.body.fields as { key: string }[]).map((f) => f.key).sort();
    expect(keys).toEqual([...fixture.expectedFieldKeys].sort());
  });

  it('never exposes a provider-selection field to the creator — schema fields are only bank-detail keys', async () => {
    const fixture = COUNTRIES[0]!;
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const res = await request(app).get('/api/v1/creator/payout-method/schema').query({ country: fixture.countryCode, currency: fixture.currency }).set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    const keys = (res.body.fields as { key: string }[]).map((f) => f.key);
    expect(keys).not.toContain('provider');
  });

  it('lists only enabled countries for the client-side country picker — never a hardcoded PK/IN/GB/US/DE-only list', async () => {
    await Promise.all(COUNTRIES.map((c) => seedCapability(c)));
    const disabledFixture: CountryFixture = { countryCode: 'NZ', currency: 'NZD', provider: 'AIRWALLEX', expectedFieldKeys: [], bankDetails: {} };
    await seedCapability(disabledFixture, { enabled: false });
    const { response: creatorReg } = await registerUser();

    const res = await request(app).get('/api/v1/creator/payout-method/countries').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(res.status).toBe(200);
    const codes = (res.body.countries as { countryCode: string; currency: string }[]).map((c) => c.countryCode);
    for (const fixture of COUNTRIES) expect(codes).toContain(fixture.countryCode);
    expect(codes).not.toContain('NZ'); // disabled — never surfaced to the creator
    // Never leaks internal routing/limit config to the client.
    expect(Object.keys(res.body.countries[0])).toEqual(['countryCode', 'currency']);
  });
});

describe.each(COUNTRIES)('Step 9 payouts — full lifecycle for $countryCode ($currency)', (fixture) => {
  it('preview -> submit -> PROCESSING -> webhook PAID, with atomic fee/net/ledger accounting, duplicate-webhook and duplicate-request idempotency', async () => {
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;

    await seedEarnings(creatorReg.body.user.id, 500_000, fixture.currency);
    await onboardCreator(token, fixture);

    // Fee/FX/net preview BEFORE submission — never persists anything.
    const amount = 200_000;
    const preview = await request(app).get('/api/v1/creator/withdrawals/preview').query({ amountMinorUnits: amount }).set('Authorization', `Bearer ${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.currency).toBe(fixture.currency);
    expect(preview.body.countryCode).toBe(fixture.countryCode);
    expect(preview.body.feeMinorUnits).toBe(5100); // 100 fixed + floor(200000 * 250/10000)
    expect(preview.body.netAmountMinorUnits).toBe(194_900);
    const preBalance = await getEarningsBalance(token);
    expect(preBalance).toBe(500_000); // preview never touches the ledger

    const idempotencyKey = uniqueSlug('withdraw');
    const submit = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: amount, currency: fixture.currency, idempotencyKey });
    expect(submit.status).toBe(201);
    // No admin review in between — automatic pipeline drives straight to PROCESSING (never optimistic PAID without a provider confirmation).
    expect(submit.body.status).toBe('PROCESSING');

    const afterHold = await getEarningsBalance(token);
    expect(afterHold).toBe(300_000); // held immediately, atomically, at request time

    const withdrawalRow = await prisma.withdrawal.findUniqueOrThrow({ where: { id: submit.body.id } });
    expect(withdrawalRow.providerPayoutId).toBeTruthy();
    expect(withdrawalRow.feeMinorUnits).toBe(5100);
    expect(withdrawalRow.netAmountMinorUnits).toBe(194_900);

    // Real (mocked) provider confirmation — the ONLY way this can become PAID.
    const paidEventId = uniqueSlug('payout-paid');
    const paidWebhookPayload = { eventType: 'PAYOUT_PAID', externalEventId: paidEventId, providerPayoutId: withdrawalRow.providerPayoutId, signature: 'test' };
    const paidWebhook = await request(app).post(`/api/v1/webhooks/payout/${fixture.provider}`).send(paidWebhookPayload);
    expect(paidWebhook.status).toBe(200);
    expect(paidWebhook.body.alreadyProcessed).toBeFalsy();

    const listAfterPaid = await request(app).get('/api/v1/creator/withdrawals').set('Authorization', `Bearer ${token}`);
    const paidEntry = listAfterPaid.body.withdrawals.find((w: { id: string }) => w.id === submit.body.id);
    expect(paidEntry.status).toBe('PAID');

    const afterPaid = await getEarningsBalance(token);
    expect(afterPaid).toBe(300_000); // PAID never touches the ledger again — the hold already removed the funds

    // Duplicate webhook — the SAME externalEventId replayed (a provider retry) — processed exactly once, never a double effect.
    const duplicateWebhook = await request(app).post(`/api/v1/webhooks/payout/${fixture.provider}`).send(paidWebhookPayload);
    expect(duplicateWebhook.status).toBe(200);
    expect(duplicateWebhook.body.alreadyProcessed).toBe(true);
    const stillPaidBalance = await getEarningsBalance(token);
    expect(stillPaidBalance).toBe(300_000);

    // Duplicate withdrawal REQUEST (same idempotencyKey) — never a second hold.
    const replaySubmit = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: amount, currency: fixture.currency, idempotencyKey });
    expect(replaySubmit.status).toBe(201);
    expect(replaySubmit.body.id).toBe(submit.body.id);
    const afterReplay = await getEarningsBalance(token);
    expect(afterReplay).toBe(300_000);

    // Cancel is only valid from REQUESTED — the automatic pipeline already moved this past it.
    const cancelAttempt = await request(app).post(`/api/v1/creator/withdrawals/${submit.body.id}/cancel`).set('Authorization', `Bearer ${token}`);
    expect(cancelAttempt.status).toBe(409);
  });
});

describe('Step 9 payouts — beneficiary and submission rejection (no fake success)', () => {
  it('a provider-rejected beneficiary is stored as REJECTED, never VERIFIED, and never silently becomes eligible', async () => {
    const fixture = COUNTRIES[0]!;
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();

    const addRes = await request(app)
      .post('/api/v1/creator/payout-method')
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`)
      .send({ country: fixture.countryCode, currency: fixture.currency, accountHolderName: 'SIMULATE_REJECT_BENEFICIARY Creator', bankDetails: fixture.bankDetails });
    expect(addRes.status).toBe(200);
    expect(addRes.body.status).toBe('REJECTED');
    expect(addRes.body.rejectionReason).toBeTruthy();

    const method = await request(app).get('/api/v1/creator/payout-method').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(method.body.payoutMethod.status).toBe('REJECTED');
  });

  it('a provider that throws at submission (post-approval) FAILS the withdrawal and fully reverses the hold — never a stranded or fake-paid balance', async () => {
    const fixture = COUNTRIES[3]!; // US
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;

    await seedEarnings(creatorReg.body.user.id, 500_000, fixture.currency);
    await onboardCreator(token, fixture, 'SIMULATE_REJECT_AT_SUBMIT Creator'); // beneficiary itself is accepted (VERIFIED); only the payout submission fails

    const idempotencyKey = uniqueSlug('withdraw-submit-fail');
    const submit = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: 100_000, currency: fixture.currency, idempotencyKey });
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe('FAILED');
    expect(submit.body.failureReason).toBeTruthy();

    const balance = await getEarningsBalance(token);
    expect(balance).toBe(500_000); // the hold was fully reversed, not stranded
  });

  it('a provider webhook reporting PAYOUT_FAILED (post-PROCESSING) reverses the hold exactly once, even if replayed', async () => {
    const fixture = COUNTRIES[1]!; // IN
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;

    await seedEarnings(creatorReg.body.user.id, 500_000, fixture.currency);
    await onboardCreator(token, fixture);

    const submit = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: 150_000, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-webhook-fail') });
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe('PROCESSING');
    expect(await getEarningsBalance(token)).toBe(350_000);

    const withdrawalRow = await prisma.withdrawal.findUniqueOrThrow({ where: { id: submit.body.id } });
    const failPayload = { eventType: 'PAYOUT_FAILED', externalEventId: uniqueSlug('payout-failed'), providerPayoutId: withdrawalRow.providerPayoutId, failureReason: 'Simulated: destination account closed', signature: 'test' };

    const failWebhook = await request(app).post(`/api/v1/webhooks/payout/${fixture.provider}`).send(failPayload);
    expect(failWebhook.status).toBe(200);
    expect(await getEarningsBalance(token)).toBe(500_000); // reversed back in full

    const listAfter = await request(app).get('/api/v1/creator/withdrawals').set('Authorization', `Bearer ${token}`);
    const entry = listAfter.body.withdrawals.find((w: { id: string }) => w.id === submit.body.id);
    expect(entry.status).toBe('FAILED');
    expect(entry.failureReason).toContain('destination account closed');

    // Replayed failure webhook — must not double-credit the reversal.
    const replay = await request(app).post(`/api/v1/webhooks/payout/${fixture.provider}`).send(failPayload);
    expect(replay.status).toBe(200);
    expect(replay.body.alreadyProcessed).toBe(true);
    expect(await getEarningsBalance(token)).toBe(500_000);
  });
});

describe('Step 9 payouts — automatic fraud/risk checks', () => {
  it('blocks a withdrawal against a payout method verified less than 24h ago and auto-creates a system fraud hold (never an admin click)', async () => {
    const fixture = COUNTRIES[2]!; // GB
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;
    await seedEarnings(creatorReg.body.user.id, 500_000, fixture.currency);

    // Add + verify the bank account and KYC WITHOUT backdating verifiedAt — the cooldown should still be active.
    const addRes = await request(app)
      .post('/api/v1/creator/payout-method')
      .set('Authorization', `Bearer ${token}`)
      .send({ country: fixture.countryCode, currency: fixture.currency, accountHolderName: 'Fresh Method Creator', bankDetails: fixture.bankDetails });
    expect(addRes.body.status).toBe('VERIFIED');
    const startRes = await request(app).post('/api/v1/creator/identity-verification/start').set('Authorization', `Bearer ${token}`).send({ country: fixture.countryCode });
    const verification = await prisma.verification.findUniqueOrThrow({ where: { id: startRes.body.id } });
    await request(app)
      .post(`/api/v1/webhooks/payout/${fixture.provider}`)
      .send({ eventType: 'IDENTITY_VERIFIED', externalEventId: uniqueSlug('kyc'), providerReferenceId: verification.providerReferenceId, signature: 'test' });

    const submit = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: 100_000, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-cooldown') });
    expect(submit.status).toBe(403);
    expect(await getEarningsBalance(token)).toBe(500_000); // blocked BEFORE any hold was created

    const hold = await prisma.fraudHold.findFirst({ where: { userId: creatorReg.body.user.id, status: 'ACTIVE' } });
    expect(hold).toBeTruthy();
    expect(hold!.createdById).toBeNull(); // system-raised, not an admin

    // With an active hold, even a later, otherwise-clean attempt stays blocked — clearing a hold is an admin exception action, never automatic.
    const secondAttempt = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: 50_000, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-cooldown-2') });
    expect(secondAttempt.status).toBe(403);
  });

  it('blocks a 4th withdrawal request within 24h once the velocity limit (3) is hit', async () => {
    const fixture = COUNTRIES[4]!; // DE
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;
    await seedEarnings(creatorReg.body.user.id, 500_000, fixture.currency);
    await onboardCreator(token, fixture);

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .post('/api/v1/creator/withdrawals')
        .set('Authorization', `Bearer ${token}`)
        .send({ amountMinorUnits: 10_000, currency: fixture.currency, idempotencyKey: uniqueSlug(`withdraw-velocity-${i}`) });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PROCESSING');
    }

    const fourth = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: 10_000, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-velocity-4') });
    expect(fourth.status).toBe(403);

    const hold = await prisma.fraudHold.findFirst({ where: { userId: creatorReg.body.user.id, status: 'ACTIVE' } });
    expect(hold).toBeTruthy();
  });
});

describe('Step 9 payouts — eligibility edge cases', () => {
  it('rejects a withdrawal below the global minimum even when the country capability allows a smaller amount', async () => {
    const fixture: CountryFixture = { ...COUNTRIES[0]!, countryCode: 'PK' };
    await seedCapability(fixture, { minPayoutMinorUnits: 1000 });
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;
    await seedEarnings(creatorReg.body.user.id, 500_000, fixture.currency);
    await onboardCreator(token, fixture);

    const res = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: 2000, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-below-global-min') });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/minimum withdrawal amount/i);

    await seedCapability(fixture); // restore the shared PK fixture's default min for other tests
  });

  it('rejects an amount outside the country capability min/max BEFORE any hold is created', async () => {
    const fixture = COUNTRIES[0]!; // PK
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;
    await seedEarnings(creatorReg.body.user.id, 500_000_000, fixture.currency);
    await onboardCreator(token, fixture);

    const tooMuch = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: DEFAULT_CAPABILITY.maxPayoutMinorUnits + 1, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-over-max') });
    expect(tooMuch.status).toBe(400);
    expect(await getEarningsBalance(token)).toBe(500_000_000);
  });

  it('requires a VERIFIED payout method before withdrawing', async () => {
    const fixture = COUNTRIES[0]!;
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;
    await seedEarnings(creatorReg.body.user.id, 500_000, fixture.currency);

    const res = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: 100_000, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-no-payout-method') });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/bank account/i);
  });

  it('requires VERIFIED identity before withdrawing, even with a verified payout method', async () => {
    const fixture = COUNTRIES[0]!;
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;
    await seedEarnings(creatorReg.body.user.id, 500_000, fixture.currency);

    const addRes = await request(app)
      .post('/api/v1/creator/payout-method')
      .set('Authorization', `Bearer ${token}`)
      .send({ country: fixture.countryCode, currency: fixture.currency, accountHolderName: 'No KYC Creator', bankDetails: fixture.bankDetails });
    await prisma.creatorPayoutMethod.update({ where: { id: addRes.body.id }, data: { verifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    // Deliberately never starts identity verification.

    const res = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: 100_000, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-no-kyc') });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/identity/i);
  });
});

describe('Step 9 payouts — unsupported country / unconfigured provider (no fake availability)', () => {
  it('reports "unavailable" for a country with no CountryPayoutCapability row, never a hardcoded PK/IN/GB/US/DE-only assumption', async () => {
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;

    const schema = await request(app).get('/api/v1/creator/payout-method/schema').query({ country: 'JP', currency: 'JPY' }).set('Authorization', `Bearer ${token}`);
    expect(schema.status).toBe(503);

    const add = await request(app)
      .post('/api/v1/creator/payout-method')
      .set('Authorization', `Bearer ${token}`)
      .send({ country: 'JP', currency: 'JPY', accountHolderName: 'Unsupported Country Creator', bankDetails: { accountNumber: '123' } });
    expect(add.status).toBe(503);
  });

  it('reports "unavailable" for a country capability row that exists but is disabled — not just a missing row', async () => {
    const fixture: CountryFixture = { countryCode: 'FR', currency: 'EUR', provider: 'AIRWALLEX', expectedFieldKeys: [], bankDetails: { iban: 'FR1420041010050500013M02606' } };
    await seedCapability(fixture, { enabled: false });
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;

    const schema = await request(app).get('/api/v1/creator/payout-method/schema').query({ country: 'FR', currency: 'EUR' }).set('Authorization', `Bearer ${token}`);
    expect(schema.status).toBe(503);

    const add = await request(app)
      .post('/api/v1/creator/payout-method')
      .set('Authorization', `Bearer ${token}`)
      .send({ country: 'FR', currency: 'EUR', accountHolderName: 'Disabled Country Creator', bankDetails: fixture.bankDetails });
    expect(add.status).toBe(503);
  });

  it('a withdrawal against a payout method whose provider is no longer available server-side is refused as SERVICE_UNAVAILABLE, never silently retried against a different provider', async () => {
    const fixture = COUNTRIES[0]!; // PK
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;
    await seedEarnings(creatorReg.body.user.id, 500_000, fixture.currency);
    const { payoutMethodId } = await onboardCreator(token, fixture);

    // Simulate the provider becoming unavailable for this specific beneficiary (e.g. credentials revoked) — direct-Prisma, since no runtime toggle exists for "provider suddenly unconfigured" under NODE_ENV=test.
    await prisma.creatorPayoutMethod.update({ where: { id: payoutMethodId }, data: { providerBeneficiaryId: null } });

    const res = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinorUnits: 100_000, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-no-provider') });
    expect(res.status).toBe(503);
    expect(await getEarningsBalance(token)).toBe(500_000); // refused before any hold
  });
});

describe('Step 9 payouts — atomic concurrency (no double-spend)', () => {
  it('two concurrent withdrawal requests with DIFFERENT idempotency keys that together exceed the balance never both succeed', async () => {
    const fixture = COUNTRIES[3]!; // US
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;
    await seedEarnings(creatorReg.body.user.id, 100_000, fixture.currency); // exactly $1,000.00 available
    await onboardCreator(token, fixture);

    const bodyA = { amountMinorUnits: 70_000, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-race-a') };
    const bodyB = { amountMinorUnits: 70_000, currency: fixture.currency, idempotencyKey: uniqueSlug('withdraw-race-b') };

    const [a, b] = await Promise.all([
      request(app).post('/api/v1/creator/withdrawals').set('Authorization', `Bearer ${token}`).send(bodyA),
      request(app).post('/api/v1/creator/withdrawals').set('Authorization', `Bearer ${token}`).send(bodyB),
    ]);
    const statuses = [a.status, b.status].sort();
    // Both requesting $700 against a $1,000 balance can never both succeed ($1,400 > $1,000) — exactly one must be rejected as insufficient.
    expect(statuses).toEqual([201, 400]);

    const balance = await getEarningsBalance(token);
    expect(balance).toBe(30_000); // exactly one $700 hold applied against $1,000 — never a double-spend
  });

  it('two concurrent requests for the SAME idempotencyKey (a real double-tap) create exactly one withdrawal/hold', async () => {
    const fixture = COUNTRIES[3]!; // US
    await seedCapability(fixture);
    const { response: creatorReg } = await registerUser();
    const token = creatorReg.body.accessToken as string;
    await seedEarnings(creatorReg.body.user.id, 500_000, fixture.currency);
    await onboardCreator(token, fixture);

    const idempotencyKey = uniqueSlug('withdraw-concurrent-same-key');
    const body = { amountMinorUnits: 100_000, currency: fixture.currency, idempotencyKey };

    const [a, b] = await Promise.all([
      request(app).post('/api/v1/creator/withdrawals').set('Authorization', `Bearer ${token}`).send(body),
      request(app).post('/api/v1/creator/withdrawals').set('Authorization', `Bearer ${token}`).send(body),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);

    const balance = await getEarningsBalance(token);
    expect(balance).toBe(400_000); // held exactly once, not twice
  });
});

describe('Step 9 payouts — admin surface (exception-only, never routine approval)', () => {
  it('admin can create and update a country payout capability; a non-admin cannot', async () => {
    await prisma.countryPayoutCapability.deleteMany({ where: { countryCode: 'BR' } });
    const { response: adminReg } = await registerAdmin();
    const { response: creatorReg } = await registerUser();

    const forbidden = await request(app)
      .post('/api/v1/admin/payout-capabilities')
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`)
      .send({ countryCode: 'BR', currency: 'BRL', enabled: true, minPayoutMinorUnits: 5000, maxPayoutMinorUnits: 1_000_000, providerPriority: ['AIRWALLEX'] });
    expect(forbidden.status).toBe(403);

    const created = await request(app)
      .post('/api/v1/admin/payout-capabilities')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ countryCode: 'BR', currency: 'BRL', enabled: false, minPayoutMinorUnits: 5000, maxPayoutMinorUnits: 1_000_000, providerPriority: ['AIRWALLEX'] });
    expect(created.status).toBe(201);

    const updated = await request(app)
      .patch('/api/v1/admin/payout-capabilities/BR')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ enabled: true });
    expect(updated.status).toBe(200);

    const list = await request(app).get('/api/v1/admin/payout-capabilities').set('Authorization', `Bearer ${adminReg.body.accessToken}`);
    const brRow = list.body.capabilities.find((c: { countryCode: string }) => c.countryCode === 'BR');
    expect(brRow.enabled).toBe(true);
  });

  it('reports every payout/KYC provider that exists in code as configured-or-not, but NEVER claims vendor approval', async () => {
    const { response: adminReg } = await registerAdmin();
    const res = await request(app).get('/api/v1/admin/payout-providers/status').set('Authorization', `Bearer ${adminReg.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.payoutProviders.length).toBeGreaterThan(0);
    for (const provider of res.body.payoutProviders) {
      expect(provider.approvalStatus).toBe('REQUIRES_APPROVAL');
    }
    for (const provider of res.body.identityVerificationProviders) {
      expect(provider.approvalStatus).toBe('REQUIRES_APPROVAL');
    }
  });
});
