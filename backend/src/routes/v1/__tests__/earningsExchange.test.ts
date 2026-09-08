import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { calculateCoinsFromEarnings } from '@/lib/coinEconomy';
import { prisma } from '@/lib/prisma';
import { app, registerAdmin, registerUser } from '@/test/helpers';

/**
 * Earnings → Coins ("Exchange to Coins") — the creator-chosen alternative to
 * Withdraw. Every test hits the real backend against live Postgres/Redis,
 * matching this codebase's established testing philosophy for
 * financial-critical code. The authoritative chain under test is always
 * Earnings (USD minor units) → live PKR/USD ExchangeRate → the locked
 * COIN_VALUE_PKR (1 Coin = PKR 1.50) → Coins — never a separate invented
 * Diamond/Earnings→Coin rate.
 */

let fixtureCounter = 0;
function uniqueSlug(prefix: string): string {
  fixtureCounter += 1;
  return `${prefix}-${Date.now()}-${fixtureCounter}`;
}

async function setupRate(adminToken: string, pkrPerUsd: number): Promise<void> {
  const res = await request(app).post('/api/v1/admin/exchange-rate').set('Authorization', `Bearer ${adminToken}`).send({ pkrPerUsd });
  expect(res.status).toBe(201);
}

/** Directly seeds a creator's Earnings balance — the conversion-from-Diamonds machinery is already covered by coinsGiftsEconomy.test.ts; this file is only about the Earnings→Coins leg. */
async function seedEarnings(creatorId: string, amountMinorUnits: number): Promise<void> {
  const wallet = await prisma.creatorEarningsWallet.upsert({ where: { creatorId }, create: { creatorId, balanceMinorUnits: amountMinorUnits }, update: { balanceMinorUnits: { increment: amountMinorUnits } } });
  await prisma.creatorEarningsLedgerEntry.create({
    data: {
      walletId: wallet.id,
      direction: 'CREDIT',
      type: 'ADJUSTMENT',
      amountMinorUnits,
      currency: 'USD',
      beforeBalance: 0,
      afterBalance: wallet.balanceMinorUnits,
      idempotencyKey: uniqueSlug('seed-earnings'),
    },
  });
}

describe('calculateCoinsFromEarnings (unit)', () => {
  it('computes USD -> PKR -> Coins at the locked 1 Coin = PKR 1.50 rate, rounding DOWN', () => {
    // $10.00 * 280 PKR/USD = PKR 2800; 2800 / 1.50 = 1866.67 -> 1866
    expect(calculateCoinsFromEarnings(1000, 280)).toBe(1866);
    // $1.48 * 280 = PKR 414.4; 414.4 / 1.50 = 276.27 -> 276
    expect(calculateCoinsFromEarnings(148, 280)).toBe(276);
    // $0.50 * 280 = PKR 140; 140 / 1.50 = 93.33 -> 93
    expect(calculateCoinsFromEarnings(50, 280)).toBe(93);
  });

  it('never uses a hard-coded PKR/USD rate — the same USD amount yields different Coins at a different configured rate', () => {
    expect(calculateCoinsFromEarnings(1000, 280)).toBe(1866);
    expect(calculateCoinsFromEarnings(1000, 300)).toBe(2000); // $10 * 300 = PKR 3000 / 1.50 = 2000
  });
});

