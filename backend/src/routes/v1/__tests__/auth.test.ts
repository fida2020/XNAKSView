import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { app, isoDateNYearsAgo, registerUser, STRONG_PASSWORD, uniqueEmail, uniquePhone } from '@/test/helpers';

describe('POST /api/v1/auth/register', () => {
  it('registers a new user with email + password and auto-logs them in', async () => {
    const { response, body } = await registerUser();

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe(body.email);
    expect(response.body.user.status).toBe('ACTIVE');
    expect(response.body.user.ageVerified).toBe(true);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: body.email } });
    expect(stored.passwordHash).not.toBe(STRONG_PASSWORD);
    expect(stored.passwordHash?.length ?? 0).toBeGreaterThan(20);
  });

  it('registers a new user with phone + password', async () => {
    const phone = uniquePhone();
    const { response } = await registerUser({ email: undefined, phone });

    expect(response.status).toBe(201);
    expect(response.body.user.phone).toBe(phone);
  });

  it('rejects duplicate email', async () => {
    const email = uniqueEmail();
    await registerUser({ email });

    const { response } = await registerUser({ email });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects duplicate phone', async () => {
    const phone = uniquePhone();
    await registerUser({ email: undefined, phone });

    const { response } = await registerUser({ email: undefined, phone });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects a weak password', async () => {
    const { response } = await registerUser({ password: 'weak' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects registration for someone under 18', async () => {
    const { response } = await registerUser({ dateOfBirth: isoDateNYearsAgo(17) });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects registration for someone one day away from turning 18', async () => {
    const { response } = await registerUser({ dateOfBirth: isoDateNYearsAgo(18, 1) });

    expect(response.status).toBe(403);
  });

  it('accepts registration for someone exactly 18 years old today', async () => {
    const { response } = await registerUser({ dateOfBirth: isoDateNYearsAgo(18) });

    expect(response.status).toBe(201);
    expect(response.body.user.ageVerified).toBe(true);
  });

  it('does not trust a client-supplied ageVerified value', async () => {
    const { response, body } = await registerUser({ ageVerified: false, status: 'ADMIN' });

    expect(response.status).toBe(201);
    expect(response.body.user.ageVerified).toBe(true);
    expect(response.body.user.status).toBe('ACTIVE');

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: body.email } });
    expect(stored.status).toBe('ACTIVE');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in with correct email + password', async () => {
    const { body } = await registerUser();

    const response = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: STRONG_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
  });

  it('logs in with correct phone + password', async () => {
    const phone = uniquePhone();
    await registerUser({ email: undefined, phone });

    const response = await request(app).post('/api/v1/auth/login').send({ phone, password: STRONG_PASSWORD });

    expect(response.status).toBe(200);
  });

  it('logs in with correct username + password', async () => {
    const { response: registerResponse, body } = await registerUser();
    const username = `u${Date.now()}`;
    await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${registerResponse.body.accessToken}`)
      .send({ username });

    const response = await request(app).post('/api/v1/auth/login').send({ username, password: body.password });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(body.email);
  });

  it('rejects invalid credentials with a generic message', async () => {
    const { body } = await registerUser();

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: 'TotallyWrong1!' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail(), password: STRONG_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('blocks login for a suspended account', async () => {
    const { body } = await registerUser();
    await prisma.user.update({ where: { email: body.email }, data: { status: 'SUSPENDED' } });

    const response = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: STRONG_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks login for a deleted (deactivated) account', async () => {
    const { body } = await registerUser();
    await prisma.user.update({ where: { email: body.email }, data: { status: 'DELETED' } });

    const response = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: STRONG_PASSWORD });

    expect(response.status).toBe(403);
  });

  it('locks out an identifier after repeated failed attempts (brute-force protection)', async () => {
    const { body } = await registerUser();

    let lastResponse;
    for (let i = 0; i < 9; i += 1) {
      lastResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: body.email, password: 'WrongPassword!1' });
    }

    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /api/v1/auth/refresh and /api/v1/auth/logout', () => {
  it('issues a new token pair and rotates the refresh token', async () => {
    const { body } = await registerUser();
    const loginResponse = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: STRONG_PASSWORD });
    const { refreshToken } = loginResponse.body;

    const refreshResponse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.refreshToken).not.toBe(refreshToken);

    const reuseResponse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reuseResponse.status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-real-token' });
    expect(response.status).toBe(401);
  });

  it('revokes the session on logout so the access token stops working', async () => {
    const { body } = await registerUser();
    const loginResponse = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: STRONG_PASSWORD });
    const { accessToken } = loginResponse.body;

    const logoutResponse = await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`);
    expect(logoutResponse.status).toBe(200);

    const meAfterLogout = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`);
    expect(meAfterLogout.status).toBe(401);
  });
});

describe('GET /api/v1/me', () => {
  it('returns the authenticated user for a valid token', async () => {
    const { response: registerResponse, body } = await registerUser();

    const response = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${registerResponse.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(body.email);
    expect(response.body.profile).toBeNull();
  });

  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/v1/me');
    expect(response.status).toBe(401);
  });

  it('rejects a request with a malformed token', async () => {
    const response = await request(app).get('/api/v1/me').set('Authorization', 'Bearer not-a-jwt');
    expect(response.status).toBe(401);
  });
});
