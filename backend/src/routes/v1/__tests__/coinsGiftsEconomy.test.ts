import { createHmac } from 'crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { calculateCoinPricing } from '@/lib/coinEconomy';
import { prisma } from '@/lib/prisma';
import { requestWithdrawal } from '@/lib/withdrawalService';
import { app, registerAdmin, registerUser, uploadSampleVideo, waitForVideoSettled } from '@/test/helpers';

/**
 * Step 7 — Coins, Gifts, Diamonds, Creator Earnings, Withdrawal. Every test
 * here hits the real backend against live Postgres/Redis, no mocks, matching
 * this codebase's established testing philosophy for financial-critical
 * code. The `WebPaymentProvider`'s HMAC verification is genuinely real and
 * fully exercised (see .env's local WEB_PAYMENT_WEBHOOK_SECRET) — App
 * Store/Google Play are only exercised for their honest "not configured"
 * refusal, since no real credentials exist in this environment.
 */

const WEB_SECRET = process.env.WEB_PAYMENT_WEBHOOK_SECRET!;

function signWebReceipt(transactionId: string, amountUsdCents: number): string {
  const signature = createHmac('sha256', WEB_SECRET).update(`${transactionId}:${amountUsdCents}`).digest('hex');
  return JSON.stringify({ transactionId, amountUsdCents, signature });
}

let fixtureCounter = 0;
function uniqueSlug(prefix: string): string {
  fixtureCounter += 1;
  return `${prefix}-${Date.now()}-${fixtureCounter}`;
}

/** Configures a fresh, self-consistent economy (rate, package, gift, Diamond/platform rules) as an admin — every test that needs to spend or earn Coins/Diamonds starts from this. */
async function setupEconomyFixtures(adminToken: string) {
  const rateRes = await request(app).post('/api/v1/admin/exchange-rate').set('Authorization', `Bearer ${adminToken}`).send({ pkrPerUsd: 280 });
  expect(rateRes.status).toBe(201);

  const pkgRes = await request(app).post('/api/v1/admin/coin-packages').set('Authorization', `Bearer ${adminToken}`).send({ baseUsdPrice: 1, taxUsd: 0, feeUsd: 0, active: true, sortOrder: 1 });
  expect(pkgRes.status).toBe(201);

  const giftSlug = uniqueSlug('rose');
  const giftRes = await request(app).post('/api/v1/admin/gifts').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Rose', slug: giftSlug, coinCost: 10, category: 'APPRECIATION', maxQuantityPerSend: 50 });
  expect(giftRes.status).toBe(201);

  const earnRateRes = await request(app).post('/api/v1/admin/diamond-earn-rate').set('Authorization', `Bearer ${adminToken}`).send({ coinsPerDiamond: 5 });
  expect(earnRateRes.status).toBe(201);

  const revenueRuleRes = await request(app).post('/api/v1/admin/platform-revenue-rules').set('Authorization', `Bearer ${adminToken}`).send({ platformSharePercent: 50, applicableContext: 'GIFT' });
  expect(revenueRuleRes.status).toBe(201);

  const rewardRateRes = await request(app).post('/api/v1/admin/diamond-reward-rates').set('Authorization', `Bearer ${adminToken}`).send({ diamondsRequired: 100, rewardCurrency: 'USD', rewardAmount: 5 });
  expect(rewardRateRes.status).toBe(201);

  return { giftSlug };
}

async function purchaseAndCreditCoins(accessToken: string, packageId: string, amountUsdCents = 100): Promise<number> {
  const idempotencyKey = uniqueSlug('purchase');
  const create = await request(app).post('/api/v1/coins/purchases').set('Authorization', `Bearer ${accessToken}`).send({ packageId, provider: 'WEB', idempotencyKey });
  expect(create.status).toBe(201);

  const transactionId = uniqueSlug('txn');
  const receipt = signWebReceipt(transactionId, amountUsdCents);
  const verify = await request(app).post(`/api/v1/coins/purchases/${create.body.purchaseId}/verify`).set('Authorization', `Bearer ${accessToken}`).send({ receipt });
  expect(verify.status).toBe(200);
  expect(verify.body.status).toBe('COINS_CREDITED');
  return verify.body.balance;
}

