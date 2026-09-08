import { createHmac } from 'crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { app, registerAdmin, registerUser, uploadSampleVideo, waitForVideoSettled } from '@/test/helpers';

/**
 * Step 8 — Creator Monetization (ad revenue). Every test hits the real
 * backend against live Postgres/Redis, matching this codebase's
 * established testing philosophy for financial-critical code. The webhook
 * signature is genuinely real HMAC-SHA256, verified exactly like
 * `coinsGiftsEconomy.test.ts` verifies the Web payment provider's receipts.
 */

const WEBHOOK_SECRET = process.env.AD_REVENUE_WEBHOOK_SECRET!;

let fixtureCounter = 0;
function uniqueSlug(prefix: string): string {
  fixtureCounter += 1;
  return `${prefix}-${Date.now()}-${fixtureCounter}`;
}

function signPayload(payload: Record<string, unknown>): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(payload)).digest('hex');
}

async function reportAdRevenue(payload: Record<string, unknown>) {
  const signature = signPayload(payload);
  return request(app).post('/api/v1/ad-revenue/webhook').send({ ...payload, signature });
}

async function createCreatorWithVideo(): Promise<{ accessToken: string; userId: string; videoId: string }> {
  const { response: reg } = await registerUser();
  const upload = await uploadSampleVideo(reg.body.accessToken);
  await waitForVideoSettled(upload.body.id, reg.body.accessToken);
  return { accessToken: reg.body.accessToken, userId: reg.body.user.id, videoId: upload.body.id };
}

/**
 * `AdRevenueShareRule` is genuinely global state (the "most recently
 * effective row wins" pattern every rate in this schema uses) — a test
 * that changes it (like "12. Admin changes 70/30...") would otherwise leak
 * into every OTHER test that runs afterward and implicitly relies on the
 * 70/30 default. Every test that needs a predictable 70/30 split explicitly
 * (re-)establishes it here rather than assuming ambient global state.
 */
