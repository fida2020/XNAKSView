import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, registerUser } from '@/test/helpers';

/**
 * These tests run against the REAL, locally self-hosted LiveKit server
 * (see infrastructure/docker-compose.yml) — every `POST /live`, `/join`,
 * `/reconnect`, and `/end` call in this file makes a genuine control-plane
 * API call to that server (CreateRoom / DeleteRoom / token signing), not a
 * mock. That makes this an **integration test** of the room lifecycle and
 * auth-token issuance. What it does NOT and CANNOT exercise on this
 * Windows development machine is real WebRTC media: actually publishing a
 * camera/mic and having a second client subscribe to and decode it. That
 * would require real client SDKs with real media hardware/permissions,
 * which no automated test in this repo attempts — see
 * docs/STEP4_PROGRESS.md for the full code-level/integration/real-media
 * breakdown and why claiming the latter would be untested and false.
 */
async function startLive(accessToken: string, overrides: { title?: string; category?: string } = {}) {
  return request(app)
    .post('/api/v1/live')
    .set('Authorization', `Bearer ${accessToken}`)
    .field('title', overrides.title ?? 'Test stream')
    .field('category', overrides.category ?? 'Just Chatting');
}

describe('POST /api/v1/live (start)', () => {
  it('requires authentication', async () => {
    const response = await request(app).post('/api/v1/live');
    expect(response.status).toBe(401);
  });

  it('starts a LIVE session with a real room and a publish-capable host token', async () => {
    const { response: registerResponse } = await registerUser();
    const response = await startLive(registerResponse.body.accessToken, { title: 'My stream' });

    expect(response.status).toBe(201);
    expect(response.body.liveSession.status).toBe('LIVE');
    expect(response.body.liveSession.title).toBe('My stream');
    expect(response.body.liveSession.isOwnSession).toBe(true);
    expect(response.body.liveSession.viewerCount).toBe(0);
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.wsUrl).toEqual(expect.any(String));

    // Decode the JWT payload (no verification needed here — we trust our
    // own signer; this just checks we asked for the right grants) to prove
    // the host really was granted publish rights, not just "some token".
    const payload = JSON.parse(Buffer.from(response.body.token.split('.')[1], 'base64url').toString());
    expect(payload.video.canPublish).toBe(true);
    expect(payload.video.room).toContain(response.body.liveSession.id);
  });

  it('never trusts a client-supplied host id', async () => {
    const { response: registerResponse } = await registerUser();
    const { response: otherRegisterResponse } = await registerUser();

    const response = await request(app)
      .post('/api/v1/live')
      .set('Authorization', `Bearer ${registerResponse.body.accessToken}`)
      .field('title', 'Spoof attempt')
      .field('hostId', otherRegisterResponse.body.user.id);

    expect(response.status).toBe(201);
    expect(response.body.liveSession.hostId).toBe(registerResponse.body.user.id);
  });

  it('rejects a thumbnail that is not really an image', async () => {
    const { response: registerResponse } = await registerUser();
    const response = await request(app)
      .post('/api/v1/live')
      .set('Authorization', `Bearer ${registerResponse.body.accessToken}`)
      .field('title', 'Bad thumbnail')
      .attach('thumbnail', Buffer.from('not an image'), 'fake.jpg');

    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/live (discovery) and GET /api/v1/live/:id', () => {
  it('lists only currently-LIVE sessions, newest first', async () => {
    const { response: registerResponse } = await registerUser();
    const token = registerResponse.body.accessToken;

    const first = await startLive(token, { title: 'First' });
    const second = await startLive(token, { title: 'Second' });
    await request(app).post(`/api/v1/live/${first.body.liveSession.id}/end`).set('Authorization', `Bearer ${token}`);

    const response = await request(app).get('/api/v1/live').set('Authorization', `Bearer ${token}`);
    const ids = response.body.liveSessions.map((session: { id: string }) => session.id);

    expect(ids).toContain(second.body.liveSession.id);
    expect(ids).not.toContain(first.body.liveSession.id);
  });

  it('returns a session by id regardless of status (so "stream ended" can be shown)', async () => {
    const { response: registerResponse } = await registerUser();
    const token = registerResponse.body.accessToken;
    const started = await startLive(token);
    await request(app).post(`/api/v1/live/${started.body.liveSession.id}/end`).set('Authorization', `Bearer ${token}`);

    const response = await request(app)
      .get(`/api/v1/live/${started.body.liveSession.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ENDED');
  });
});

describe('LIVE lifecycle: end', () => {
  it('rejects ending another host\'s LIVE session', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);

    const { response: otherReg } = await registerUser();
    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/end`)
      .set('Authorization', `Bearer ${otherReg.body.accessToken}`);

    expect(response.status).toBe(403);
  });

  it('lets the host end their own LIVE session, deleting the real room', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/end`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ENDED');
    expect(response.body.endedAt).not.toBeNull();
  });

  it('rejects reconnecting as host once the session has ended', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/end`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/reconnect`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(response.status).toBe(409);
  });

  it('rejects a non-host requesting a host reconnect token', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const { response: otherReg } = await registerUser();

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/reconnect`)
      .set('Authorization', `Bearer ${otherReg.body.accessToken}`);
    expect(response.status).toBe(403);
  });
});

