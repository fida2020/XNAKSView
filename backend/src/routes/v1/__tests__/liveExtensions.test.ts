import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { checkLiveEligibility } from '@/lib/liveEligibility';
import { prisma } from '@/lib/prisma';
import { app, registerAdmin, registerUser } from '@/test/helpers';

/**
 * Covers the Step 4 LIVE foundations added on top of the core start/join/
 * chat/report lifecycle already tested in live.test.ts: eligibility,
 * scheduling (LIVE events), moderation (moderators/mute/block/blocked
 * words/report-viewer/report-message), co-host & multi-guest, and LIVE
 * Match/Battle. Like live.test.ts, every HTTP test here hits the real
 * backend + real LiveKit control plane against live Postgres/Redis — no
 * mocks. See docs/STEP4_PROGRESS.md for what is a genuine integration test
 * here vs. what remains an untested real-media capability.
 */
async function startLive(accessToken: string, overrides: Record<string, string> = {}) {
  let req = request(app).post('/api/v1/live').set('Authorization', `Bearer ${accessToken}`).field('title', overrides.title ?? 'Test stream');
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'title') continue;
    req = req.field(key, value);
  }
  return req;
}

describe('checkLiveEligibility (unit)', () => {
  it('is ineligible when age is not verified', () => {
    const result = checkLiveEligibility({ ageVerified: false, accountCreatedAt: new Date() });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/age verification/i);
  });

  it('is eligible when age-verified and the minimum-account-age threshold is disabled (default)', () => {
    const result = checkLiveEligibility({ ageVerified: true, accountCreatedAt: new Date() });
    expect(result.eligible).toBe(true);
  });
});

describe('LIVE eligibility enforcement on POST /live', () => {
  it('lets a normal (age-verified) registered user go LIVE', async () => {
    const { response } = await registerUser();
    const started = await startLive(response.body.accessToken);
    expect(started.status).toBe(201);
  });
});

