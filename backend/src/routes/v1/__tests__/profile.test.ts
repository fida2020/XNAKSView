import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, registerUser } from '@/test/helpers';

async function registerAndGetToken(overrides: Partial<Record<string, unknown>> = {}) {
  const { response } = await registerUser(overrides);
  return response.body.accessToken as string;
}

describe('GET /api/v1/profile', () => {
  it('returns 404 before a profile has been created', async () => {
    const token = await registerAndGetToken();
    const response = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app).get('/api/v1/profile');
    expect(response.status).toBe(401);
  });
});

describe('PUT /api/v1/profile', () => {
  it('creates a profile for the authenticated user', async () => {
    const token = await registerAndGetToken();

    const response = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'ProfileUser', displayName: 'Profile User', bio: 'Hello world', country: 'PK', city: 'Karachi' });

    expect(response.status).toBe(200);
    expect(response.body.username).toBe('profileuser'); // normalized to lowercase
    expect(response.body.displayName).toBe('Profile User');
  });

  it('updates an existing profile idempotently', async () => {
    const token = await registerAndGetToken();
    await request(app).put('/api/v1/profile').set('Authorization', `Bearer ${token}`).send({ username: 'updater1' });

    const response = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'updater1', bio: 'Updated bio' });

    expect(response.status).toBe(200);
    expect(response.body.bio).toBe('Updated bio');
  });

  it('rejects a duplicate username from a different user', async () => {
    const tokenA = await registerAndGetToken();
    const tokenB = await registerAndGetToken();

    await request(app).put('/api/v1/profile').set('Authorization', `Bearer ${tokenA}`).send({ username: 'takenname' });
    const response = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ username: 'takenname' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects an invalid username', async () => {
    const token = await registerAndGetToken();
    const response = await request(app).put('/api/v1/profile').set('Authorization', `Bearer ${token}`).send({ username: '1nvalid' });
    expect(response.status).toBe(422);
  });

  it('rejects a bio over the length limit', async () => {
    const token = await registerAndGetToken();
    const response = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'biolimituser', bio: 'x'.repeat(301) });
    expect(response.status).toBe(422);
  });

  it('rejects a non-https avatarUrl', async () => {
    const token = await registerAndGetToken();
    const response = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'avataruser', avatarUrl: 'http://example.com/avatar.png' });
    expect(response.status).toBe(422);
  });

  it('never lets a user modify another user\'s profile', async () => {
    const tokenA = await registerAndGetToken();
    const tokenB = await registerAndGetToken();

    await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ username: 'owneruser', displayName: 'Original' });

    // User B can only ever act on their own profile — there is no route
    // parameter to target user A's profile, so this creates B's own record.
    await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ username: 'otheruser', displayName: 'Attempted takeover' });

    const ownerProfile = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${tokenA}`);
    expect(ownerProfile.body.displayName).toBe('Original');
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app).put('/api/v1/profile').send({ username: 'noauth' });
    expect(response.status).toBe(401);
  });
});