describe('LIVE lifecycle: join / leave', () => {
  it('joins, incrementing viewerCount and granting a subscribe-only token', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const { response: viewerReg } = await registerUser();

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/join`)
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`);

    expect(response.status).toBe(201);
    expect(response.body.viewerCount).toBe(1);
    const payload = JSON.parse(Buffer.from(response.body.token.split('.')[1], 'base64url').toString());
    expect(payload.video.canPublish).toBe(false);
    expect(payload.video.canSubscribe).toBe(true);
  });

  it('does not double-count a duplicate join (idempotent reconnect)', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const { response: viewerReg } = await registerUser();
    const viewerToken = viewerReg.body.accessToken;
    const liveId = started.body.liveSession.id;

    const first = await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${viewerToken}`);
    const second = await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${viewerToken}`);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200); // idempotent, not a fresh join
    expect(second.body.viewerCount).toBe(1);

    const detail = await request(app).get(`/api/v1/live/${liveId}`).set('Authorization', `Bearer ${viewerToken}`);
    expect(detail.body.viewerCount).toBe(1);
  });

  it('tracks viewer count correctly across multiple viewers joining and leaving', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const liveId = started.body.liveSession.id;

    const { response: viewer1 } = await registerUser();
    const { response: viewer2 } = await registerUser();

    await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${viewer1.body.accessToken}`);
    const afterSecondJoin = await request(app)
      .post(`/api/v1/live/${liveId}/join`)
      .set('Authorization', `Bearer ${viewer2.body.accessToken}`);
    expect(afterSecondJoin.body.viewerCount).toBe(2);

    const afterLeave = await request(app)
      .post(`/api/v1/live/${liveId}/leave`)
      .set('Authorization', `Bearer ${viewer1.body.accessToken}`);
    expect(afterLeave.body.viewerCount).toBe(1);

    const detail = await request(app).get(`/api/v1/live/${liveId}`).set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(detail.body.viewerCount).toBe(1);
    expect(detail.body.peakViewerCount).toBe(2);
  });

  it('404s leaving a session you are not currently viewing', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const { response: viewerReg } = await registerUser();

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/leave`)
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
    expect(response.status).toBe(404);
  });

  it('rejects joining a LIVE session that has already ended', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/end`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);

    const { response: viewerReg } = await registerUser();
    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/join`)
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
    expect(response.status).toBe(409);
  });

  it('marks all active viewers as left when the host ends the session (session cleanup)', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const liveId = started.body.liveSession.id;
    const { response: viewerReg } = await registerUser();

    await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
    await request(app).post(`/api/v1/live/${liveId}/end`).set('Authorization', `Bearer ${hostReg.body.accessToken}`);

    // The viewer never called /leave — but leaving a long-ended session
    // should still 404 (nobody is "actively viewing" it anymore), proving
    // the server-side cleanup on /end actually ran.
    const response = await request(app)
      .post(`/api/v1/live/${liveId}/leave`)
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`);
    expect(response.status).toBe(404);
  });
});

describe('LIVE chat', () => {
  it('lets the host and an active viewer post; lists newest first', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const liveId = started.body.liveSession.id;
    const { response: viewerReg } = await registerUser();
    await request(app).post(`/api/v1/live/${liveId}/join`).set('Authorization', `Bearer ${viewerReg.body.accessToken}`);

    const hostMessage = await request(app)
      .post(`/api/v1/live/${liveId}/chat`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ text: 'Welcome!' });
    const viewerMessage = await request(app)
      .post(`/api/v1/live/${liveId}/chat`)
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`)
      .send({ text: 'Hi!' });

    expect(hostMessage.status).toBe(201);
    expect(viewerMessage.status).toBe(201);

    const list = await request(app).get(`/api/v1/live/${liveId}/chat`).set('Authorization', `Bearer ${hostReg.body.accessToken}`);
    expect(list.body.messages).toHaveLength(2);
    expect(list.body.messages[0].text).toBe('Hi!'); // newest first
  });

  it('rejects chat from someone who has not joined (authorization, not just authentication)', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const { response: strangerReg } = await registerUser();

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/chat`)
      .set('Authorization', `Bearer ${strangerReg.body.accessToken}`)
      .send({ text: 'sneaky' });
    expect(response.status).toBe(403);
  });

  it('rejects chat once the LIVE session has ended', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/end`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`);

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/chat`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ text: 'still here?' });
    expect(response.status).toBe(409);
  });

  it('rejects an empty or too-long chat message', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);

    const empty = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/chat`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ text: '' });
    const tooLong = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/chat`)
      .set('Authorization', `Bearer ${hostReg.body.accessToken}`)
      .send({ text: 'x'.repeat(301) });

    expect(empty.status).toBe(422);
    expect(tooLong.status).toBe(422);
  });
});

describe('LIVE reports', () => {
  it('creates a report', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const { response: reporterReg } = await registerUser();

    const response = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/report`)
      .set('Authorization', `Bearer ${reporterReg.body.accessToken}`)
      .send({ reason: 'HARASSMENT_OR_BULLYING', description: 'Testing' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('PENDING');
  });

  it('rejects a duplicate report from the same user (prevents report spam)', async () => {
    const { response: hostReg } = await registerUser();
    const started = await startLive(hostReg.body.accessToken);
    const { response: reporterReg } = await registerUser();
    const reporterToken = reporterReg.body.accessToken;

    await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/report`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({ reason: 'SPAM' });
    const second = await request(app)
      .post(`/api/v1/live/${started.body.liveSession.id}/report`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({ reason: 'OTHER' });

    expect(second.status).toBe(409);
  });
});