describe('LIVE events (scheduling)', () => {
  async function scheduleEvent(accessToken: string, overrides: Record<string, unknown> = {}) {
    return request(app)
      .post('/api/v1/live/events')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Scheduled stream',
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        ...overrides,
      });
  }

  it('schedules a LIVE event and lists it under upcoming discovery', async () => {
    const { response: hostReg } = await registerUser();
    const created = await scheduleEvent(hostReg.body.accessToken, { title: 'My Q&A' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('SCHEDULED');

    const list = await request(app).get('/api/v1/live/events').set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    const ids = list.body.events.map((event: { id: string }) => event.id);
    expect(ids).toContain(created.body.id);
  });

  it('rejects scheduling a LIVE event in the past', async () => {
    const { response: hostReg } = await registerUser();
    const response = await scheduleEvent(hostReg.body.accessToken, {
      scheduledAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    expect(response.status).toBe(422);
  });

  it('lets a follower set and clear a reminder', async () => {
    const { response: hostReg } = await registerUser();
    const created = await scheduleEvent(hostReg.body.accessToken);
    const { response: followerReg } = await registerUser();

    const remind = await request(app)
      .post(`/api/v1/live/events/${created.body.id}/remind`)
      .set('Authorization', `Bearer ${followerReg.body.accessToken}`);
    expect(remind.status).toBe(201);

    const clear = await request(app)
      .delete(`/api/v1/live/events/${created.body.id}/remind`)
      .set('Authorization', `Bearer ${followerReg.body.accessToken}`);
    expect(clear.status).toBe(204);
  });

  it('rejects a non-host rescheduling or cancelling', async () => {
    const { response: hostReg } = await registerUser();
    const created = await scheduleEvent(hostReg.body.accessToken);
    const { response: strangerReg } = await registerUser();

    const reschedule = await request(app)
      .patch(`/api/v1/live/events/${created.body.id}`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`)
      .send({ scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
    expect(reschedule.status).toBe(403);

    const cancel = await request(app)
      .post(`/api/v1/live/events/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`);
    expect(cancel.status).toBe(403);
  });

  it('starts a scheduled event, producing a real LIVE session', async () => {
    const { response: hostReg } = await registerUser();
    const created = await scheduleEvent(hostReg.body.accessToken);

    const started = await request(app)
      .post(`/api/v1/live/events/${created.body.id}/start`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);

    expect(started.status).toBe(201);
    expect(started.body.event.status).toBe('STARTED');
    expect(started.body.liveSessionId).toEqual(expect.any(String));
    expect(started.body.token).toEqual(expect.any(String));

    const liveDetail = await request(app)
      .get(`/api/v1/live/${started.body.liveSessionId}`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(liveDetail.body.status).toBe('LIVE');
  });

  it('rejects starting a scheduled event when the host is no longer LIVE-eligible (no eligibility bypass via events)', async () => {
    const { response: hostReg } = await registerUser();
    const created = await scheduleEvent(hostReg.body.accessToken);

    // The same gate `POST /live` enforces at creation time must also apply
    // here — simulate an age-verification gap the way the unit test for
    // checkLiveEligibility does, directly on the account.
    await prisma.user.update({ where: { id: hostReg.body.user.id }, data: { ageVerified: false } });

    const started = await request(app)
      .post(`/api/v1/live/events/${created.body.id}/start`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(started.status).toBe(403);

    const eventDetail = await request(app)
      .get(`/api/v1/live/events/${created.body.id}`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(eventDetail.body.status).toBe('SCHEDULED'); // never transitioned to STARTED
  });

  it('rejects cancelling an event that already started', async () => {
    const { response: hostReg } = await registerUser();
    const created = await scheduleEvent(hostReg.body.accessToken);
    await request(app).post(`/api/v1/live/events/${created.body.id}/start`).set('Authorization', `Bearer ${hostReg.body.accessToken}`);

    const cancel = await request(app)
      .post(`/api/v1/live/events/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(cancel.status).toBe(409);
  });
});

describe('LIVE moderation: moderators, mute, block', () => {
  it('lets the host assign a moderator, who can then mute a viewer', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const liveId = started.body.liveSession.id;

    const { response: modReg } = await registerUser();
    const { response: viewerReg } = await registerUser();
    await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${modReg.body.accessToken}`);
    await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${viewerReg.body.accessToken}`);

    const assign = await request(app)
      .post(`/api/v1/live/${liveId}/moderators`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ userId: modReg.body.user.id });
    expect(assign.status).toBe(201);

    const mute = await request(app)
      .post(`/api/v1/live/${liveId}/mute`)
      .set('Authorization', `Bearer ${modReg.body.accessToken}`)
      .send({ userId: viewerReg.body.user.id });
    expect(mute.status).toBe(201);

    const chat = await request(app)
      .post(`/api/v1/live/${liveId}/chat`)
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`)
      .send({ text: 'hello?' });
    expect(chat.status).toBe(403);
  });

  it('rejects a plain viewer trying to mute someone (moderation requires host/moderator)', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const liveId = started.body.liveSession.id;
    const { response: viewerReg } = await registerUser();
    const { response: targetReg } = await registerUser();
    await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${viewerReg.body.accessToken}`);

    const response = await request(app)
      .post(`/api/v1/live/${liveId}/mute`)
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`)
      .send({ userId: targetReg.body.user.id });
    expect(response.status).toBe(403);
  });

  it('blocking a viewer ends their active viewership and prevents rejoining', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const liveId = started.body.liveSession.id;
    const { response: viewerReg } = await registerUser();
    await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${viewerReg.body.accessToken}`);

    const block = await request(app)
      .post(`/api/v1/live/${liveId}/block`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ userId: viewerReg.body.user.id });
    expect(block.status).toBe(201);

    const rejoin = await request(app)
      .post(`/api/v1/live/${liveId}/join`)
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
    expect(rejoin.status).toBe(403);
  });

  it('unblocking allows a previously blocked viewer to rejoin', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const liveId = started.body.liveSession.id;
    const { response: viewerReg } = await registerUser();

    await request(app)
      .post(`/api/v1/live/${liveId}/block`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ userId: viewerReg.body.user.id });
    await request(app)
      .delete(`/api/v1/live/${liveId}/block/${viewerReg.body.user.id}`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);

    const rejoin = await request(app)
      .post(`/api/v1/live/${liveId}/join`)
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
    expect(rejoin.status).toBe(201);
  });

  it('lets the host remove a chat message', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const liveId = started.body.liveSession.id;

    const message = await request(app)
      .post(`/api/v1/live/${liveId}/chat`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ text: 'oops' });

    const removed = await request(app)
      .delete(`/api/v1/live/${liveId}/chat/${message.body.id}`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(removed.status).toBe(204);

    const list = await request(app).get(`/api/v1/live/${liveId}/chat`).set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(list.body.messages.map((m: { id: string }) => m.id)).not.toContain(message.body.id);
  });
});

