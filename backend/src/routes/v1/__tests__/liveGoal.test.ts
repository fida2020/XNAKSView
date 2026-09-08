import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, registerAdmin, registerUser } from '@/test/helpers';

/**
 * LIVE Goal (Step 3/rebuild) — a real Coin-spend target the host can set
 * when starting a session, incremented server-side only by real Gift sends
 * (see lib/giftService.ts), never a client-reported or timer-simulated
 * value. This exercises the actual HTTP surface end to end against the
 * real backend/Postgres, no mocks.
 */

let fixtureCounter = 0;
function uniqueSlug(prefix: string): string {
  fixtureCounter += 1;
  return `${prefix}-${Date.now()}-${fixtureCounter}`;
}

async function setupEconomyFixtures(adminToken: string) {
  await request(app).post('/api/v1/admin/exchange-rate').set('Authorization', `Bearer ${adminToken}`).send({ pkrPerUsd: 280 });
  await request(app).post('/api/v1/admin/coin-packages').set('Authorization', `Bearer ${adminToken}`).send({ baseUsdPrice: 1, taxUsd: 0, feeUsd: 0, active: true, sortOrder: 1 });
  const giftSlug = uniqueSlug('rose');
  await request(app)
    .post('/api/v1/admin/gifts')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Rose', slug: giftSlug, coinCost: 10, category: 'APPRECIATION', maxQuantityPerSend: 50 });
  await request(app).post('/api/v1/admin/diamond-earn-rate').set('Authorization', `Bearer ${adminToken}`).send({ coinsPerDiamond: 5 });
  await request(app).post('/api/v1/admin/platform-revenue-rules').set('Authorization', `Bearer ${adminToken}`).send({ platformSharePercent: 50, applicableContext: 'GIFT' });
  return { giftSlug };
}

async function fundCoins(accessToken: string, packageId: string): Promise<void> {
  const idempotencyKey = uniqueSlug('purchase');
  const create = await request(app).post('/api/v1/coins/purchases').set('Authorization', `Bearer ${accessToken}`).send({ packageId, provider: 'WEB', idempotencyKey });
  const transactionId = uniqueSlug('txn');
  const { createHmac } = await import('crypto');
  const secret = process.env.WEB_PAYMENT_WEBHOOK_SECRET!;
  const signature = createHmac('sha256', secret).update(`${transactionId}:100`).digest('hex');
  await request(app)
    .post(`/api/v1/coins/purchases/${create.body.purchaseId}/verify`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ receipt: JSON.stringify({ transactionId, amountUsdCents: 100, signature }) });
}

describe('LIVE Goal — real, Gift-driven progress', () => {
  it('a session started with a goal target tracks real progress as real Gifts arrive, never faster or slower than the actual Coins sent', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);

    const { response: hostReg } = await registerUser();
    const { response: viewerReg } = await registerUser();

    const started = await request(app)
      .post('/api/v1/live')
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .field('title', 'Goal stream')
      .field('goalTitle', 'Reach 20 Coins!')
      .field('goalTargetCoins', '20');
    expect(started.status).toBe(201);
    const liveSessionId: string = started.body.liveSession.id;
    expect(started.body.liveSession.goalEnabled).toBe(true);
    expect(started.body.liveSession.goalTitle).toBe('Reach 20 Coins!');
    expect(started.body.liveSession.goalTargetCoins).toBe(20);
    expect(started.body.liveSession.goalProgressCoins).toBe(0);

    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
    await fundCoins(viewerReg.body.accessToken, packages.body.packages[0].id);

    const firstGift = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, liveSessionId, idempotencyKey: uniqueSlug('gift') });
    expect(firstGift.status).toBe(201);
    expect(firstGift.body.totalCoins).toBe(10);

    const afterFirst = await request(app).get(`/api/v1/live/${liveSessionId}`).set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(afterFirst.body.goalProgressCoins).toBe(10);

    const secondGift = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, liveSessionId, idempotencyKey: uniqueSlug('gift') });
    expect(secondGift.status).toBe(201);

    const afterSecond = await request(app).get(`/api/v1/live/${liveSessionId}`).set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(afterSecond.body.goalProgressCoins).toBe(20);
  });

  it('a session started with no goal target never enables a goal, and Gifts sent to it never create bogus progress', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const { response: hostReg } = await registerUser();
    const { response: viewerReg } = await registerUser();

    const started = await request(app).post('/api/v1/live').set('Authorization', `Bearer ${hostReg.body.accessToken}`).field('title', 'No-goal stream');
    expect(started.status).toBe(201);
    expect(started.body.liveSession.goalEnabled).toBe(false);
    expect(started.body.liveSession.goalTargetCoins).toBeNull();

    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
    await fundCoins(viewerReg.body.accessToken, packages.body.packages[0].id);
    await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, liveSessionId: started.body.liveSession.id, idempotencyKey: uniqueSlug('gift') });

    const after = await request(app).get(`/api/v1/live/${started.body.liveSession.id}`).set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(after.body.goalEnabled).toBe(false);
    expect(after.body.goalProgressCoins).toBe(0);
  });
});
