import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { checkAndUnlockAchievements } from '@/lib/gamification/achievementRules';
import { checkAndAwardBadges } from '@/lib/gamification/badgeRules';
import { recordStreakActivity } from '@/lib/gamification/streaks';
import { recordXP } from '@/lib/gamification/xpEngine';
import { prisma } from '@/lib/prisma';
import { app, registerAdmin, registerUser } from '@/test/helpers';

/**
 * Step 11 — Levels, Teams & Gamification. Runs against the real backend
 * (Postgres/Redis/LiveKit), same testing philosophy as the rest of this
 * codebase — no mocks for anything gamification touches. Team-specific
 * tests live in `teams.test.ts`; this file covers XP/levels, badges,
 * achievements, streaks, Fan Club, leaderboards, and admin config.
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
  await request(app).post('/api/v1/admin/gifts').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Rose', slug: giftSlug, coinCost: 10, category: 'APPRECIATION', maxQuantityPerSend: 50 });
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

describe('XP engine idempotency & concurrency', () => {
  it('never double-counts XP for the same idempotency key', async () => {
    const { response } = await registerUser();
    const userId = response.body.user.id;

    const first = await recordXP({ ledger: 'USER', userId, sourceType: 'FOLLOW_CREATED', sourceRefId: 'dup-key-1', amount: 10 });
    const second = await recordXP({ ledger: 'USER', userId, sourceType: 'FOLLOW_CREATED', sourceRefId: 'dup-key-1', amount: 10 });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);

    const level = await prisma.userLevel.findUnique({ where: { userId } });
    expect(level!.lifetimeXP).toBe(10);
    const eventCount = await prisma.xPEvent.count({ where: { userId, sourceType: 'FOLLOW_CREATED', sourceRefId: 'dup-key-1' } });
    expect(eventCount).toBe(1);
  });

  it('is race-safe under genuinely concurrent identical calls', async () => {
    const { response } = await registerUser();
    const userId = response.body.user.id;

    const results = await Promise.all([
      recordXP({ ledger: 'USER', userId, sourceType: 'FOLLOW_CREATED', sourceRefId: 'race-key', amount: 7 }),
      recordXP({ ledger: 'USER', userId, sourceType: 'FOLLOW_CREATED', sourceRefId: 'race-key', amount: 7 }),
    ]);
    expect(results.filter((r) => r.applied).length).toBe(1);

    const level = await prisma.userLevel.findUnique({ where: { userId } });
    expect(level!.lifetimeXP).toBe(7);
  });

  it('excludes XP for a user under an active fraud hold, without losing the record', async () => {
    const { response } = await registerUser();
    const userId = response.body.user.id;
    await prisma.fraudHold.create({ data: { userId, reason: 'test hold', createdById: null } });

    const result = await recordXP({ ledger: 'USER', userId, sourceType: 'FOLLOW_CREATED', sourceRefId: 'held-key', amount: 50 });
    expect(result.excludedAsFraud).toBe(true);

    const level = await prisma.userLevel.findUnique({ where: { userId } });
    expect(level).toBeNull(); // never applied to the snapshot

    const event = await prisma.xPEvent.findFirst({ where: { userId, sourceRefId: 'held-key' } });
    expect(event?.excludedAsFraud).toBe(true);
    expect(event?.exclusionReason).toBe('ACTIVE_FRAUD_HOLD');
  });
});

describe('User level progression', () => {
  it('awards Follow XP to the follower, server-authoritatively', async () => {
    const { response: followerReg } = await registerUser();
    const { response: targetReg } = await registerUser();

    const before = await request(app).get('/api/v1/gamification/level').set('Authorization', `Bearer ${followerReg.body.accessToken}`);
    expect(before.body.lifetimeXP).toBe(0);

    const follow = await request(app).post(`/api/v1/users/${targetReg.body.user.id}/follow`).set('Authorization', `Bearer ${followerReg.body.accessToken}`);
    expect(follow.status).toBe(201);

    // onFollowCreated runs after the HTTP response commits — poll briefly.
    let after = before.body;
    for (let i = 0; i < 20 && after.lifetimeXP === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      after = (await request(app).get('/api/v1/gamification/level').set('Authorization', `Bearer ${followerReg.body.accessToken}`)).body;
    }
    expect(after.lifetimeXP).toBeGreaterThan(0);
    expect(after.currentLevel).toBeGreaterThanOrEqual(1);
  });

  it('never lets a client set XP directly — there is no such endpoint', async () => {
    // Uses an admin token so this genuinely proves "no route matches" (404),
    // rather than getting shadowed by adminGamificationRouter's blanket
    // requireAdmin check (mounted last — any unmatched path falls through
    // to it and a non-admin would see 403 first, same documented gotcha as
    // adminTrustSafetyRouter in routes/v1/index.ts).
    const { response } = await registerAdmin();
    const attempt = await request(app)
      .patch('/api/v1/gamification/level')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .send({ lifetimeXP: 999999 });
    expect(attempt.status).toBe(404);
  });
});

describe('Gift-driven XP (sender USER ledger, recipient CREATOR ledger)', () => {
  it('awards XP to both sides of a real Gift, and unlocks the matching achievements/badges', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);

    await prisma.achievement.upsert({
      where: { slug: 'first-gift-sent' },
      create: { slug: 'first-gift-sent', name: 'First Gift Sent', description: 'Sent your first Gift', category: 'GIFTING', criteriaKey: 'FIRST_GIFT_SENT', xpReward: 30 },
      update: {},
    });
    await prisma.badge.upsert({
      where: { slug: 'first-gift-received' },
      create: { slug: 'first-gift-received', name: 'First Gift Received', description: 'Received your first Gift', category: 'MILESTONE', criteriaKey: 'FIRST_GIFT_RECEIVED' },
      update: {},
    });

    const { response: senderReg } = await registerUser();
    const { response: recipientReg } = await registerUser();
    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${senderReg.body.accessToken}`);
    await fundCoins(senderReg.body.accessToken, packages.body.packages[0].id);

    const post = await request(app).post('/api/v1/text-posts').set('Authorization', `Bearer ${recipientReg.body.accessToken}`).send({ text: 'gift me', visibility: 'PUBLIC' });
    expect(post.status).toBe(201);

    const send = await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 1, textPostId: post.body.id, idempotencyKey: uniqueSlug('gift') });
    expect(send.status).toBe(201);

    let senderLevel = { lifetimeXP: 0 };
    for (let i = 0; i < 30 && senderLevel.lifetimeXP === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      senderLevel = (await request(app).get('/api/v1/gamification/level').set('Authorization', `Bearer ${senderReg.body.accessToken}`)).body;
    }
    expect(senderLevel.lifetimeXP).toBeGreaterThan(0);

    const recipientCreatorLevel = await request(app).get('/api/v1/gamification/creator-level').set('Authorization', `Bearer ${recipientReg.body.accessToken}`);
    expect(recipientCreatorLevel.body.lifetimeXP).toBeGreaterThan(0);

    let recipientBadges = { badges: [] as { slug: string }[] };
    for (let i = 0; i < 30 && !recipientBadges.badges.some((b) => b.slug === 'first-gift-received'); i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      recipientBadges = (await request(app).get('/api/v1/gamification/badges').set('Authorization', `Bearer ${recipientReg.body.accessToken}`)).body;
    }
    expect(recipientBadges.badges.some((b) => b.slug === 'first-gift-received')).toBe(true);

    let achievement: { unlockedAt: string | null } | undefined;
    for (let i = 0; i < 30 && !achievement?.unlockedAt; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      const senderAchievements = await request(app).get('/api/v1/gamification/achievements').set('Authorization', `Bearer ${senderReg.body.accessToken}`);
      achievement = senderAchievements.body.achievements.find((a: { slug: string }) => a.slug === 'first-gift-sent');
    }
    expect(achievement?.unlockedAt).not.toBeNull();
  });
});

describe('Streaks', () => {
  it('continues on the next day and resets after a long gap', async () => {
    const { response } = await registerUser();
    const userId = response.body.user.id;

    const day1 = await recordStreakActivity(userId, 'CREATOR_ACTIVITY');
    expect(day1.currentCount).toBe(1);

    const sameDayAgain = await recordStreakActivity(userId, 'CREATOR_ACTIVITY');
    expect(sameDayAgain.currentCount).toBe(1); // no double-credit within the same UTC day

    await prisma.streak.update({
      where: { userId_type_scopeId: { userId, type: 'CREATOR_ACTIVITY', scopeId: '' } },
      data: { lastActivityDate: new Date(Date.now() - 25 * 60 * 60 * 1000) }, // "yesterday"
    });
    const day2 = await recordStreakActivity(userId, 'CREATOR_ACTIVITY');
    expect(day2.currentCount).toBe(2);

    await prisma.streak.update({
      where: { userId_type_scopeId: { userId, type: 'CREATOR_ACTIVITY', scopeId: '' } },
      data: { lastActivityDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) }, // 10 days ago — well past any grace window
    });
    const resetDay = await recordStreakActivity(userId, 'CREATOR_ACTIVITY');
    expect(resetDay.currentCount).toBe(1);

    const stored = await prisma.streak.findUnique({ where: { userId_type_scopeId: { userId, type: 'CREATOR_ACTIVITY', scopeId: '' } } });
    expect(stored!.longestCount).toBe(2); // the longest run is preserved even after a reset
  });
});

describe('Fan Club', () => {
  it('supports join / leave, awards join XP exactly once even across a leave+rejoin, and blocks self-join', async () => {
    const { response: fanReg } = await registerUser();
    const { response: creatorReg } = await registerUser();
    const creatorId = creatorReg.body.user.id;

    const selfJoin = await request(app).post(`/api/v1/gamification/fan-clubs/${creatorId}/join`).set('Authorization', `Bearer ${creatorReg.body.accessToken}`);
    expect(selfJoin.status).toBe(400);

    const join = await request(app).post(`/api/v1/gamification/fan-clubs/${creatorId}/join`).set('Authorization', `Bearer ${fanReg.body.accessToken}`);
    expect(join.status).toBe(200);

    const view = await request(app).get(`/api/v1/gamification/fan-clubs/${creatorId}`).set('Authorization', `Bearer ${fanReg.body.accessToken}`);
    expect(view.body.exists).toBe(true);
    expect(view.body.membership.fanLevel).toBe(1);
    expect(view.body.membership.lifetimeFanXP).toBeGreaterThan(0);
    const xpAfterFirstJoin = view.body.membership.lifetimeFanXP;

    const leave = await request(app).post(`/api/v1/gamification/fan-clubs/${creatorId}/leave`).set('Authorization', `Bearer ${fanReg.body.accessToken}`);
    expect(leave.status).toBe(200);

    const viewAfterLeave = await request(app).get(`/api/v1/gamification/fan-clubs/${creatorId}`).set('Authorization', `Bearer ${fanReg.body.accessToken}`);
    expect(viewAfterLeave.body.membership).toBeNull();

    const rejoin = await request(app).post(`/api/v1/gamification/fan-clubs/${creatorId}/join`).set('Authorization', `Bearer ${fanReg.body.accessToken}`);
    expect(rejoin.status).toBe(200);

    const viewAfterRejoin = await request(app).get(`/api/v1/gamification/fan-clubs/${creatorId}`).set('Authorization', `Bearer ${fanReg.body.accessToken}`);
    // The FAN_CLUB_JOIN XP event's idempotency key is the FanClub id itself
    // — a leave+rejoin cycle must never re-farm join XP a second time.
    expect(viewAfterRejoin.body.membership.lifetimeFanXP).toBe(xpAfterFirstJoin);
  });
});

describe('Badges & achievements are inert without a matching evaluator', () => {
  it('never awards a badge whose criteriaKey has no registered evaluator', async () => {
    const { response } = await registerUser();
    const userId = response.body.user.id;
    await prisma.badge.upsert({
      where: { slug: 'made-up-badge' },
      create: { slug: 'made-up-badge', name: 'Made Up', description: 'x', category: 'MILESTONE', criteriaKey: 'NOT_A_REAL_EVALUATOR' },
      update: {},
    });

    await checkAndAwardBadges(userId, ['NOT_A_REAL_EVALUATOR']);
    const earned = await prisma.userBadge.findFirst({ where: { userId } });
    expect(earned).toBeNull();
  });

  it('never unlocks an achievement whose criteriaKey has no registered evaluator', async () => {
    const { response } = await registerUser();
    const userId = response.body.user.id;
    await prisma.achievement.upsert({
      where: { slug: 'made-up-achievement' },
      create: { slug: 'made-up-achievement', name: 'Made Up', description: 'x', category: 'CONTENT', criteriaKey: 'NOT_A_REAL_EVALUATOR_2' },
      update: {},
    });

    await checkAndUnlockAchievements(userId, ['NOT_A_REAL_EVALUATOR_2']);
    const progress = await prisma.userAchievement.findFirst({ where: { userId } });
    expect(progress).toBeNull();
  });
});

describe('Leaderboards', () => {
  it('ranks by real ledger data and excludes a fraud-held subject on recompute', async () => {
    const { response: adminReg } = await registerAdmin();
    const { giftSlug } = await setupEconomyFixtures(adminReg.body.accessToken);
    const { response: senderReg } = await registerUser();
    const { response: recipientReg } = await registerUser();
    const packages = await request(app).get('/api/v1/coins/packages').set('Authorization', `Bearer ${senderReg.body.accessToken}`);
    await fundCoins(senderReg.body.accessToken, packages.body.packages[0].id);

    const post = await request(app).post('/api/v1/text-posts').set('Authorization', `Bearer ${recipientReg.body.accessToken}`).send({ text: 'leaderboard bait', visibility: 'PUBLIC' });
    await request(app)
      .post('/api/v1/gifts/send')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .send({ giftSlug, quantity: 3, textPostId: post.body.id, idempotencyKey: uniqueSlug('lb-gift') });

    const recompute1 = await request(app)
      .post('/api/v1/admin/gamification/leaderboards/recompute')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ type: 'GIFT_SENDERS', period: 'ALL_TIME' });
    expect(recompute1.status).toBe(200);

    const board1 = await request(app)
      .get('/api/v1/gamification/leaderboards')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .query({ type: 'GIFT_SENDERS', period: 'ALL_TIME' });
    expect(board1.body.entries.some((e: { subjectId: string }) => e.subjectId === senderReg.body.user.id)).toBe(true);

    await prisma.fraudHold.create({ data: { userId: senderReg.body.user.id, reason: 'test', createdById: null } });
    const recompute2 = await request(app)
      .post('/api/v1/admin/gamification/leaderboards/recompute')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ type: 'GIFT_SENDERS', period: 'ALL_TIME' });
    expect(recompute2.status).toBe(200);

    const board2 = await request(app)
      .get('/api/v1/gamification/leaderboards')
      .set('Authorization', `Bearer ${senderReg.body.accessToken}`)
      .query({ type: 'GIFT_SENDERS', period: 'ALL_TIME' });
    expect(board2.body.entries.some((e: { subjectId: string }) => e.subjectId === senderReg.body.user.id)).toBe(false);
  });

  it('requires admin to recompute a leaderboard', async () => {
    const { response } = await registerUser();
    const attempt = await request(app)
      .post('/api/v1/admin/gamification/leaderboards/recompute')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .send({ type: 'GIFT_SENDERS', period: 'ALL_TIME' });
    expect(attempt.status).toBe(403);
  });
});

describe('Admin gamification config — authorization, versioning, and historical XP integrity', () => {
  it('rejects a non-admin, and never rewrites already-recorded XP when the rule changes later', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: nonAdminReg } = await registerUser();

    const forbidden = await request(app)
      .put('/api/v1/admin/gamification/config/XP_AWARD_RULES')
      .set('Authorization', `Bearer ${nonAdminReg.body.accessToken}`)
      .send({ value: { FOLLOW_CREATED: 999 } });
    expect(forbidden.status).toBe(403);

    const { response: followerReg } = await registerUser();
    const { response: targetOneReg } = await registerUser();
    await request(app).post(`/api/v1/users/${targetOneReg.body.user.id}/follow`).set('Authorization', `Bearer ${followerReg.body.accessToken}`);

    let firstEvent = null;
    for (let i = 0; i < 20 && !firstEvent; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      firstEvent = await prisma.xPEvent.findFirst({ where: { userId: followerReg.body.user.id, sourceType: 'FOLLOW_CREATED' } });
    }
    const originalAmount = firstEvent!.amount;

    const configBefore = await request(app).get('/api/v1/admin/gamification/config').set('Authorization', `Bearer ${adminReg.body.accessToken}`);
    expect(configBefore.status).toBe(200);

    const update = await request(app)
      .put('/api/v1/admin/gamification/config/XP_AWARD_RULES')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ value: { ...configBefore.body.config.find((c: { key: string }) => c.key === 'XP_AWARD_RULES').value, FOLLOW_CREATED: originalAmount + 500 } });
    expect(update.status).toBe(201);

    // The already-recorded event from before the config change is untouched.
    const reread = await prisma.xPEvent.findUnique({ where: { id: firstEvent!.id } });
    expect(reread!.amount).toBe(originalAmount);

    // A NEW follow now uses the new rule.
    const { response: targetTwoReg } = await registerUser();
    await request(app).post(`/api/v1/users/${targetTwoReg.body.user.id}/follow`).set('Authorization', `Bearer ${followerReg.body.accessToken}`);
    let secondEvent = null;
    for (let i = 0; i < 20 && !secondEvent; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      secondEvent = await prisma.xPEvent.findFirst({ where: { userId: followerReg.body.user.id, sourceType: 'FOLLOW_CREATED', sourceRefId: { not: firstEvent!.sourceRefId } } });
    }
    expect(secondEvent!.amount).toBe(originalAmount + 500);

    const auditLogs = await request(app).get('/api/v1/admin/gamification/audit-logs').set('Authorization', `Bearer ${adminReg.body.accessToken}`);
    expect(auditLogs.body.auditLogs.some((l: { action: string }) => l.action === 'CONFIG_UPDATED')).toBe(true);

    const nonAdminAuditAttempt = await request(app).get('/api/v1/admin/gamification/audit-logs').set('Authorization', `Bearer ${nonAdminReg.body.accessToken}`);
    expect(nonAdminAuditAttempt.status).toBe(403);
  });

  it('grants a positive-only admin XP bonus and audits it', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: userReg } = await registerUser();

    const negative = await request(app)
      .post('/api/v1/admin/gamification/xp-adjustments')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ userId: userReg.body.user.id, ledger: 'USER', amount: -10, reason: 'should be rejected' });
    expect(negative.status).toBe(422);

    const grant = await request(app)
      .post('/api/v1/admin/gamification/xp-adjustments')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ userId: userReg.body.user.id, ledger: 'USER', amount: 100, reason: 'promo bonus' });
    expect(grant.status).toBe(201);

    const level = await request(app).get('/api/v1/gamification/level').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(level.body.lifetimeXP).toBe(100);
  });
});
