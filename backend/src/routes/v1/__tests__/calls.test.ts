import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, registerAdmin, registerUser } from '@/test/helpers';

/**
 * Real integration tests: every accept/decline/cancel/end call here makes a
 * genuine LiveKit control-plane call (CreateRoom/DeleteRoom, signed token
 * issuance) via the same LiveStreamingProvider Step 4 LIVE uses — see
 * live.test.ts for the equivalent statement about that layer. What's not
 * exercised here (and cannot be, on this machine) is real two-way WebRTC
 * audio — see docs/STEP5_PROGRESS.md.
 *
 * 1:1 calling is voice-only — 1:1 video calling was permanently removed as
 * a product decision (misuse/indecent-behavior risk). This is unrelated to
 * LIVE, which remains full video.
 */
async function initiateCall(callerToken: string, calleeId: string) {
  return request(app).post('/api/v1/calls').set('Authorization', `Bearer ${callerToken}`).send({ calleeId });
}

describe('POST /api/v1/calls (initiate)', () => {
  it('requires authentication', async () => {
    const response = await request(app).post('/api/v1/calls').send({ calleeId: 'x' });
    expect(response.status).toBe(401);
  });

  it('rings the callee with a real room and a publish-capable caller token', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();

    const response = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);
    expect(response.status).toBe(201);
    expect(response.body.call.status).toBe('RINGING');
    expect(response.body.token).toEqual(expect.any(String));

    const payload = JSON.parse(Buffer.from(response.body.token.split('.')[1], 'base64url').toString());
    expect(payload.video.canPublish).toBe(true);
  });

  it('rejects calling yourself', async () => {
    const { response: callerReg } = await registerUser();
    const response = await initiateCall(callerReg.body.accessToken, callerReg.body.user.id);
    expect(response.status).toBe(400);
  });

  it('404s calling a nonexistent user', async () => {
    const { response: callerReg } = await registerUser();
    const response = await initiateCall(callerReg.body.accessToken, '00000000-0000-0000-0000-000000000000');
    expect(response.status).toBe(404);
  });

  it('rejects calling a user you blocked', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    await request(app).post(`/api/v1/users/${calleeReg.body.user.id}/block`).set('Authorization', `Bearer ${callerReg.body.accessToken}`);

    const response = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);
    expect(response.status).toBe(403);
  });

  it('rejects calling a user who blocked you', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    await request(app).post(`/api/v1/users/${callerReg.body.user.id}/block`).set('Authorization', `Bearer ${calleeReg.body.accessToken}`);

    const response = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);
    expect(response.status).toBe(403);
  });

  it('rejects a banned account from initiating a call', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    await request(app)
      .post(`/api/v1/admin/users/${callerReg.body.user.id}/status`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ status: 'BANNED' });

    const response = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);
    expect(response.status).toBe(403);
  });

  it('rejects calling a banned account', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    await request(app)
      .post(`/api/v1/admin/users/${calleeReg.body.user.id}/status`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ status: 'BANNED' });

    const response = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);
    expect(response.status).toBe(404);
  });

  it('returns a BUSY record when the callee is already in a call', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const { response: thirdReg } = await registerUser();

    await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);
    const second = await initiateCall(thirdReg.body.accessToken, calleeReg.body.user.id);

    expect(second.status).toBe(200);
    expect(second.body.call.status).toBe('BUSY');
  });

  it('rejects initiating a second call while already ringing/active', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const { response: otherReg } = await registerUser();

    await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);
    const response = await initiateCall(callerReg.body.accessToken, otherReg.body.user.id);
    expect(response.status).toBe(409);
  });

  it('never creates two simultaneous RINGING calls for the same caller dialed at the same instant (concurrency-safe)', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeAReg } = await registerUser();
    const { response: calleeBReg } = await registerUser();

    // Fired together, not sequentially — a plain read-then-write "am I
    // already in a call" check can get this wrong under real concurrency.
    const [first, second] = await Promise.all([
      initiateCall(callerReg.body.accessToken, calleeAReg.body.user.id),
      initiateCall(callerReg.body.accessToken, calleeBReg.body.user.id),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
  });
});