describe('Coin economy (unit)', () => {
  it('computes the locked 1 Coin = PKR 1.50 rate, rounding DOWN', () => {
    const pricing = calculateCoinPricing({ baseUsdPrice: 1, taxUsd: 0, feeUsd: 0 }, 280);
    expect(pricing.coinValuePkr.toFixed(2)).toBe('1.50');
    expect(pricing.coinAmount).toBe(186); // floor(280 / 1.5) = 186.67 -> 186

    expect(calculateCoinPricing({ baseUsdPrice: 5, taxUsd: 0, feeUsd: 0 }, 280).coinAmount).toBe(933);
    expect(calculateCoinPricing({ baseUsdPrice: 10, taxUsd: 0, feeUsd: 0 }, 280).coinAmount).toBe(1866);
    expect(calculateCoinPricing({ baseUsdPrice: 20, taxUsd: 0, feeUsd: 0 }, 280).coinAmount).toBe(3733);
    expect(calculateCoinPricing({ baseUsdPrice: 50, taxUsd: 0, feeUsd: 0 }, 280).coinAmount).toBe(9333);
    expect(calculateCoinPricing({ baseUsdPrice: 100, taxUsd: 0, feeUsd: 0 }, 280).coinAmount).toBe(18666);
  });

  it('never grants more Coins than the payment covers when the division does not land evenly', () => {
    // 3 USD * 280 / 1.5 = 560 exactly; nudge the rate so it doesn't divide evenly.
    const pricing = calculateCoinPricing({ baseUsdPrice: 3, taxUsd: 0, feeUsd: 0 }, 280.37);
    const exact = (3 * 280.37) / 1.5;
    expect(pricing.coinAmount).toBeLessThanOrEqual(exact);
    expect(pricing.coinAmount).toBe(Math.floor(exact));
  });
});