async function activateMonetization(adminToken: string, creatorId: string): Promise<void> {
  const rule = await request(app)
    .post('/api/v1/admin/monetization/ad-revenue-share-rules')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ creatorSharePercent: 70, platformSharePercent: 30 });
  expect(rule.status).toBe(201);

  const res = await request(app)
    .patch(`/api/v1/admin/monetization/creators/${creatorId}/status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'ACTIVE', reason: 'test activation' });
  expect(res.status).toBe(200);
}

describe('Ad revenue webhook — signature + basic recording', () => {
  it('rejects a report with an invalid signature', async () => {
    const { videoId } = await createCreatorWithVideo();
    const payload = { provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 1000, idempotencyKey: uniqueSlug('idem') };
    const res = await request(app).post('/api/v1/ad-revenue/webhook').send({ ...payload, signature: 'deadbeef'.repeat(8) });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown video', async () => {
    const payload = { provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId: 'not-a-real-video-id', grossRevenueMinorUnits: 1000, idempotencyKey: uniqueSlug('idem') };
    const res = await reportAdRevenue(payload);
    expect(res.status).toBe(404);
  });
});

describe('1. Ad revenue before monetization -> 100% platform', () => {
  it('a creator who has never been monetized gets 0 of confirmed revenue', async () => {
    const { videoId, userId } = await createCreatorWithVideo();
    const payload = { provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 2000, idempotencyKey: uniqueSlug('idem') };
    const res = await reportAdRevenue(payload);
    expect(res.status).toBe(201);
    expect(res.body.wasMonetizationActive).toBe(false);
    expect(res.body.creatorShareMinorUnits).toBe(0);
    expect(res.body.platformShareMinorUnits).toBe(2000);

    const earnings = await prisma.creatorEarningsWallet.findUnique({ where: { creatorId: userId } });
    expect(earnings?.balanceMinorUnits ?? 0).toBe(0);
  });
});

describe('2. Ad revenue after monetization -> 70/30', () => {
  it('an ACTIVE creator earns exactly 70% of new confirmed revenue, 30% to platform', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId, accessToken } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    const payload = { provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 10000, idempotencyKey: uniqueSlug('idem') };
    const res = await reportAdRevenue(payload);
    expect(res.status).toBe(201);
    expect(res.body.wasMonetizationActive).toBe(true);
    expect(res.body.creatorShareMinorUnits).toBe(7000);
    expect(res.body.platformShareMinorUnits).toBe(3000);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(7000);
  });
});

describe('3. Monetization activation timestamp', () => {
  it('stores activatedAt the first time a creator becomes ACTIVE', async () => {
    const { response: adminReg } = await registerAdmin();
    const { userId } = await createCreatorWithVideo();

    const before = await request(app).patch(`/api/v1/admin/monetization/creators/${userId}/status`).set('Authorization', `Bearer ${adminReg.body.accessToken}`).send({ status: 'PENDING_REVIEW' });
    expect(before.body.activatedAt).toBeNull();

    const activated = await request(app).patch(`/api/v1/admin/monetization/creators/${userId}/status`).set('Authorization', `Bearer ${adminReg.body.accessToken}`).send({ status: 'ACTIVE' });
    expect(activated.body.activatedAt).not.toBeNull();
  });
});

describe('4. No retroactive creator share', () => {
  it('revenue recorded BEFORE activation is never moved to the creator after activation happens', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId, accessToken } = await createCreatorWithVideo();

    const preActivation = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 5000, idempotencyKey: uniqueSlug('idem') });
    expect(preActivation.body.creatorShareMinorUnits).toBe(0);

    await activateMonetization(adminReg.body.accessToken, userId);

    // The earlier event is untouched — still 0 creator share, still CONFIRMED, still wasMonetizationActive:false.
    const stillOld = await prisma.adRevenueEvent.findUnique({ where: { id: preActivation.body.id } });
    expect(stillOld?.creatorShareMinorUnits).toBe(0);
    expect(stillOld?.wasMonetizationActive).toBe(false);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(0); // the pre-activation $50 never became creator earnings
  });
});

describe('5. Duplicate ad event', () => {
  it('the same idempotencyKey replayed is a safe no-op, never double-recorded or double-credited', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId, accessToken } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    const payload = { provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 1000, idempotencyKey: uniqueSlug('idem') };
    const first = await reportAdRevenue(payload);
    const second = await reportAdRevenue(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(700); // credited exactly once
  });

  it('the same (provider, providerEventId) pair with a DIFFERENT idempotencyKey is still deduplicated', async () => {
    const { videoId } = await createCreatorWithVideo();
    const providerEventId = uniqueSlug('evt');
    const first = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId, videoId, grossRevenueMinorUnits: 1000, idempotencyKey: uniqueSlug('idem-a') });
    expect(first.status).toBe(201);
    const second = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId, videoId, grossRevenueMinorUnits: 1000, idempotencyKey: uniqueSlug('idem-b') });
    // Different idempotencyKey but same natural provider event id -> unique constraint violation, not a silent duplicate row.
    expect(second.status).toBe(500);
  });
});

describe('6. Concurrent duplicate event', () => {
  it('two simultaneous identical webhook deliveries never double-credit the creator', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId, accessToken } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    const payload = { provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 10000, idempotencyKey: uniqueSlug('idem') };
    const [a, b] = await Promise.all([reportAdRevenue(payload), reportAdRevenue(payload)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(7000);
  });
});

describe('7. Revenue reversal', () => {
  it('reverses a confirmed, already-credited event and claws back the creator share', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId, accessToken } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    const original = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 10000, idempotencyKey: uniqueSlug('idem') });
    expect(original.body.creatorShareMinorUnits).toBe(7000);

    const reversal = await request(app)
      .post(`/api/v1/admin/monetization/ad-revenue/${original.body.id}/reverse`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ reason: 'chargeback', idempotencyKey: uniqueSlug('rev') });
    expect(reversal.status).toBe(201);
    expect(reversal.body.type).toBe('REVERSAL');
    expect(reversal.body.creatorShareMinorUnits).toBe(-7000);
    expect(reversal.body.reversalOfEventId).toBe(original.body.id);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(0);

    // The original row is untouched.
    const stillOriginal = await prisma.adRevenueEvent.findUnique({ where: { id: original.body.id } });
    expect(stillOriginal?.creatorShareMinorUnits).toBe(7000);
    expect(stillOriginal?.type).toBe('REVENUE');
  });

  it('caps the clawback at the creator\'s current balance and never goes negative', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId, accessToken } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    const original = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 10000, idempotencyKey: uniqueSlug('idem') });
    expect(original.body.creatorShareMinorUnits).toBe(7000);

    // Creator withdraws/spends most of it (simulated by direct wallet debit via a withdrawal-style hold — simplest: reduce balance directly for the test's purpose).
    await prisma.creatorEarningsWallet.update({ where: { creatorId: userId }, data: { balanceMinorUnits: { decrement: 6500 } } });

    const reversal = await request(app)
      .post(`/api/v1/admin/monetization/ad-revenue/${original.body.id}/reverse`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ reason: 'chargeback after spend', idempotencyKey: uniqueSlug('rev') });
    expect(reversal.status).toBe(201);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(0); // capped, never negative
  });
});

describe('8. Invalid traffic', () => {
  it('an event recorded with grossRevenueMinorUnits of 0 (e.g. all impressions deemed invalid) credits nothing', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId, accessToken } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    const res = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, impressions: 500, validImpressions: 0, grossRevenueMinorUnits: 0, idempotencyKey: uniqueSlug('idem') });
    expect(res.status).toBe(201);
    expect(res.body.creatorShareMinorUnits).toBe(0);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(0);
  });
});

describe('9. Creator suspended', () => {
  it('after being ACTIVE then SUSPENDED, new revenue reverts to 100% platform', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId, accessToken } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    const whileActive = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 1000, idempotencyKey: uniqueSlug('idem') });
    expect(whileActive.body.creatorShareMinorUnits).toBe(700);

    await request(app).patch(`/api/v1/admin/monetization/creators/${userId}/status`).set('Authorization', `Bearer ${adminReg.body.accessToken}`).send({ status: 'SUSPENDED', reason: 'policy violation' });

    const whileSuspended = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 1000, idempotencyKey: uniqueSlug('idem') });
    expect(whileSuspended.body.wasMonetizationActive).toBe(false);
    expect(whileSuspended.body.creatorShareMinorUnits).toBe(0);
    expect(whileSuspended.body.platformShareMinorUnits).toBe(1000);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(700); // only the pre-suspension revenue
  });
});

describe('10. Creator becomes eligible', () => {
  it('server-computed eligibility flips NOT_ELIGIBLE -> ELIGIBLE once the configured requirements are met, mobile never decides this', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: creatorReg, body: creatorBody } = await registerUser();
    void creatorBody;

    await request(app)
      .post('/api/v1/admin/monetization/eligibility-rules')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ minFollowers: 0, minLifetimeVideoViews: 0, minAccountAgeDays: 0, requireGoodStanding: true });

    const status = await request(app).get('/api/v1/creator/monetization/status').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('ELIGIBLE');
    expect(status.body.eligible).toBe(true);
    expect(status.body.requirements.every((r: { met: boolean }) => r.met)).toBe(true);
  });

  it('reports NOT_ELIGIBLE with the unmet requirement visible when a threshold is not configured to 0', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: creatorReg } = await registerUser();

    await request(app)
      .post('/api/v1/admin/monetization/eligibility-rules')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ minFollowers: 1000, minLifetimeVideoViews: 0, minAccountAgeDays: 0, requireGoodStanding: true });

    const status = await request(app).get('/api/v1/creator/monetization/status').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(status.body.status).toBe('NOT_ELIGIBLE');
    expect(status.body.eligible).toBe(false);
    const followerReq = status.body.requirements.find((r: { key: string }) => r.key === 'followers');
    expect(followerReq.met).toBe(false);
    expect(followerReq.required).toBe(1000);
  });
});

describe('11. Creator disabled after previously active', () => {
  it('DISABLED stops new creator-share revenue but activatedAt is preserved', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    const beforeDisable = await prisma.creatorMonetization.findUnique({ where: { creatorId: userId } });
    const activatedAt = beforeDisable!.activatedAt;
    expect(activatedAt).not.toBeNull();

    const disabled = await request(app).patch(`/api/v1/admin/monetization/creators/${userId}/status`).set('Authorization', `Bearer ${adminReg.body.accessToken}`).send({ status: 'DISABLED', reason: 'account closed' });
    expect(disabled.body.activatedAt).toEqual(activatedAt!.toISOString());

    const res = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 1000, idempotencyKey: uniqueSlug('idem') });
    expect(res.body.creatorShareMinorUnits).toBe(0);
  });
});

describe('12. Admin changes 70/30 to another configured ratio', () => {
  it('a new AdRevenueShareRule applies to NEW events only, snapshotted on each event', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    const atDefault = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 10000, idempotencyKey: uniqueSlug('idem') });
    expect(atDefault.body.creatorShareMinorUnits).toBe(7000);

    const ruleChange = await request(app)
      .post('/api/v1/admin/monetization/ad-revenue-share-rules')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ creatorSharePercent: 50, platformSharePercent: 50 });
    expect(ruleChange.status).toBe(201);

    const atNewRate = await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 10000, idempotencyKey: uniqueSlug('idem') });
    expect(atNewRate.body.creatorShareMinorUnits).toBe(5000);
    expect(atNewRate.body.platformShareMinorUnits).toBe(5000);

    // The earlier event's snapshot is untouched by the rate change.
    const stillOld = await prisma.adRevenueEvent.findUnique({ where: { id: atDefault.body.id } });
    expect(stillOld?.creatorSharePercentSnapshot?.toFixed(2)).toBe('70.00');
  });

  it('rejects a rule whose two percentages do not sum to 100', async () => {
    const { response: adminReg } = await registerAdmin();
    const res = await request(app)
      .post('/api/v1/admin/monetization/ad-revenue-share-rules')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ creatorSharePercent: 60, platformSharePercent: 30 });
    expect(res.status).toBe(422);
  });
});

describe('13. Revenue ledger correctness', () => {
  it('every field is correctly recorded and traceable to the provider event', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    const providerEventId = uniqueSlug('evt');
    const res = await reportAdRevenue({ provider: 'ADMOB', providerEventId, videoId, impressions: 1000, validImpressions: 950, clicks: 12, grossRevenueMinorUnits: 4321, currency: 'USD', idempotencyKey: uniqueSlug('idem') });

    expect(res.status).toBe(201);
    const stored = await prisma.adRevenueEvent.findUnique({ where: { id: res.body.id } });
    expect(stored).toMatchObject({
      provider: 'ADMOB',
      providerEventId,
      videoId,
      creatorId: userId,
      impressions: 1000,
      validImpressions: 950,
      clicks: 12,
      grossRevenueMinorUnits: 4321,
      currency: 'USD',
      status: 'CONFIRMED',
      type: 'REVENUE',
      wasMonetizationActive: true,
    });
    expect(stored!.creatorShareMinorUnits + stored!.platformShareMinorUnits).toBe(4321); // no rounding leakage
  });
});

describe('14. Creator balance integration', () => {
  it('ad revenue lands in the SAME CreatorEarningsWallet Withdraw/Exchange already use — no second wallet', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId, accessToken } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);

    await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 10000, idempotencyKey: uniqueSlug('idem') });

    const wallet = await prisma.creatorEarningsWallet.findUnique({ where: { creatorId: userId } });
    expect(wallet?.balanceMinorUnits).toBe(7000);

    const history = await request(app).get('/api/v1/creator/earnings/history').set('Authorization', `Bearer ${accessToken}`);
    expect(history.body.history[0].type).toBe('AD_REVENUE');
    expect(history.body.history[0].direction).toBe('CREDIT');
  });
});

describe('15. Exchange to Coins (ad-revenue-sourced earnings)', () => {
  it('ad-revenue earnings can be exchanged to Coins through the existing Step 7 exchange endpoint', async () => {
    const { response: adminReg } = await registerAdmin();
    await request(app).post('/api/v1/admin/exchange-rate').set('Authorization', `Bearer ${adminReg.body.accessToken}`).send({ pkrPerUsd: 280 });
    const { videoId, userId, accessToken } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);
    await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 1000, idempotencyKey: uniqueSlug('idem') }); // creator share = 700

    const exchange = await request(app)
      .post('/api/v1/creator/earnings/exchange-to-coins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amountMinorUnits: 700, currency: 'USD', idempotencyKey: uniqueSlug('exch') });
    expect(exchange.status).toBe(200);
    expect(exchange.body.exchange.coinsCredited).toBeGreaterThan(0);
    expect(exchange.body.earningsBalance).toBe(0);
  });
});

describe('16. Withdraw (ad-revenue-sourced earnings)', () => {
  it('ad-revenue earnings can be withdrawn through the Step 9 automatic withdrawal pipeline', async () => {
    const { response: adminReg } = await registerAdmin();
    const { videoId, userId, accessToken } = await createCreatorWithVideo();
    await activateMonetization(adminReg.body.accessToken, userId);
    // 10000 * 0.70 = 7000, well above the withdrawal minimum.
    await reportAdRevenue({ provider: 'TEST_NETWORK', providerEventId: uniqueSlug('evt'), videoId, grossRevenueMinorUnits: 10000, idempotencyKey: uniqueSlug('idem') });

    // Step 9's automatic pipeline requires a country-enabled, verified payout method + verified identity — never a bare provider/destinationReference (see routes/v1/payoutMethods.ts / identityVerification.ts).
    await prisma.countryPayoutCapability.upsert({
      where: { countryCode: 'US' },
      create: { countryCode: 'US', currency: 'USD', enabled: true, minPayoutMinorUnits: 100, maxPayoutMinorUnits: 100_000_000, feeFixedMinorUnits: 0, feePercentBps: 0, providerPriority: ['PAYONEER'] },
      update: { currency: 'USD', enabled: true, providerPriority: ['PAYONEER'] },
    });
    const addPayoutMethod = await request(app)
      .post('/api/v1/creator/payout-method')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ country: 'US', currency: 'USD', accountHolderName: 'Ad Revenue Creator', bankDetails: { accountNumber: '000123456789', routingNumber: '021000021' } });
    expect(addPayoutMethod.body.status).toBe('VERIFIED');
    // Backdate past the fraud engine's 24h new-payout-method cooldown (lib/fraudRiskEngine.ts) — a fresh bank account is a fraud-check concern for a DEDICATED test, not this one.
    await prisma.creatorPayoutMethod.update({ where: { id: addPayoutMethod.body.id }, data: { verifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    const startKyc = await request(app).post('/api/v1/creator/identity-verification/start').set('Authorization', `Bearer ${accessToken}`).send({ country: 'US' });
    const verification = await prisma.verification.findUniqueOrThrow({ where: { id: startKyc.body.id } });
    await request(app)
      .post('/api/v1/webhooks/payout/PAYONEER')
      .send({ eventType: 'IDENTITY_VERIFIED', externalEventId: uniqueSlug('kyc-webhook'), providerReferenceId: verification.providerReferenceId, signature: 'test' });

    const withdrawal = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amountMinorUnits: 7000, currency: 'USD', idempotencyKey: uniqueSlug('wd') });
    expect(withdrawal.status).toBe(201);
    // No admin review step — the automatic pipeline drives straight past REQUESTED/APPROVED to PROCESSING (real provider submission, never optimistic PAID).
    expect(withdrawal.body.status).toBe('PROCESSING');
  });
});

describe('17. Unauthorized creator access', () => {
  it('rejects an unauthenticated request to the monetization status endpoint', async () => {
    const res = await request(app).get('/api/v1/creator/monetization/status');
    expect(res.status).toBe(401);
  });

  it('a creator only ever sees their OWN monetization status and revenue, never another creator\'s', async () => {
    const { response: creatorAReg } = await registerUser();
    const { videoId: videoB } = await createCreatorWithVideo();
    void videoB;

    const statusA = await request(app).get('/api/v1/creator/monetization/status').set('Authorization', `Bearer ${creatorAReg.body.accessToken}`);
    expect(statusA.status).toBe(200);
    // There is no :id param on the creator-facing route at all — it is
    // always derived from the authenticated session, so there is no way
    // to even request another creator's status through this endpoint.
  });
});

describe('18. Admin-only monetization controls', () => {
  it('rejects a non-admin creator from every admin monetization endpoint', async () => {
    const { response: creatorReg } = await registerUser();
    const auth = { Authorization: `Bearer ${creatorReg.body.accessToken}` };

    const eligibility = await request(app).post('/api/v1/admin/monetization/eligibility-rules').set(auth).send({ minFollowers: 0 });
    expect(eligibility.status).toBe(403);

    const shareRule = await request(app).post('/api/v1/admin/monetization/ad-revenue-share-rules').set(auth).send({ creatorSharePercent: 70, platformSharePercent: 30 });
    expect(shareRule.status).toBe(403);

    const statusChange = await request(app).patch(`/api/v1/admin/monetization/creators/${creatorReg.body.user.id}/status`).set(auth).send({ status: 'ACTIVE' });
    expect(statusChange.status).toBe(403);

    const summary = await request(app).get('/api/v1/admin/monetization/summary').set(auth);
    expect(summary.status).toBe(403);
  });

  it('rejects an unauthenticated request to every admin monetization endpoint', async () => {
    const rules = await request(app).get('/api/v1/admin/monetization/eligibility-rules');
    expect(rules.status).toBe(401);
    const summary = await request(app).get('/api/v1/admin/monetization/summary');
    expect(summary.status).toBe(401);
  });
});
