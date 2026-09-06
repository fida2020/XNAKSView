import { randomUUID } from 'crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, registerAdmin, registerUser } from '@/test/helpers';

/**
 * Real integration tests against the actual backend + real Postgres/Redis —
 * no mocks. Covers conversation creation/reuse, message-request privacy
 * gating, idempotent sending, unread/read state, mute/pin, unsend, blocking,
 * reporting, and IDOR protection.
 */
async function follow(followerToken: string, targetId: string) {
  return request(app).post(`/api/v1/users/${targetId}/follow`).set('Authorization', `Bearer ${followerToken}`);
}

async function makeMutualFollowers(userAToken: string, userAId: string, userBToken: string, userBId: string) {
  await follow(userAToken, userBId);
  await follow(userBToken, userAId);
}

describe('Conversations: creation, reuse, and message requests', () => {
  it('requires authentication', async () => {
    const response = await request(app).post('/api/v1/conversations').send({ userId: randomUUID() });
    expect(response.status).toBe(401);
  });

  it('creates a PENDING request between strangers (default MUTUAL_FOLLOWERS privacy)', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();

    const response = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('PENDING');
  });

  it('creates an ACCEPTED conversation immediately between mutual followers', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    await makeMutualFollowers(aReg.body.accessToken, aReg.body.user.id, bReg.body.accessToken, bReg.body.user.id);

    const response = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ACCEPTED');
  });

  it('reuses the same conversation regardless of who initiates the lookup', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();

    const first = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    const second = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ userId: aReg.body.user.id });

    expect(second.body.id).toBe(first.body.id);
  });

  it('rejects starting a conversation with yourself', async () => {
    const { response: aReg } = await registerUser();
    const response = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: aReg.body.user.id });
    expect(response.status).toBe(400);
  });

  it('404s for a nonexistent user (never distinguishes from a real-but-restricted one)', async () => {
    const { response: aReg } = await registerUser();
    const response = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: randomUUID() });
    expect(response.status).toBe(404);
  });

  it('rejects a message request entirely when the recipient sets whoCanMessage to NO_ONE', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    await request(app)
      .patch('/api/v1/me/messaging-settings')
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ whoCanMessage: 'NO_ONE' });

    const response = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    expect(response.status).toBe(403);
  });

  it('allows an immediate ACCEPTED conversation from anyone when whoCanMessage is EVERYONE', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    await request(app)
      .patch('/api/v1/me/messaging-settings')
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ whoCanMessage: 'EVERYONE' });

    const response = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ACCEPTED');
  });

  it('rejects messaging entirely once suspended/banned', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: bannedReg } = await registerUser();
    const { response: targetReg } = await registerUser();

    await request(app)
      .post(`/api/v1/admin/users/${bannedReg.body.user.id}/status`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ status: 'BANNED' });

    const response = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${bannedReg.body.accessToken}`)
      .send({ userId: targetReg.body.user.id });
    expect(response.status).toBe(403);
  });
});

describe('Conversations: auto-accept on reply and explicit accept', () => {
  it('flips PENDING to ACCEPTED once the recipient replies', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    expect(created.body.status).toBe('PENDING');

    await request(app)
      .post(`/api/v1/conversations/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'Hello back' });

    const detail = await request(app)
      .get(`/api/v1/conversations/${created.body.id}`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`);
    expect(detail.body.status).toBe('ACCEPTED');
  });

  it('lets the recipient explicitly accept, and rejects the initiator trying to accept their own request', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });

    const selfAccept = await request(app)
      .post(`/api/v1/conversations/${created.body.id}/accept`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`);
    expect(selfAccept.status).toBe(403);

    const accept = await request(app)
      .post(`/api/v1/conversations/${created.body.id}/accept`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`);
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe('ACCEPTED');
  });
});

describe('Messages: sending, idempotency, ordering', () => {
  async function acceptedConversation() {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    await makeMutualFollowers(aReg.body.accessToken, aReg.body.user.id, bReg.body.accessToken, bReg.body.user.id);
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    return { aReg, bReg, conversationId: created.body.id };
  }

  it('sends a text message and lists it newest-first', async () => {
    const { aReg, bReg, conversationId } = await acceptedConversation();

    const first = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'Hi!' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'Hey there' });
    expect(second.status).toBe(201);

    const list = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`);
    expect(list.body.messages).toHaveLength(2);
    expect(list.body.messages[0].text).toBe('Hey there');
  });

  it('is idempotent: retrying the same clientMessageId never creates a duplicate', async () => {
    const { aReg, conversationId } = await acceptedConversation();
    const clientMessageId = randomUUID();

    const first = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId, text: 'retry me' });
    const retry = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId, text: 'retry me' });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);

    const list = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`);
    expect(list.body.messages).toHaveLength(1);
  });

  it('two different senders may reuse the same clientMessageId without colliding', async () => {
    const { aReg, bReg, conversationId } = await acceptedConversation();
    const clientMessageId = randomUUID();

    const fromA = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId, text: 'from A' });
    const fromB = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ clientMessageId, text: 'from B' });

    expect(fromA.status).toBe(201);
    expect(fromB.status).toBe(201);
    expect(fromA.body.id).not.toBe(fromB.body.id);
  });

  it('rejects an empty or too-long message', async () => {
    const { aReg, conversationId } = await acceptedConversation();
    const empty = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: '' });
    expect(empty.status).toBe(422);
  });

  it('rejects sending into a conversation you are not part of', async () => {
    const { conversationId } = await acceptedConversation();
    const { response: strangerReg } = await registerUser();
    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'sneaky' });
    expect(response.status).toBe(404);
  });
});

describe('Unread counts, read receipts, and delivery', () => {
  it('tracks unread count and clears it on /read, notifying the sender of the read receipt', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    await makeMutualFollowers(aReg.body.accessToken, aReg.body.user.id, bReg.body.accessToken, bReg.body.user.id);
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });

    await request(app)
      .post(`/api/v1/conversations/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'one' });
    await request(app)
      .post(`/api/v1/conversations/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'two' });

    const beforeRead = await request(app)
      .get(`/api/v1/conversations/${created.body.id}`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`);
    expect(beforeRead.body.unreadCount).toBe(2);

    const readResponse = await request(app)
      .post(`/api/v1/conversations/${created.body.id}/read`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`);
    expect(readResponse.status).toBe(200);

    const afterRead = await request(app)
      .get(`/api/v1/conversations/${created.body.id}`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`);
    expect(afterRead.body.unreadCount).toBe(0);

    const messages = await request(app)
      .get(`/api/v1/conversations/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`);
    for (const message of messages.body.messages) {
      const receipt = message.receipts.find((r: { userId: string }) => r.userId === bReg.body.user.id);
      expect(receipt.readAt).not.toBeNull();
    }
  });
});

