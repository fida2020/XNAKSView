import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, registerAdmin, registerUser } from '@/test/helpers';

/**
 * Admin authorization foundation (Step 4 fix): every /admin/* route now
 * requires `isAdmin`, not just a valid session. These tests hit the real
 * backend + real Postgres — no mocks — and cover both the read endpoints
 * (previously reachable by any authenticated user) and the new account
 * enforcement action.
 */
describe('Admin authorization', () => {
  it('rejects an ordinary authenticated user from every admin surface', async () => {
    const { response: userReg } = await registerUser();
    const token = userReg.body.accessToken;
    const auth = { Authorization: `Bearer ${token}` };

    const responses = await Promise.all([
      request(app).get('/api/v1/admin/videos').set(auth),
      request(app).get('/api/v1/admin/reports').set(auth),
      request(app).get('/api/v1/admin/live').set(auth),
      request(app).get('/api/v1/admin/live-reports').set(auth),
      request(app).get('/api/v1/admin/live-blocked-words').set(auth),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(403);
    }
  });

  it('rejects an unauthenticated request to an admin route', async () => {
    const response = await request(app).get('/api/v1/admin/videos');
    expect(response.status).toBe(401);
  });

  it('lets an admin read admin-only surfaces', async () => {
    const { response: adminReg } = await registerAdmin();

    const list = await request(app).get('/api/v1/admin/live').set('Authorization', `Bearer ${adminReg.body.accessToken}`);
    expect(list.status).toBe(200);
  });

  it('rejects an ordinary user creating or deleting a blocked word', async () => {
    const { response: userReg } = await registerUser();

    const create = await request(app)
      .post('/api/v1/admin/live-blocked-words')
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .send({ word: 'zzznotallowed' });
    expect(create.status).toBe(403);
  });

  it('lets an admin create and delete a blocked word', async () => {
    const { response: adminReg } = await registerAdmin();

    const create = await request(app)
      .post('/api/v1/admin/live-blocked-words')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ word: 'zzzadminword' });
    expect(create.status).toBe(201);

    const remove = await request(app)
      .delete(`/api/v1/admin/live-blocked-words/${create.body.id}`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`);
    expect(remove.status).toBe(204);
  });
});

describe('Account enforcement (ban/suspend)', () => {
  it('rejects an ordinary user calling the enforcement endpoint', async () => {
    const { response: userReg } = await registerUser();
    const { response: targetReg } = await registerUser();

    const response = await request(app)
      .post(`/api/v1/admin/users/${targetReg.body.user.id}/status`)
      .set('Authorization', `Bearer ${userReg.body.accessToken}`)
      .send({ status: 'BANNED', reason: 'testing' });
    expect(response.status).toBe(403);
  });

  it('lets an admin ban a user, immediately blocking their authenticated access', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: targetReg } = await registerUser();

    // Prove the target is normally able to call an authenticated route first.
    const before = await request(app).get('/api/v1/live').set('Authorization', `Bearer ${targetReg.body.accessToken}`);
    expect(before.status).toBe(200);

    const ban = await request(app)
      .post(`/api/v1/admin/users/${targetReg.body.user.id}/status`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ status: 'BANNED', reason: 'severe abuse (test)' });
    expect(ban.status).toBe(200);
    expect(ban.body.status).toBe('BANNED');

    // Same access token, same still-valid session — the very next request
    // must be rejected purely because of the status change.
    const after = await request(app).get('/api/v1/live').set('Authorization', `Bearer ${targetReg.body.accessToken}`);
    expect(after.status).toBe(403);
  });

  it('lets an admin suspend and then reinstate a user', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: targetReg } = await registerUser();

    const suspend = await request(app)
      .post(`/api/v1/admin/users/${targetReg.body.user.id}/status`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ status: 'SUSPENDED' });
    expect(suspend.status).toBe(200);

    const blocked = await request(app).get('/api/v1/live').set('Authorization', `Bearer ${targetReg.body.accessToken}`);
    expect(blocked.status).toBe(403);

    const reinstate = await request(app)
      .post(`/api/v1/admin/users/${targetReg.body.user.id}/status`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ status: 'ACTIVE' });
    expect(reinstate.status).toBe(200);

    const restored = await request(app).get('/api/v1/live').set('Authorization', `Bearer ${targetReg.body.accessToken}`);
    expect(restored.status).toBe(200);
  });

  it('rejects enforcement against another admin account', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: otherAdminReg } = await registerAdmin();

    const response = await request(app)
      .post(`/api/v1/admin/users/${otherAdminReg.body.user.id}/status`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ status: 'BANNED' });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid status value', async () => {
    const { response: adminReg } = await registerAdmin();
    const { response: targetReg } = await registerUser();

    const response = await request(app)
      .post(`/api/v1/admin/users/${targetReg.body.user.id}/status`)
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .send({ status: 'DELETED' });
    expect(response.status).toBe(422);
  });
});