describe('LIVE keyword filter (blocked words)', () => {
  it('rejects a chat message containing an admin-configured blocked word', async () => {
    const { response: hostReg } = await registerUser();
    await prisma.liveBlockedWord.upsert({
      where: { word: 'zzzbannedword' },
      create: { word: 'zzzbannedword' },
      update: {},
    });

    const started = await startLive(hostReg.body.accessToken);
    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/chat`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ text: 'this has zzzbannedword in it' });

    expect(response.status).toBe(400);
  });

  it('does not block ordinary messages once the blocked word is removed', async () => {
    const word = await prisma.liveBlockedWord.upsert({
      where: { word: 'zzztempword' },
      create: { word: 'zzztempword' },
      update: {},
    });

    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);

    const { response: adminReg } = await registerAdmin();
    await request(app).delete(`/api/v1/admin/live-blocked-words/${word.id}`).set('Authorization', `Bearer ${adminReg.body.accessToken}`);

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/chat`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ text: 'zzztempword should be fine now' });

    expect(response.status).toBe(201);
  });
});

describe('LIVE report-viewer and report-chat-message', () => {
  it('reports a specific viewer, and rejects a duplicate report', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const liveId = started.body.liveSession.id;
    const { response: viewerReg } = await registerUser();
    const { response: reporterReg } = await registerUser();
    await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${viewerReg.body.accessToken}`);

    const first = await request(app)
      .post(`/api/v1/live/${liveId}/report-viewer`)
      .set('Authorization', `Bearer ${reporterReg.body.accessToken}`)
      .send({ reportedUserId: viewerReg.body.user.id, reason: 'HARASSMENT_OR_BULLYING' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/live/${liveId}/report-viewer`)
      .set('Authorization', `Bearer ${reporterReg.body.accessToken}`)
      .send({ reportedUserId: viewerReg.body.user.id, reason: 'SPAM' });
    expect(second.status).toBe(409);
  });

  it('rejects reporting yourself', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/report-viewer`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ reportedUserId: hostReg.body.user.id, reason: 'OTHER' });
    expect(response.status).toBe(400);
  });

  it('rejects reporting someone who never participated in this LIVE session', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const { response: reporterReg } = await registerUser();
    const { response: strangerReg } = await registerUser(); // never joined or hosted

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/report-viewer`)
      .set('Authorization', `Bearer ${reporterReg.body.accessToken}`)
      .send({ reportedUserId: strangerReg.body.user.id, reason: 'SPAM' });
    expect(response.status).toBe(400);
  });

  it('allows reporting the host via report-viewer', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const { response: reporterReg } = await registerUser();

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/report-viewer`)
      .set('Authorization', `Bearer ${reporterReg.body.accessToken}`)
      .send({ reportedUserId: hostReg.body.user.id, reason: 'HARASSMENT_OR_BULLYING' });
    expect(response.status).toBe(201);
  });

  it('reports a specific chat message', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const liveId = started.body.liveSession.id;
    const message = await request(app)
      .post(`/api/v1/live/${liveId}/chat`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ text: 'reportable' });

    const { response: reporterReg } = await registerUser();
    const response = await request(app)
      .post(`/api/v1/live/${liveId}/chat/${message.body.id}/report`)
      .set('Authorization', `Bearer ${reporterReg.body.accessToken}`)
      .send({ reason: 'SPAM' });
    expect(response.status).toBe(201);
  });
});

describe('LIVE subscriber-only chat foundation', () => {
  it('rejects a non-subscriber from chatting when subscriberOnlyChat is enabled', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken, { subscriberOnlyChat: 'true' });
    const liveId = started.body.liveSession.id;
    expect(started.body.liveSession.subscriberOnlyChat).toBe(true);

    const { response: viewerReg } = await registerUser();
    await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${viewerReg.body.accessToken}`);

    const response = await request(app)
      .post(`/api/v1/live/${liveId}/chat`)
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`)
      .send({ text: 'let me in' });
    expect(response.status).toBe(403);
  });

  it('lets an ACTIVE subscriber chat when subscriberOnlyChat is enabled', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken, { subscriberOnlyChat: 'true' });
    const liveId = started.body.liveSession.id;
    const { response: fanReg } = await registerUser();
    await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${fanReg.body.accessToken}`);

    await prisma.liveSubscription.create({
      data: { creatorId: hostReg.body.user.id, fanId: fanReg.body.user.id, status: 'ACTIVE' },
    });

    const response = await request(app)
      .post(`/api/v1/live/${liveId}/chat`)
      .set('Authorization', `Bearer ${fanReg.body.accessToken}`)
      .send({ text: 'thanks for having me' });
    expect(response.status).toBe(201);
  });
});