describe('Mute and pin', () => {
  it('mutes and unmutes a conversation', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });

    const mute = await request(app)
      .post(`/api/v1/conversations/${created.body.id}/mute`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`);
    expect(mute.status).toBe(200);

    const unmute = await request(app)
      .delete(`/api/v1/conversations/${created.body.id}/mute`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`);
    expect(unmute.status).toBe(204);
  });

  it('pins a conversation and it appears in the pinned section of the list', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    // Needs at least one message to appear in the inbox at all.
    await request(app)
      .post(`/api/v1/conversations/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'hi' });

    await request(app)
      .post(`/api/v1/conversations/${created.body.id}/pin`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`);

    const list = await request(app).get('/api/v1/conversations').set('Authorization', `Bearer ${aReg.body.accessToken}`);
    expect(list.body.pinned.map((c: { id: string }) => c.id)).toContain(created.body.id);
    expect(list.body.conversations.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
  });
});

describe('Unsend / delete', () => {
  it('lets the sender unsend their own message', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    const sent = await request(app)
      .post(`/api/v1/conversations/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'oops' });

    const deleted = await request(app).delete(`/api/v1/messages/${sent.body.id}`).set('Authorization', `Bearer ${aReg.body.accessToken}`);
    expect(deleted.status).toBe(204);

    const list = await request(app)
      .get(`/api/v1/conversations/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`);
    const message = list.body.messages.find((m: { id: string }) => m.id === sent.body.id);
    expect(message.deleted).toBe(true);
    expect(message.text).toBeNull();
  });

  it('rejects unsending someone else\'s message', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    const sent = await request(app)
      .post(`/api/v1/conversations/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'mine' });

    const response = await request(app).delete(`/api/v1/messages/${sent.body.id}`).set('Authorization', `Bearer ${bReg.body.accessToken}`);
    expect(response.status).toBe(403);
  });
});