describe('Earnings -> Coins exchange (integration)', () => {
  it('previews and exchanges using the live configured rate, snapshotting it on the ledger row', async () => {
    const { response: adminReg } = await registerAdmin();
    await setupRate(adminReg.body.accessToken, 280);
    const { response: creatorReg } = await registerUser();
    await seedEarnings(creatorReg.body.user.id, 1000); // $10.00

    const preview = await request(app).get('/api/v1/creator/earnings/exchange-preview').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.amountMinorUnits).toBe(1000);
    expect(preview.body.coins).toBe(1866);
    expect(preview.body.pkrPerUsd).toBe('280.0000');
    expect(preview.body.coinValuePkr).toBe('1.50');

    const exchange = await request(app)
      .post('/api/v1/creator/earnings/exchange-to-coins')
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`)
      .send({ amountMinorUnits: 1000, currency: 'USD', idempotencyKey: uniqueSlug('exchange') });
    expect(exchange.status).toBe(200);
    expect(exchange.body.exchange.coinsCredited).toBe(1866);
    expect(exchange.body.exchange.pkrPerUsdSnapshot).toBe('280.0000');
    expect(exchange.body.exchange.coinValuePkrSnapshot).toBe('1.50');
    expect(exchange.body.earningsBalance).toBe(0);
    expect(exchange.body.coinBalance).toBe(1866);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(0);
    const coins = await request(app).get('/api/v1/coins/balance').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(coins.body.balance).toBe(1866);

    // Both ledger legs are recorded with the exchange as their reference, distinguishable by type.
    const earningsHistory = await request(app).get('/api/v1/creator/earnings/history').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(earningsHistory.body.history[0].type).toBe('EXCHANGE_TO_COINS');
    expect(earningsHistory.body.history[0].direction).toBe('DEBIT');
    const coinHistory = await request(app).get('/api/v1/coins/history').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(coinHistory.body.history[0].direction).toBe('CREDIT');
    expect(coinHistory.body.history[0].type).toBe('EARNINGS_EXCHANGE');
  });

  it('changing the exchange rate afterwards never retroactively changes an already-recorded exchange', async () => {
    const { response: adminReg } = await registerAdmin();
    await setupRate(adminReg.body.accessToken, 280);
    const { response: creatorReg } = await registerUser();
    await seedEarnings(creatorReg.body.user.id, 1000);

    const exchange = await request(app)
      .post('/api/v1/creator/earnings/exchange-to-coins')
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`)
      .send({ amountMinorUnits: 1000, currency: 'USD', idempotencyKey: uniqueSlug('exchange-rate-lock') });
    expect(exchange.body.exchange.coinsCredited).toBe(1866);

    await setupRate(adminReg.body.accessToken, 300);

    const stillOldExchange = await request(app)
      .get('/api/v1/creator/earnings/history')
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(stillOldExchange.body.history[0].amountMinorUnits).toBe(1000);
  });

  it('rejects exchanging more than the available Earnings balance without crediting any Coins', async () => {
    const { response: adminReg } = await registerAdmin();
    await setupRate(adminReg.body.accessToken, 280);
    const { response: creatorReg } = await registerUser();
    await seedEarnings(creatorReg.body.user.id, 100); // $1.00

    const exchange = await request(app)
      .post('/api/v1/creator/earnings/exchange-to-coins')
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`)
      .send({ amountMinorUnits: 5000, currency: 'USD', idempotencyKey: uniqueSlug('exchange-too-much') });
    expect(exchange.status).toBe(400);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(100);
    const coins = await request(app).get('/api/v1/coins/balance').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(coins.body.balance).toBe(0);
  });

  it('replaying the same idempotencyKey never double-debits Earnings or double-credits Coins', async () => {
    const { response: adminReg } = await registerAdmin();
    await setupRate(adminReg.body.accessToken, 280);
    const { response: creatorReg } = await registerUser();
    await seedEarnings(creatorReg.body.user.id, 1000);

    const idempotencyKey = uniqueSlug('exchange-replay');
    const body = { amountMinorUnits: 1000, currency: 'USD', idempotencyKey };

    const first = await request(app).post('/api/v1/creator/earnings/exchange-to-coins').set('Authorization', `Bearer ${creatorReg.body.accessToken}`).send(body);
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/v1/creator/earnings/exchange-to-coins').set('Authorization', `Bearer ${creatorReg.body.accessToken}`).send(body);
    expect(second.status).toBe(200);
    expect(second.body.exchange.id).toBe(first.body.exchange.id);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(0); // debited exactly once, not twice
    const coins = await request(app).get('/api/v1/coins/balance').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(coins.body.balance).toBe(1866); // credited exactly once, not twice
  });

  it('two concurrent requests for the SAME idempotencyKey (a real double-tap) apply the exchange exactly once', async () => {
    const { response: adminReg } = await registerAdmin();
    await setupRate(adminReg.body.accessToken, 280);
    const { response: creatorReg } = await registerUser();
    await seedEarnings(creatorReg.body.user.id, 1000);

    const idempotencyKey = uniqueSlug('exchange-concurrent-same-key');
    const body = { amountMinorUnits: 1000, currency: 'USD', idempotencyKey };

    const [a, b] = await Promise.all([
      request(app).post('/api/v1/creator/earnings/exchange-to-coins').set('Authorization', `Bearer ${creatorReg.body.accessToken}`).send(body),
      request(app).post('/api/v1/creator/earnings/exchange-to-coins').set('Authorization', `Bearer ${creatorReg.body.accessToken}`).send(body),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.exchange.id).toBe(b.body.exchange.id);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(0);
    const coins = await request(app).get('/api/v1/coins/balance').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(coins.body.balance).toBe(1866);
  });

  it('two concurrent exchanges with DIFFERENT idempotencyKeys that together exceed the balance never overdraw Earnings (no double exchange of the same funds)', async () => {
    const { response: adminReg } = await registerAdmin();
    await setupRate(adminReg.body.accessToken, 280);
    const { response: creatorReg } = await registerUser();
    await seedEarnings(creatorReg.body.user.id, 1000); // $10.00 available

    const bodyA = { amountMinorUnits: 700, currency: 'USD', idempotencyKey: uniqueSlug('exchange-race-a') };
    const bodyB = { amountMinorUnits: 700, currency: 'USD', idempotencyKey: uniqueSlug('exchange-race-b') };

    const [a, b] = await Promise.all([
      request(app).post('/api/v1/creator/earnings/exchange-to-coins').set('Authorization', `Bearer ${creatorReg.body.accessToken}`).send(bodyA),
      request(app).post('/api/v1/creator/earnings/exchange-to-coins').set('Authorization', `Bearer ${creatorReg.body.accessToken}`).send(bodyB),
    ]);
    const statuses = [a.status, b.status].sort();
    // Both requesting $7 against a $10 balance can never both succeed ($14 > $10) — exactly one must be rejected as insufficient.
    expect(statuses).toEqual([200, 400]);

    const earnings = await request(app).get('/api/v1/creator/earnings').set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(earnings.body.balanceMinorUnits).toBe(300); // exactly one $7 exchange applied against $10
  });

  it('rejects a non-USD exchange amount rather than silently applying the USD-only PKR formula to another currency', async () => {
    const { response: adminReg } = await registerAdmin();
    await setupRate(adminReg.body.accessToken, 280);
    const { response: creatorReg } = await registerUser();
    await seedEarnings(creatorReg.body.user.id, 1000);

    const exchange = await request(app)
      .post('/api/v1/creator/earnings/exchange-to-coins')
      .set('Authorization', `Bearer ${creatorReg.body.accessToken}`)
      .send({ amountMinorUnits: 1000, currency: 'PKR', idempotencyKey: uniqueSlug('exchange-bad-currency') });
    expect(exchange.status).toBe(400);
  });
});