describe('Call lifecycle: accept / decline / cancel / end', () => {
  it('lets the callee accept, granting both sides publish-capable tokens', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const initiated = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);

    const accept = await request(app)
      .post(`/api/v1/calls/${initiated.body.call.id}/accept`)
      .set('Authorization', `Bearer ${calleeReg.body.accessToken}`);
    expect(accept.status).toBe(200);
    expect(accept.body.call.status).toBe('ACCEPTED');
    const payload = JSON.parse(Buffer.from(accept.body.token.split('.')[1], 'base64url').toString());
    expect(payload.video.canPublish).toBe(true);
  });

  it('rejects the caller trying to accept their own call', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const initiated = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);

    const response = await request(app)
      .post(`/api/v1/calls/${initiated.body.call.id}/accept`)
      .set('Authorization', `Bearer ${callerReg.body.accessToken}`);
    expect(response.status).toBe(403);
  });

  it('lets the callee decline', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const initiated = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);

    const decline = await request(app)
      .post(`/api/v1/calls/${initiated.body.call.id}/decline`)
      .set('Authorization', `Bearer ${calleeReg.body.accessToken}`);
    expect(decline.status).toBe(200);
    expect(decline.body.call.status).toBe('DECLINED');
  });

  it('rejects the callee trying to decline as if they were the caller cancelling', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const initiated = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);

    const response = await request(app)
      .post(`/api/v1/calls/${initiated.body.call.id}/cancel`)
      .set('Authorization', `Bearer ${calleeReg.body.accessToken}`);
    expect(response.status).toBe(403);
  });

  it('lets the caller cancel while ringing', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const initiated = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);

    const cancel = await request(app)
      .post(`/api/v1/calls/${initiated.body.call.id}/cancel`)
      .set('Authorization', `Bearer ${callerReg.body.accessToken}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.call.status).toBe('CANCELLED');
  });

  it('lets either party end an active call, computing a duration', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const initiated = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);
    await request(app).post(`/api/v1/calls/${initiated.body.call.id}/accept`).set('Authorization', `Bearer ${calleeReg.body.accessToken}`);

    const end = await request(app)
      .post(`/api/v1/calls/${initiated.body.call.id}/end`)
      .set('Authorization', `Bearer ${callerReg.body.accessToken}`);
    expect(end.status).toBe(200);
    expect(end.body.call.status).toBe('ENDED');
    expect(end.body.call.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('rejects ending a call that never became active', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const initiated = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);

    const response = await request(app)
      .post(`/api/v1/calls/${initiated.body.call.id}/end`)
      .set('Authorization', `Bearer ${callerReg.body.accessToken}`);
    expect(response.status).toBe(409);
  });

  it('rejects a non-participant from acting on the call at all (IDOR)', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const { response: strangerReg } = await registerUser();
    const initiated = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);

    const strangerAuth = { Authorization: `Bearer ${strangerReg.body.accessToken}` };
    const results = await Promise.all([
      request(app).get(`/api/v1/calls/${initiated.body.call.id}`).set(strangerAuth),
      request(app).post(`/api/v1/calls/${initiated.body.call.id}/accept`).set(strangerAuth),
      request(app).post(`/api/v1/calls/${initiated.body.call.id}/decline`).set(strangerAuth),
      request(app).post(`/api/v1/calls/${initiated.body.call.id}/cancel`).set(strangerAuth),
    ]);
    for (const response of results) {
      expect([403, 404]).toContain(response.status);
    }
  });
});

describe('Call history', () => {
  it('lists calls the user participated in, either direction, newest first', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const first = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);
    await request(app).post(`/api/v1/calls/${first.body.call.id}/cancel`).set('Authorization', `Bearer ${callerReg.body.accessToken}`);
    const second = await initiateCall(calleeReg.body.accessToken, callerReg.body.user.id);
    await request(app).post(`/api/v1/calls/${second.body.call.id}/decline`).set('Authorization', `Bearer ${callerReg.body.accessToken}`);

    const history = await request(app).get('/api/v1/calls').set('Authorization', `Bearer ${callerReg.body.accessToken}`);
    expect(history.status).toBe(200);
    const ids = history.body.calls.map((c: { id: string }) => c.id);
    expect(ids).toEqual([second.body.call.id, first.body.call.id]);
    expect(history.body.calls[0].direction).toBe('INCOMING');
    expect(history.body.calls[1].direction).toBe('OUTGOING');
  });
});

describe('Call reporting', () => {
  it('lets a participant report a call, and rejects a duplicate', async () => {
    const { response: callerReg } = await registerUser();
    const { response: calleeReg } = await registerUser();
    const initiated = await initiateCall(callerReg.body.accessToken, calleeReg.body.user.id);
    await request(app).post(`/api/v1/calls/${initiated.body.call.id}/cancel`).set('Authorization', `Bearer ${callerReg.body.accessToken}`);

    const first = await request(app)
      .post(`/api/v1/calls/${initiated.body.call.id}/report`)
      .set('Authorization', `Bearer ${calleeReg.body.accessToken}`)
      .send({ reason: 'HARASSMENT_OR_BULLYING' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/calls/${initiated.body.call.id}/report`)
      .set('Authorization', `Bearer ${calleeReg.body.accessToken}`)
      .send({ reason: 'OTHER' });
    expect(second.status).toBe(409);
  });
});