describe('Coin purchase lifecycle', () => {
  it('freezes a permanent pricing snapshot on the purchase, independent of later rate changes', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: userReg } = await registerUser();
    await setupEconomyFixtures(adminReg.body.accessToken);

    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(packages.status).toBe(200);
    const pkg = packages.body.packages[0];
    expect(pkg.coinAmount).toBe(186);

    const balanceBefore = await purchaseAndCreditCoins(userReg.body.accessToken, pkg.id);
    expect(balanceBefore).toBe(186);

    const purchases = await request(app).get('/api/v1/coins/purchases').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(purchases.body.purchases[0].status).toBe('COINS_CREDITED');
    expect(purchases.body.purchases[0].coinAmount).toBe(186);
    expect(purchases.body.purchases[0].exchangeRatePkrPerUsd).toBe('280.0000');

    // Admin changes the rate — the ALREADY-CREDITED purchase's snapshot must never change.
    await request(app).post('/api/v1/admin/exchange-rate').set('Authorization', `Bearer ${adminReg.body.accessToken}`).send({ pkrPerUsd: 300 });
    const purchasesAfter = await request(app).get('/api/v1/coins/purchases').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(purchasesAfter.body.purchases[0].exchangeRatePkrPerUsd).toBe('280.0000');
    expect(purchasesAfter.body.purchases[0].coinAmount).toBe(186);

    // But a fresh package listing DOES reflect the new current rate.
    const packagesAfter = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(packagesAfter.body.packages[0].coinAmount).toBe(200); // floor(300/1.5)=200
  });

  it('rejects an incorrectly-signed receipt and never credits Coins', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: userReg } = await registerUser();
    await setupEconomyFixtures(adminReg.body.accessToken);

    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    const pkg = packages.body.packages[0];

    const create = await request(app).post('/api/v1/coins/purchases').set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ packageId: pkg.id, provider: 'WEB', idempotencyKey: uniqueSlug('bad-purchase') });

    const tamperedReceipt = JSON.stringify({ transactionId: 'txn-1', amountUsdCents: 100, signature: 'not-a-real-signature' });
    const verify = await request(app).post(`/api/v1/coins/purchases/${create.body.purchaseId}/verify`).set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ receipt: tamperedReceipt });
    expect(verify.status).toBe(400);

    const balance = await request(app).get('/api/v1/coins/balance').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(balance.body.balance).toBe(0);
  });

  it('honestly refuses App Store verification when no shared secret is configured (never fakes success)', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: userReg } = await registerUser();
    await setupEconomyFixtures(adminReg.body.accessToken);

    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    const pkg = packages.body.packages[0];

    const create = await request(app).post('/api/v1/coins/purchases').set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ packageId: pkg.id, provider: 'APP_STORE', idempotencyKey: uniqueSlug('appstore-purchase') });
    expect(create.status).toBe(201);

    const verify = await request(app).post(`/api/v1/coins/purchases/${create.body.purchaseId}/verify`).set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ receipt: 'irrelevant-receipt-data' });
    expect(verify.status).toBe(400);
    expect(verify.body.error.message).toMatch(/not configured/i);
  });

  it('is idempotent under a retried verify call — never double-credits', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: userReg } = await registerUser();
    await setupEconomyFixtures(adminReg.body.accessToken);

    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    const pkg = packages.body.packages[0];

    const idempotencyKey = uniqueSlug('retry-purchase');
    const create = await request(app).post('/api/v1/coins/purchases').set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ packageId: pkg.id, provider: 'WEB', idempotencyKey });

    const transactionId = uniqueSlug('retry-txn');
    const receipt = signWebReceipt(transactionId, 100);

    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/coins/purchases/${create.body.purchaseId}/verify`).set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ receipt }),
      request(app).post(`/api/v1/coins/purchases/${create.body.purchaseId}/verify`).set('Authorization', `Bearer ${userReg.body.accessToken}`).send({ receipt }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);

    const balance = await request(app).get('/api/v1/coins/balance').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(balance.body.balance).toBe(186); // not 372
  });

  it('separates Coin History (every ledger event) from Transaction History (purchases only)', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: userReg } = await registerUser();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    await purchaseAndCreditCoins(userReg.body.accessToken, packages.body.packages[0].id);

    const { response: creatorReg } = await registerUser();
    const upload = await uploadSampleVideo(creatorReg.body.accessToken);
    const settled = await waitForVideoSettled(upload.body.id, creatorReg.body.accessToken);
    expect(settled.body.status).toBe('READY');

    await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, videoId: upload.body.id, idempotencyKey: uniqueSlug('gift') });

    const coinHistory = await request(app).get('/api/v1/coins/history').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    const types = coinHistory.body.history.map((h: { type: string }) => h.type);
    expect(types).toEqual(expect.arrayContaining(['PURCHASE', 'GIFT_SENT']));

    const transactionHistory = await request(app).get('/api/v1/coins/purchases').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(transactionHistory.body.purchases).toHaveLength(1); // the purchase only, not the Gift spend
  });
});

describe('Sending Gifts', () => {
  async function fundedSender() {
    const { response: userReg } = await registerUser();
    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    await purchaseAndCreditCoins(userReg.body.accessToken, packages.body.packages[0].id);
    return userReg;
  }

  it('debits the sender, attributes the Gift, splits platform/creator share, and credits Diamonds via the current rate', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const senderReg = await fundedSender();
    const { response: creatorReg } = await registerUser();

    const upload = await uploadSampleVideo(creatorReg.body.accessToken);
    await waitForVideoSettled(upload.body.id, creatorReg.body.accessToken);

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 2, videoId: upload.body.id, idempotencyKey: uniqueSlug('gift') });
    expect(send.status).toBe(201);
    expect(send.body.totalCoins).toBe(20); // coinCost 10 * quantity 2
    expect(send.body.platformSharePercent).toBe('50.00');
    expect(send.body.diamondsCredited).toBe(2); // creatorShare 10 / coinsPerDiamond 5
    expect(send.body.senderBalance).toBe(186 - 20);

    const diamonds = await request(app).get('/api/v1/creator/diamonds').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(diamonds.body.balance).toBe(2);
  });

  it('rejects sending to yourself', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const senderReg = await fundedSender();

    const upload = await uploadSampleVideo(senderReg.body.accessToken);
    await waitForVideoSettled(upload.body.id, senderReg.body.accessToken);

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, videoId: upload.body.id, idempotencyKey: uniqueSlug('self-gift') });
    expect(send.status).toBe(400);
  });

  it('rejects a Gift when the creator has disabled Gifts on that video', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const senderReg = await fundedSender();
    const { response: creatorReg } = await registerUser();

    const upload = await uploadSampleVideo(creatorReg.body.accessToken);
    await waitForVideoSettled(upload.body.id, creatorReg.body.accessToken);
    await request(app).patch(`/api/v1/videos/${upload.body.id}`).set('Authorization', `Bearer ${creatorReg.body.accessToken}`).send({ allowGifts: false });

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, videoId: upload.body.id, idempotencyKey: uniqueSlug('disabled-gift') });
    expect(send.status).toBe(403);
  });

  it('rejects a Gift between blocked accounts', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const senderReg = await fundedSender();
    const { response: creatorReg } = await registerUser();

    const upload = await uploadSampleVideo(creatorReg.body.accessToken);
    await waitForVideoSettled(upload.body.id, creatorReg.body.accessToken);
    await request(app).post(`/api/v1/users/${senderReg.body.user.id}/block`).set('Authorization', `Bearer ${creatorReg.body.accessToken}`);

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, videoId: upload.body.id, idempotencyKey: uniqueSlug('blocked-gift') });
    expect(send.status).toBe(403);
  });

  it('returns INSUFFICIENT_COINS and writes nothing when the sender cannot afford the Gift', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const { response: senderReg } = await registerUser(); // no purchase — 0 balance
    const { response: creatorReg } = await registerUser();

    const upload = await uploadSampleVideo(creatorReg.body.accessToken);
    await waitForVideoSettled(upload.body.id, creatorReg.body.accessToken);

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, videoId: upload.body.id, idempotencyKey: uniqueSlug('poor-gift') });
    expect(send.status).toBe(402);
    expect(send.body.error.code).toBe('INSUFFICIENT_COINS');

    const history = await request(app).get('/api/v1/coins/history').set('Authorization', `Bearer ${senderReg.body.accessToken}`);
    expect(history.body.history).toHaveLength(0);
    const received = await request(app).get('/api/v1/gifts/received').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(received.body.transactions).toHaveLength(0);
  });

  it('is idempotent under a duplicated send request — debits and credits exactly once', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const senderReg = await fundedSender();
    const { response: creatorReg } = await registerUser();

    const upload = await uploadSampleVideo(creatorReg.body.accessToken);
    await waitForVideoSettled(upload.body.id, creatorReg.body.accessToken);

    const idempotencyKey = uniqueSlug('duplicate-gift');
    const body = { giftSlug, quantity: 1, videoId: upload.body.id, idempotencyKey };

    const [first, second] = await Promise.all([
      request(app).post('/api/v1/gifts/send').set('Authorization', `Bearer ${senderReg.body.accessToken}`).send(body),
      request(app).post('/api/v1/gifts/send').set('Authorization', `Bearer ${senderReg.body.accessToken}`).send(body),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);

    const balance = await request(app).get('/api/v1/coins/balance').set('Authorization', `Bearer ${senderReg.body.accessToken}`);
    expect(balance.body.balance).toBe(186 - 10); // exactly one debit, not two

    const diamonds = await request(app).get('/api/v1/creator/diamonds').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(diamonds.body.balance).toBe(1); // creatorShare 5 / 5 = 1, credited exactly once
  });

  it('enforces a self-set daily Gift spending limit server-side', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const senderReg = await fundedSender();
    const { response: creatorReg } = await registerUser();
    const upload = await uploadSampleVideo(creatorReg.body.accessToken);
    await waitForVideoSettled(upload.body.id, creatorReg.body.accessToken);

    await request(app).patch('/api/v1/coins/wallet/daily-limit').set('Authorization', `Bearer ${senderReg.body.accessToken}`).send({ dailyGiftLimitCoins: 15 });

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 2, videoId: upload.body.id, idempotencyKey: uniqueSlug('over-limit-gift') }); // 20 coins > 15 limit
    expect(send.status).toBe(400);
  });
});

describe('LIVE Gift attribution', () => {
  async function startLive(accessToken: string) {
    return request(app).post('/api/v1/live').set('Authorization', `Bearer ${accessToken}`).field('title', 'Test stream').field('maxGuestSlots', '2');
  }

  async function fundedSender() {
    const { response: userReg } = await registerUser();
    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    await purchaseAndCreditCoins(userReg.body.accessToken, packages.body.packages[0].id);
    return userReg;
  }

  it('attributes a Gift with no explicit target to the HOST', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const { response: hostReg } = await registerUser();
    const senderReg = await fundedSender();

    const started = await startLive(hostReg.body.accessToken);
    const liveSessionId = started.body.liveSession.id;

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, liveSessionId, idempotencyKey: uniqueSlug('host-gift') });
    expect(send.status).toBe(201);
    expect(send.body.participantRole).toBe('HOST');
    expect(send.body.recipientId).toBe(hostReg.body.user.id);

    const hostDiamonds = await request(app).get('/api/v1/creator/diamonds').set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(hostDiamonds.body.balance).toBe(1);
  });

  it('attributes a Gift targeting an ACTIVE guest to that guest, never the host', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const { response: hostReg } = await registerUser();
    const { response: guestReg } = await registerUser();
    const senderReg = await fundedSender();

    const started = await startLive(hostReg.body.accessToken);
    const liveSessionId = started.body.liveSession.id;
    await request(app).post(`/api/v1/live/${liveSessionId}/guests/invite`).set('Authorization', `Bearer ${hostReg.body.accessToken}`).send({ userId: guestReg.body.user.id, role: 'GUEST' });
    await request(app).post(`/api/v1/live/${liveSessionId}/guests/accept`).set('Authorization', `Bearer ${guestReg.body.accessToken}`);

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, liveSessionId, targetParticipantId: guestReg.body.user.id, idempotencyKey: uniqueSlug('guest-gift') });
    expect(send.status).toBe(201);
    expect(send.body.participantRole).toBe('GUEST');
    expect(send.body.recipientId).toBe(guestReg.body.user.id);

    const guestDiamonds = await request(app).get('/api/v1/creator/diamonds').set('Authorization', `Bearer ${guestReg.body.accessToken}`);
    expect(guestDiamonds.body.balance).toBe(1);
    const hostDiamonds = await request(app).get('/api/v1/creator/diamonds').set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(hostDiamonds.body.balance).toBe(0); // never auto-credited to the host
  });

  it('rejects a client-claimed recipient who is not actually an active participant of that LIVE session', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const { response: hostReg } = await registerUser();
    const { response: strangerReg } = await registerUser();
    const senderReg = await fundedSender();

    const started = await startLive(hostReg.body.accessToken);
    const liveSessionId = started.body.liveSession.id;

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, liveSessionId, targetParticipantId: strangerReg.body.user.id, idempotencyKey: uniqueSlug('fake-target-gift') });
    expect(send.status).toBe(400);
  });

  it('attributes a Gift sent mid-Battle to the correct side and contributes to that side\'s score, kept separate from the Coin/Diamond ledgers', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const { response: hostAReg } = await registerUser();
    const { response: hostBReg } = await registerUser();
    const senderReg = await fundedSender();

    const sessionA = await startLive(hostAReg.body.accessToken);
    const sessionB = await startLive(hostBReg.body.accessToken);
    const challenge = await request(app)
      .post(`/api/v1/live/${sessionA.body.liveSession.id}/match`)
      .set('Authorization', `Bearer ${hostAReg.body.accessToken}`)
      .send({ opponentSessionId: sessionB.body.liveSession.id });
    const accept = await request(app).post(`/api/v1/live/matches/${challenge.body.id}/accept`).set('Authorization', `Bearer ${hostBReg.body.accessToken}`);
    expect(accept.body.status).toBe('ACTIVE');

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, liveSessionId: sessionA.body.liveSession.id, idempotencyKey: uniqueSlug('battle-gift') });
    expect(send.status).toBe(201);
    expect(send.body.totalCoins).toBe(10);

    const match = await request(app).get(`/api/v1/live/matches/${challenge.body.id}`).set('Authorization', `Bearer ${hostAReg.body.accessToken}`);
    expect(match.body.scoreA).toBe(10); // 1:1 coins-to-score, XNAKView's own disclosed rule
    expect(match.body.scoreB).toBe(0);

    // The financial ledgers are unaffected by/independent of the score field.
    const senderBalance = await request(app).get('/api/v1/coins/balance').set('Authorization', `Bearer ${senderReg.body.accessToken}`);
    expect(senderBalance.body.balance).toBe(186 - 10);
  });

  it('attributes a Gift sent to an ACTIVE Team Match teammate to their captain\'s side score, same as a captain would get', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const { response: hostAReg } = await registerUser();
    const { response: hostBReg } = await registerUser();
    const { response: teammateReg } = await registerUser();
    const senderReg = await fundedSender();

    const sessionA = await startLive(hostAReg.body.accessToken);
    const sessionB = await startLive(hostBReg.body.accessToken);
    const sessionC = await startLive(teammateReg.body.accessToken);

    const challenge = await request(app)
      .post(`/api/v1/live/${sessionA.body.liveSession.id}/match`)
      .set('Authorization', `Bearer ${hostAReg.body.accessToken}`)
      .send({ opponentSessionId: sessionB.body.liveSession.id, matchType: 'TEAM' });
    await request(app).post(`/api/v1/live/matches/${challenge.body.id}/accept`).set('Authorization', `Bearer ${hostBReg.body.accessToken}`);

    const invite = await request(app)
      .post(`/api/v1/live/matches/${challenge.body.id}/team/invite`)
      .set('Authorization', `Bearer ${hostAReg.body.accessToken}`)
      .send({ liveSessionId: sessionC.body.liveSession.id, side: 'A' });

    // A Gift sent to the teammate's own session, while still only INVITED
    // (not yet accepted), does NOT contribute to any side's score.
    const sendBeforeAccept = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, liveSessionId: sessionC.body.liveSession.id, idempotencyKey: uniqueSlug('team-gift-pre-accept') });
    expect(sendBeforeAccept.status).toBe(201);
    const matchBeforeAccept = await request(app).get(`/api/v1/live/matches/${challenge.body.id}`).set('Authorization', `Bearer ${hostAReg.body.accessToken}`);
    expect(matchBeforeAccept.body.scoreA).toBe(0);

    await request(app).post(`/api/v1/live/matches/team/${invite.body.id}/accept`).set('Authorization', `Bearer ${teammateReg.body.accessToken}`);

    // Once ACTIVE, a Gift sent to the teammate's session contributes to side A's total score.
    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, liveSessionId: sessionC.body.liveSession.id, idempotencyKey: uniqueSlug('team-gift-post-accept') });
    expect(send.status).toBe(201);

    const match = await request(app).get(`/api/v1/live/matches/${challenge.body.id}`).set('Authorization', `Bearer ${hostAReg.body.accessToken}`);
    expect(match.body.scoreA).toBe(10); // only the post-accept Gift counted
    expect(match.body.scoreB).toBe(0);

    // The Gift still credits the teammate personally (their own Diamonds), same as any other recipient.
    expect(send.body.recipientId).toBe(teammateReg.body.user.id);
  });
});

/** Step 9's automatic pipeline requires a country-enabled, verified payout method + verified identity before ANY withdrawal — never a bare provider/destinationReference (see routes/v1/payoutMethods.ts / identityVerification.ts). Backdates `verifiedAt` past the fraud engine's 24h new-payout-method cooldown, which is a fraud-check concern for a dedicated test elsewhere, not this one. */
async function onboardForWithdrawal(accessToken: string): Promise<void> {
  await prisma.countryPayoutCapability.upsert({
    where: { countryCode: 'US' },
    create: { countryCode: 'US', currency: 'USD', enabled: true, minPayoutMinorUnits: 100, maxPayoutMinorUnits: 100_000_000, feeFixedMinorUnits: 0, feePercentBps: 0, providerPriority: ['PAYONEER'] },
    update: { currency: 'USD', enabled: true, providerPriority: ['PAYONEER'] },
  });
  const addPayoutMethod = await request(app)
    .post('/api/v1/creator/payout-method')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ country: 'US', currency: 'USD', accountHolderName: 'Economy Test Creator', bankDetails: { accountNumber: '000123456789', routingNumber: '021000021' } });
  await prisma.creatorPayoutMethod.update({ where: { id: addPayoutMethod.body.id }, data: { verifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

  const startKyc = await request(app).post('/api/v1/creator/identity-verification/start').set('Authorization', `Bearer ${accessToken}`).send({ country: 'US' });
  const verification = await prisma.verification.findUniqueOrThrow({ where: { id: startKyc.body.id } });
  await request(app)
    .post('/api/v1/webhooks/payout/PAYONEER')
    .send({ eventType: 'IDENTITY_VERIFIED', externalEventId: uniqueSlug('kyc-webhook'), providerReferenceId: verification.providerReferenceId, signature: 'test' });
}

describe('Creator earnings & withdrawal architecture', () => {
  it('converts Diamonds to earnings via an admin-only action, then runs the withdrawal hold -> automatic PROCESSING -> webhook PAID lifecycle', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const { response: senderReg } = await registerUser();
    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${senderReg.body.accessToken}`);
    await purchaseAndCreditCoins(senderReg.body.accessToken, packages.body.packages[0].id);
    const { response: creatorReg } = await registerUser();
    const upload = await uploadSampleVideo(creatorReg.body.accessToken);
    await waitForVideoSettled(upload.body.id, creatorReg.body.accessToken);

    // 10 gifts of quantity 1 (10 coins each) -> 100 total coins -> 50 creator share -> 10 diamonds.
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post('/api/v1/gifts/send')
        .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
        .send({ giftSlug, quantity: 1, videoId: upload.body.id, idempotencyKey: uniqueSlug(`earnings-gift-${i}`) });
      expect(res.status).toBe(201);
    }
    const diamonds = await request(app).get('/api/v1/creator/diamonds').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(diamonds.body.balance).toBe(10);

    // A creator can never trigger this conversion themselves — only admin can.
    const convert = await request(app)
      .post(`/api/v1/admin/creators/${creatorReg.body.user.id}/diamonds/convert`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ diamonds: 10, idempotencyKey: uniqueSlug('convert') });
    expect(convert.status).toBe(200);
    expect(convert.body.amountMinorUnits).toBe(50); // 10 diamonds * (500 cents / 100 diamondsRequired)
    expect(convert.body.currency).toBe('USD');

    const diamondsAfter = await request(app).get('/api/v1/creator/diamonds').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(diamondsAfter.body.balance).toBe(0);
    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(50);

    await onboardForWithdrawal(creatorReg.body.accessToken);

    // Withdrawal below the configured minimum is rejected before any hold is placed.
    const tooSmall = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`)
      .send({ amountMinorUnits: 50, currency: 'USD', idempotencyKey: uniqueSlug('wd-small') });
    expect(tooSmall.status).toBe(400); // below the US CountryPayoutCapability's own configured minimum

    // Top up past the minimum withdrawal threshold. Earning enough Diamonds
    // through real Gift sends to reach $50 would mean hundreds of test
    // requests just to set up state this test isn't about, so the Diamond
    // balance itself (already proven correct by the "debits the sender..."
    // and idempotent-send tests above) is seeded directly here, and only
    // the conversion-and-withdrawal machinery under test goes through the API.
    await prisma.creatorDiamondWallet.update({ where: { creatorId: creatorReg.body.user.id }, data: { balance: { increment: 990 } } });
    const topup = await request(app)
      .post(`/api/v1/admin/creators/${creatorReg.body.user.id}/diamonds/convert`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ diamonds: 990, idempotencyKey: uniqueSlug('convert-topup') });
    expect(topup.body.diamondsConverted).toBe(990);

    const earningsAfterTopup = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(earningsAfterTopup.body.balanceMinorUnits).toBeGreaterThanOrEqual(5000);

    const withdrawal = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`)
      .send({ amountMinorUnits: 5000, currency: 'USD', idempotencyKey: uniqueSlug('wd-real') });
    expect(withdrawal.status).toBe(201);
    // No admin review step — Step 9's automatic pipeline drives straight past REQUESTED/APPROVED to PROCESSING.
    expect(withdrawal.body.status).toBe('PROCESSING');

    // The held amount is immediately unavailable for a second withdrawal of the same funds.
    const earningsAfterHold = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(earningsAfterHold.body.balanceMinorUnits).toBe(earningsAfterTopup.body.balanceMinorUnits - 5000);

    // PAID only ever follows a real (here, mocked) provider confirmation via webhook — never an admin click.
    const withdrawalRow = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.body.id } });
    const paidWebhook = await request(app)
      .post('/api/v1/webhooks/payout/PAYONEER')
      .send({ eventType: 'PAYOUT_PAID', externalEventId: uniqueSlug('payout-paid'), providerPayoutId: withdrawalRow.providerPayoutId, signature: 'test' });
    expect(paidWebhook.status).toBe(200);
    const afterPaid = await request(app).get('/api/v1/creator/withdrawals').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(afterPaid.body.withdrawals.find((w: { id: string }) => w.id === withdrawal.body.id).status).toBe('PAID');
  });

  it('reverses the hold via an immutable credit when an admin exception-rejects a stuck REQUESTED withdrawal — never edits the original hold entry', async () => {
    // Step 9's automatic pipeline auto-approves every withdrawal the instant it's requested (see lib/withdrawalOrchestrator.ts), so
    // a normal creator-initiated withdrawal never sits in REQUESTED long enough for `POST /admin/withdrawals/:id/reject` to apply —
    // that route is now an exception-only override (a stuck/disputed row), not part of the routine flow. To exercise it, this test
    // calls `requestWithdrawal` (the hold-creation primitive) directly, bypassing the orchestrator's auto-approve, exactly the
    // shape of a genuinely stuck REQUESTED row an admin would need to intervene on.
    const { response: adminReg } = await registerAdmin();
    const { response: creatorReg } = await registerUser();
    await prisma.creatorEarningsWallet.upsert({ where: { creatorId: creatorReg.body.user.id }, create: { creatorId: creatorReg.body.user.id, balanceMinorUnits: 10_000 }, update: { balanceMinorUnits: 10_000 } });
    const payoutMethod = await prisma.creatorPayoutMethod.create({
      data: { creatorId: creatorReg.body.user.id, country: 'US', currency: 'USD', provider: 'PAYONEER', providerBeneficiaryId: `mock-ben-${uniqueSlug('reject-test')}`, bankDetailsMasked: {}, status: 'VERIFIED', verifiedAt: new Date() },
    });

    const withdrawal = await requestWithdrawal({
      userId: creatorReg.body.user.id,
      ageVerified: true,
      accountStatus: 'ACTIVE',
      amountMinorUnits: 6000,
      currency: 'USD',
      provider: 'PAYONEER',
      destinationReference: payoutMethod.providerBeneficiaryId!,
      idempotencyKey: uniqueSlug('wd-reject'),
      payoutMethodStatus: 'VERIFIED',
      identityVerificationStatus: 'APPROVED',
      countryCode: 'US',
      payoutMethodId: payoutMethod.id,
      feeMinorUnits: 0,
      netAmountMinorUnits: 6000,
    });
    expect(withdrawal.status).toBe('REQUESTED');

    const afterHold = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(afterHold.body.balanceMinorUnits).toBe(4000);

    const reject = await request(app).post(`/api/v1/admin/withdrawals/${withdrawal.id}/reject`).set('Authorization', `Bearer ${adminReg.body.accessToken}`).send({ reason: 'Suspicious destination' });
    expect(reject.body.status).toBe('REJECTED');

    const afterReject = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(afterReject.body.balanceMinorUnits).toBe(10_000); // fully restored via a new credit row, not an edit

    const history = await request(app).get('/api/v1/creator/earnings/history').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    const types = history.body.history.map((h: { type: string }) => h.type);
    expect(types).toEqual(expect.arrayContaining(['WITHDRAWAL_HOLD', 'WITHDRAWAL_REVERSAL']));
  });

  it('blocks a withdrawal while an active fraud hold exists on the account', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: creatorReg } = await registerUser();
    await prisma.creatorEarningsWallet.upsert({ where: { creatorId: creatorReg.body.user.id }, create: { creatorId: creatorReg.body.user.id, balanceMinorUnits: 10_000 }, update: { balanceMinorUnits: 10_000 } });

    await request(app).post('/api/v1/admin/fraud-holds').set('Authorization', `Bearer ${adminReg.body.accessToken}`).send({ userId: creatorReg.body.user.id, reason: 'Manual review' });

    const withdrawal = await request(app)
      .post('/api/v1/creator/withdrawals')
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`)
      .send({ amountMinorUnits: 6000, currency: 'USD', provider: 'EASYPAISA', destinationReference: '03001234567', idempotencyKey: uniqueSlug('wd-fraud-hold') });
    expect(withdrawal.status).toBe(403);
  });
});