describe('Co-host / multi-guest', () => {
  it('invites a guest, who accepts and gets a publish-capable token', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken, { maxGuestSlots: '2' });
    const liveId = started.body.liveSession.id;
    const { response: guestReg } = await registerUser();

    const invite = await request(app)
      .post(`/api/v1/live/${liveId}/guests/invite`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ userId: guestReg.body.user.id, role: 'CO_HOST' });
    expect(invite.status).toBe(201);
    expect(invite.body.status).toBe('INVITED');

    const accept = await request(app)
      .post(`/api/v1/live/${liveId}/guests/accept`)
      .set('Authorization', `Bearer ${guestReg.body.accessToken}`);
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe('ACTIVE');
    const payload = JSON.parse(Buffer.from(accept.body.token.split('.')[1], 'base64url').toString());
    expect(payload.video.canPublish).toBe(true);
  });

  it('rejects accepting once maxGuestSlots is full', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken, { maxGuestSlots: '1' });
    const liveId = started.body.liveSession.id;
    const { response: guest1 } = await registerUser();
    const { response: guest2 } = await registerUser();

    await request(app).post(`/api/v1/live/${liveId}/guests/invite`).set('Authorization', `Bearer ${hostReg.body.accessToken}`).send({ userId: guest1.body.user.id });
    await request(app).post(`/api/v1/live/${liveId}/guests/invite`).set('Authorization', `Bearer ${hostReg.body.accessToken}`).send({ userId: guest2.body.user.id });
    await request(app).post(`/api/v1/live/${liveId}/guests/accept`).set('Authorization', `Bearer ${guest1.body.accessToken}`);

    const secondAccept = await request(app)
      .post(`/api/v1/live/${liveId}/guests/accept`)
      .set('Authorization', `Bearer ${guest2.body.accessToken}`);
    expect(secondAccept.status).toBe(409);
  });

  it('never exceeds maxGuestSlots when two invited guests accept at the same instant (concurrency-safe)', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken, { maxGuestSlots: '1' });
    const liveId = started.body.liveSession.id;
    const { response: guest1 } = await registerUser();
    const { response: guest2 } = await registerUser();

    await request(app).post(`/api/v1/live/${liveId}/guests/invite`).set('Authorization', `Bearer ${hostReg.body.accessToken}`).send({ userId: guest1.body.user.id });
    await request(app).post(`/api/v1/live/${liveId}/guests/invite`).set('Authorization', `Bearer ${hostReg.body.accessToken}`).send({ userId: guest2.body.user.id });

    // Fired together, not sequentially — this is what a read-then-write
    // (count active slots, then update) can get wrong under real concurrency.
    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/live/${liveId}/guests/accept`).set('Authorization', `Bearer ${guest1.body.accessToken}`),
      request(app).post(`/api/v1/live/${liveId}/guests/accept`).set('Authorization', `Bearer ${guest2.body.accessToken}`),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const guests = await request(app).get(`/api/v1/live/${liveId}/guests`).set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    const activeCount = guests.body.guests.filter((g: { status: string }) => g.status === 'ACTIVE').length;
    expect(activeCount).toBe(1);
  });

  it('lets a guest decline, and the host remove an active guest', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken, { maxGuestSlots: '2' });
    const liveId = started.body.liveSession.id;
    const { response: declinerReg } = await registerUser();
    const { response: activeGuestReg } = await registerUser();

    await request(app).post(`/api/v1/live/${liveId}/guests/invite`).set('Authorization', `Bearer ${hostReg.body.accessToken}`).send({ userId: declinerReg.body.user.id });
    const decline = await request(app)
      .post(`/api/v1/live/${liveId}/guests/decline`)
      .set('Authorization', `Bearer ${declinerReg.body.accessToken}`);
    expect(decline.status).toBe(200);
    expect(decline.body.status).toBe('DECLINED');

    await request(app).post(`/api/v1/live/${liveId}/guests/invite`).set('Authorization', `Bearer ${hostReg.body.accessToken}`).send({ userId: activeGuestReg.body.user.id });
    await request(app).post(`/api/v1/live/${liveId}/guests/accept`).set('Authorization', `Bearer ${activeGuestReg.body.accessToken}`);

    const remove = await request(app)
      .post(`/api/v1/live/${liveId}/guests/${activeGuestReg.body.user.id}/remove`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(remove.status).toBe(200);
    expect(remove.body.status).toBe('REMOVED');
  });

  it('rejects a non-host inviting a guest', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const { response: strangerReg } = await registerUser();
    const { response: targetReg } = await registerUser();

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/guests/invite`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`)
      .send({ userId: targetReg.body.user.id });
    expect(response.status).toBe(403);
  });
});

describe('LIVE Match / Battle', () => {
  async function createChallenge(hostAToken: string, sessionAId: string, sessionBId: string) {
    return request(app)
      .post(`/api/v1/live/${sessionAId}/match`)
      .set('Authorization', `Bearer ${hostAToken}`)
      .send({ opponentSessionId: sessionBId });
  }

  it('does not activate a match until the challenged host accepts (no unilateral start)', async () => {
    const { response: hostAReg } = await registerUser();
    const { response: hostBReg } = await registerUser();
    const sessionA = await startLive(hostAReg.body.accessToken);
    const sessionB = await startLive(hostBReg.body.accessToken);

    const created = await createChallenge(hostAReg.body.accessToken, sessionA.body.liveSession.id, sessionB.body.liveSession.id);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('PENDING');

    // The challenger (session A's own host) cannot accept their own challenge.
    const selfAccept = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/accept`)
      .set('Authorization', `Bearer ${hostAReg.body.accessToken}`);
    expect(selfAccept.status).toBe(403);

    const detail = await request(app)
      .get(`/api/v1/live/matches/${created.body.id}`)
      .set('Authorization', `Bearer ${hostAReg.body.accessToken}`);
    expect(detail.body.status).toBe('PENDING');
  });

  it('lets the challenged host accept, activating the match', async () => {
    const { response: hostAReg } = await registerUser();
    const { response: hostBReg } = await registerUser();
    const sessionA = await startLive(hostAReg.body.accessToken);
    const sessionB = await startLive(hostBReg.body.accessToken);
    const created = await createChallenge(hostAReg.body.accessToken, sessionA.body.liveSession.id, sessionB.body.liveSession.id);

    const accepted = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/accept`)
      .set('Authorization', `Bearer ${hostBReg.body.accessToken}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('ACTIVE');
  });

  it('lets the challenged host decline instead, cancelling the match', async () => {
    const { response: hostAReg } = await registerUser();
    const { response: hostBReg } = await registerUser();
    const sessionA = await startLive(hostAReg.body.accessToken);
    const sessionB = await startLive(hostBReg.body.accessToken);
    const created = await createChallenge(hostAReg.body.accessToken, sessionA.body.liveSession.id, sessionB.body.liveSession.id);

    const declined = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/decline`)
      .set('Authorization', `Bearer ${hostBReg.body.accessToken}`);
    expect(declined.status).toBe(200);
    expect(declined.body.status).toBe('CANCELLED');

    const acceptAfterDecline = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/accept`)
      .set('Authorization', `Bearer ${hostBReg.body.accessToken}`);
    expect(acceptAfterDecline.status).toBe(409);
  });

  it('rejects a non-participant from accepting or declining a challenge', async () => {
    const { response: hostAReg } = await registerUser();
    const { response: hostBReg } = await registerUser();
    const { response: strangerReg } = await registerUser();
    const sessionA = await startLive(hostAReg.body.accessToken);
    const sessionB = await startLive(hostBReg.body.accessToken);
    const created = await createChallenge(hostAReg.body.accessToken, sessionA.body.liveSession.id, sessionB.body.liveSession.id);

    const accept = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/accept`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`);
    expect(accept.status).toBe(403);

    const decline = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/decline`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`);
    expect(decline.status).toBe(403);
  });

  it('runs a full match lifecycle and computes a winner, scored only by real participants', async () => {
    const { response: hostAReg } = await registerUser();
    const { response: hostBReg } = await registerUser();
    const sessionA = await startLive(hostAReg.body.accessToken, { title: 'Side A' });
    const sessionB = await startLive(hostBReg.body.accessToken, { title: 'Side B' });

    const created = await createChallenge(hostAReg.body.accessToken, sessionA.body.liveSession.id, sessionB.body.liveSession.id);
    expect(created.status).toBe(201);

    const accepted = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/accept`)
      .set('Authorization', `Bearer ${hostBReg.body.accessToken}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('ACTIVE');

    // A viewer of session A scores for side A; a viewer of session B scores
    // for side B — proving scoring is tied to real viewership, not just auth.
    const { response: viewerAReg } = await registerUser();
    await request(app).post(`/api/v1/live/${sessionA.body.liveSession.id}/join`).set('Authorization', `Bearer ${viewerAReg.body.accessToken}`);
    const { response: viewerBReg } = await registerUser();
    await request(app).post(`/api/v1/live/${sessionB.body.liveSession.id}/join`).set('Authorization', `Bearer ${viewerBReg.body.accessToken}`);

    const scoreA = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/score`)
      .set('Authorization', `Bearer ${viewerAReg.body.accessToken}`)
      .send({ side: 'A', increment: 3 });
    expect(scoreA.status).toBe(200);

    // The host of a side may also score without having "joined" it.
    const scoreB = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/score`)
      .set('Authorization', `Bearer ${hostBReg.body.accessToken}`)
      .send({ side: 'B', increment: 1 });
    expect(scoreB.status).toBe(200);

    const ended = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/end`)
      .set('Authorization', `Bearer ${hostAReg.body.accessToken}`);
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe('ENDED');
    expect(ended.body.scoreA).toBe(3);
    expect(ended.body.scoreB).toBe(1);
    expect(ended.body.winnerSessionId).toBe(sessionA.body.liveSession.id);
  });

  it('rejects scoring from a bystander who never joined or hosted either session', async () => {
    const { response: hostAReg } = await registerUser();
    const { response: hostBReg } = await registerUser();
    const sessionA = await startLive(hostAReg.body.accessToken);
    const sessionB = await startLive(hostBReg.body.accessToken);
    const created = await createChallenge(hostAReg.body.accessToken, sessionA.body.liveSession.id, sessionB.body.liveSession.id);
    await request(app).post(`/api/v1/live/matches/${created.body.id}/accept`).set('Authorization', `Bearer ${hostBReg.body.accessToken}`);

    const { response: bystanderReg } = await registerUser();
    const response = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/score`)
      .set('Authorization', `Bearer ${bystanderReg.body.accessToken}`)
      .send({ side: 'A', increment: 1 });
    expect(response.status).toBe(403);
  });

  it('rejects a non-participant from ending a match', async () => {
    const { response: hostAReg } = await registerUser();
    const { response: hostBReg } = await registerUser();
    const sessionA = await startLive(hostAReg.body.accessToken);
    const sessionB = await startLive(hostBReg.body.accessToken);
    const created = await createChallenge(hostAReg.body.accessToken, sessionA.body.liveSession.id, sessionB.body.liveSession.id);
    await request(app).post(`/api/v1/live/matches/${created.body.id}/accept`).set('Authorization', `Bearer ${hostBReg.body.accessToken}`);

    const { response: strangerReg } = await registerUser();
    const response = await request(app)
      .post(`/api/v1/live/matches/${created.body.id}/end`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`);
    expect(response.status).toBe(403);
  });
});

describe('LIVE replay foundation', () => {
  it('reports NONE by default and NOT_AVAILABLE once requested at start', async () => {
    const { response: hostReg } = await registerUser();
    const withoutReplay = await startLive(hostReg.body.accessToken);
    const statusWithout = await request(app)
      .get(`/api/v1/live/${withoutReplay.body.liveSession.id}/replay`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(statusWithout.body.replayStatus).toBe('NONE');

    const withReplay = await startLive(hostReg.body.accessToken, { replayEnabled: 'true' });
    const statusWith = await request(app)
      .get(`/api/v1/live/${withReplay.body.liveSession.id}/replay`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(statusWith.body.replayEnabled).toBe(true);
    expect(statusWith.body.replayStatus).toBe('NOT_AVAILABLE');
  });

  it('lets the host delete/hide a replay', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken, { replayEnabled: 'true' });

    const response = await request(app)
      .delete(`/api/v1/live/${started.body.liveSession.id}/replay`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.replayStatus).toBe('DELETED');
  });
});