describe('Blocking', () => {
  it('prevents creating a new conversation with a user you blocked, in either direction', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    await request(app).post(`/api/v1/users/${bReg.body.user.id}/block`).set('Authorization', `Bearer ${aReg.body.accessToken}`);

    const aToB = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    expect(aToB.status).toBe(403);

    const bToA = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ userId: aReg.body.user.id });
    expect(bToA.status).toBe(403);
  });

  it('prevents sending into an existing conversation once blocked mid-thread', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    await makeMutualFollowers(aReg.body.accessToken, aReg.body.user.id, bReg.body.accessToken, bReg.body.user.id);
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });

    await request(app).post(`/api/v1/users/${bReg.body.user.id}/block`).set('Authorization', `Bearer ${aReg.body.accessToken}`);

    const response = await request(app)
      .post(`/api/v1/conversations/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'still there?' });
    expect(response.status).toBe(403);
  });

  it('unblocking restores the ability to message', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    await request(app).post(`/api/v1/users/${bReg.body.user.id}/block`).set('Authorization', `Bearer ${aReg.body.accessToken}`);
    await request(app).delete(`/api/v1/users/${bReg.body.user.id}/block`).set('Authorization', `Bearer ${aReg.body.accessToken}`);

    const response = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    expect(response.status).toBe(201);
  });

  it('lists blocked users', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    await request(app).post(`/api/v1/users/${bReg.body.user.id}/block`).set('Authorization', `Bearer ${aReg.body.accessToken}`);

    const list = await request(app).get('/api/v1/me/blocked-users').set('Authorization', `Bearer ${aReg.body.accessToken}`);
    expect(list.body.users.map((u: { id: string }) => u.id)).toContain(bReg.body.user.id);
  });
});

describe('Reporting', () => {
  it('reports a conversation, and rejects a duplicate report', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });

    const first = await request(app)
      .post(`/api/v1/conversations/${created.body.id}/report`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ reason: 'SPAM' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/conversations/${created.body.id}/report`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ reason: 'OTHER' });
    expect(second.status).toBe(409);
  });

  it('reports a message but rejects reporting your own', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });
    const sent = await request(app)
      .post(`/api/v1/conversations/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ clientMessageId: randomUUID(), text: 'reportable' });

    const selfReport = await request(app)
      .post(`/api/v1/messages/${sent.body.id}/report`)
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ reason: 'SPAM' });
    expect(selfReport.status).toBe(400);

    const report = await request(app)
      .post(`/api/v1/messages/${sent.body.id}/report`)
      .set('Authorization', `Bearer ${bReg.body.accessToken}`)
      .send({ reason: 'HARASSMENT_OR_BULLYING' });
    expect(report.status).toBe(201);
  });
});

describe('IDOR protection', () => {
  it('404s a non-participant reading, muting, pinning, or marking read a conversation that is not theirs', async () => {
    const { response: aReg } = await registerUser();
    const { response: bReg } = await registerUser();
    const { response: strangerReg } = await registerUser();
    const created = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${aReg.body.accessToken}`)
      .send({ userId: bReg.body.user.id });

    const strangerAuth = { Authorization: `Bearer ${strangerReg.body.accessToken}` };
    const results = await Promise.all([
      request(app).get(`/api/v1/conversations/${created.body.id}`).set(strangerAuth),
      request(app).post(`/api/v1/conversations/${created.body.id}/mute`).set(strangerAuth),
      request(app).post(`/api/v1/conversations/${created.body.id}/pin`).set(strangerAuth),
      request(app).post(`/api/v1/conversations/${created.body.id}/read`).set(strangerAuth),
      request(app).get(`/api/v1/conversations/${created.body.id}/messages`).set(strangerAuth),
    ]);
    for (const response of results) {
      expect(response.status).toBe(404);
    }
  });
});

describe('Messaging privacy settings', () => {
  it('defaults to MUTUAL_FOLLOWERS / showActivityStatus true, and round-trips an update', async () => {
    const { response: userReg } = await registerUser();
    const defaults = await request(app).get('/api/v1/me/messaging-settings').set('Authorization', `Bearer ${userReg.body.accessToken}`);
    expect(defaults.body).toEqual({ whoCanMessage: 'MUTUAL_FOLLOWERS', showActivityStatus: true });

    const updated = await request(app)
      .patch('/api/v1/me/messaging-settings')
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .send({ whoCanMessage: 'EVERYONE', showActivityStatus: false });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ whoCanMessage: 'EVERYONE', showActivityStatus: false });
  });
});
