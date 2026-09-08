import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { registerTestOAuthIdentity } from '@/lib/oauthProviders';
import { prisma } from '@/lib/prisma';
import { app, isoDateNYearsAgo, registerUser, STRONG_PASSWORD, uniqueEmail } from '@/test/helpers';

/**
 * Google/Facebook "Continue with…" — real server-side token verification
 * only (lib/oauthProviders.ts). The `TestCaptureVerifier` swap ONLY exists
 * for `NODE_ENV=test` and only replaces the network call to Google/
 * Facebook's real servers — every bit of account-resolution logic
 * (new signup vs. direct login vs. needs-linking, age gating, duplicate
 * prevention) is the exact same code path as production.
 */

let fixtureCounter = 0;
function uniqueSlug(prefix: string): string {
  fixtureCounter += 1;
  return `${prefix}-${Date.now()}-${fixtureCounter}`;
}

describe('POST /api/v1/auth/oauth/authenticate + complete-signup (new identity)', () => {
  it('a brand-new verified Google identity gets a signup token, never an immediate account', async () => {
    const token = uniqueSlug('google-token');
    const email = uniqueEmail();
    registerTestOAuthIdentity(token, { providerAccountId: uniqueSlug('google-sub'), email, emailVerified: true, name: 'Fida Hussain', pictureUrl: 'https://example.com/pic.jpg' });

    const res = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token });
    expect(res.status).toBe(200);
    expect(res.body.isNewSignup).toBe(true);
    expect(res.body.socialSignupToken).toEqual(expect.any(String));
    expect(res.body.email).toBe(email);
    expect(res.body.suggestedUsername).toEqual(expect.any(String));
    expect(res.body.pictureUrl).toBe('https://example.com/pic.jpg');

    const existing = await prisma.user.findUnique({ where: { email } });
    expect(existing).toBeNull();
  });

  it('completes signup with the socialSignupToken — creates User + AuthIdentity + Profile together, no OTP required', async () => {
    const token = uniqueSlug('google-token');
    const email = uniqueEmail();
    const username = uniqueSlug('user').replace(/-/g, '');
    registerTestOAuthIdentity(token, { providerAccountId: uniqueSlug('google-sub'), email, emailVerified: true, name: 'Fida Hussain', pictureUrl: 'https://example.com/pic.jpg' });

    const auth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token });
    const complete = await request(app)
      .post('/api/v1/auth/oauth/complete-signup')
      .send({ socialSignupToken: auth.body.socialSignupToken, dateOfBirth: isoDateNYearsAgo(20), username });

    expect(complete.status).toBe(201);
    expect(complete.body.user.email).toBe(email);
    expect(complete.body.accessToken).toEqual(expect.any(String));

    const profile = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${complete.body.accessToken}`);
    expect(profile.status).toBe(200);
    expect(profile.body.username).toBe(username.toLowerCase());
    expect(profile.body.displayName).toBe('Fida Hussain');
    expect(profile.body.avatarUrl).toBe('https://example.com/pic.jpg');

    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${complete.body.accessToken}`);
    expect(me.body.ageVerified).toBe(true);
    expect(me.body.profile).not.toBeNull();
  });

  it('rejects an under-18 signup, and never creates a User row when it does', async () => {
    const token = uniqueSlug('google-token');
    const email = uniqueEmail();
    registerTestOAuthIdentity(token, { providerAccountId: uniqueSlug('google-sub'), email, emailVerified: true, name: 'Young Person', pictureUrl: null });

    const auth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token });
    const complete = await request(app)
      .post('/api/v1/auth/oauth/complete-signup')
      .send({ socialSignupToken: auth.body.socialSignupToken, dateOfBirth: isoDateNYearsAgo(15), username: uniqueSlug('young').replace(/-/g, '') });

    expect(complete.status).toBe(403);
    const existing = await prisma.user.findUnique({ where: { email } });
    expect(existing).toBeNull();
  });

  it('rejects a taken username at signup completion without creating a duplicate account', async () => {
    const takenUsername = uniqueSlug('taken').replace(/-/g, '');
    const { response: existingReg } = await registerUser();
    await request(app).put('/api/v1/profile').set('Authorization', `Bearer ${existingReg.body.accessToken}`).send({ username: takenUsername });

    const token = uniqueSlug('google-token');
    const email = uniqueEmail();
    registerTestOAuthIdentity(token, { providerAccountId: uniqueSlug('google-sub'), email, emailVerified: true, name: 'Someone Else', pictureUrl: null });
    const auth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token });

    const complete = await request(app)
      .post('/api/v1/auth/oauth/complete-signup')
      .send({ socialSignupToken: auth.body.socialSignupToken, dateOfBirth: isoDateNYearsAgo(20), username: takenUsername });
    expect(complete.status).toBe(409);

    const existing = await prisma.user.findUnique({ where: { email } });
    expect(existing).toBeNull();
  });

  it('never trusts an UNVERIFIED provider email to match an existing account — treated as a new signup, not linking', async () => {
    const { response: existingReg, body: existingBody } = await registerUser();
    void existingReg;

    const token = uniqueSlug('google-token');
    registerTestOAuthIdentity(token, { providerAccountId: uniqueSlug('google-sub'), email: existingBody.email, emailVerified: false, name: 'Impersonator', pictureUrl: null });

    const auth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token });
    expect(auth.body.isNewSignup).toBe(true);
    expect(auth.body.needsLinking).toBeUndefined();
  });
});

describe('POST /api/v1/auth/oauth/authenticate (existing linked identity -> direct login)', () => {
  it('a second authenticate call with the SAME provider identity logs in directly, no signup screen', async () => {
    const token = uniqueSlug('google-token');
    const email = uniqueEmail();
    const providerAccountId = uniqueSlug('google-sub');
    registerTestOAuthIdentity(token, { providerAccountId, email, emailVerified: true, name: 'Fida Hussain', pictureUrl: null });

    const firstAuth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token });
    await request(app)
      .post('/api/v1/auth/oauth/complete-signup')
      .send({ socialSignupToken: firstAuth.body.socialSignupToken, dateOfBirth: isoDateNYearsAgo(20), username: uniqueSlug('user').replace(/-/g, '') });

    // A fresh token registered for the SAME provider identity (simulates logging out and signing in again).
    const secondToken = uniqueSlug('google-token');
    registerTestOAuthIdentity(secondToken, { providerAccountId, email, emailVerified: true, name: 'Fida Hussain', pictureUrl: null });

    const secondAuth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token: secondToken });
    expect(secondAuth.status).toBe(200);
    expect(secondAuth.body.user.email).toBe(email);
    expect(secondAuth.body.accessToken).toEqual(expect.any(String));
    expect(secondAuth.body.isNewSignup).toBeUndefined();
  });

  it('blocks direct login for a suspended account', async () => {
    const token = uniqueSlug('google-token');
    const email = uniqueEmail();
    const providerAccountId = uniqueSlug('google-sub');
    registerTestOAuthIdentity(token, { providerAccountId, email, emailVerified: true, name: 'Fida', pictureUrl: null });

    const auth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token });
    await request(app)
      .post('/api/v1/auth/oauth/complete-signup')
      .send({ socialSignupToken: auth.body.socialSignupToken, dateOfBirth: isoDateNYearsAgo(20), username: uniqueSlug('user').replace(/-/g, '') });
    await prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

    const secondToken = uniqueSlug('google-token');
    registerTestOAuthIdentity(secondToken, { providerAccountId, email, emailVerified: true, name: 'Fida', pictureUrl: null });
    const secondAuth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token: secondToken });
    expect(secondAuth.status).toBe(403);
  });
});

describe('POST /api/v1/auth/oauth/authenticate + link (account linking)', () => {
  it('a verified provider email matching an existing password account requires linking, never a silent duplicate or silent takeover', async () => {
    const { body: existingBody } = await registerUser();

    const token = uniqueSlug('google-token');
    registerTestOAuthIdentity(token, { providerAccountId: uniqueSlug('google-sub'), email: existingBody.email, emailVerified: true, name: 'Fida Hussain', pictureUrl: null });

    const auth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token });
    expect(auth.status).toBe(200);
    expect(auth.body.needsLinking).toBe(true);
    expect(auth.body.linkingToken).toEqual(expect.any(String));
    expect(auth.body.maskedEmail).not.toBe(existingBody.email);

    const usersWithEmail = await prisma.user.findMany({ where: { email: existingBody.email } });
    expect(usersWithEmail).toHaveLength(1); // never duplicated
  });

  it('rejects linking with the wrong password', async () => {
    const { response: existingReg, body: existingBody } = await registerUser();

    const token = uniqueSlug('google-token');
    registerTestOAuthIdentity(token, { providerAccountId: uniqueSlug('google-sub'), email: existingBody.email, emailVerified: true, name: 'Fida', pictureUrl: null });
    const auth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token });

    const link = await request(app).post('/api/v1/auth/oauth/link').send({ linkingToken: auth.body.linkingToken, password: 'TotallyWrong1!' });
    expect(link.status).toBe(401);

    const identity = await prisma.authIdentity.findFirst({ where: { userId: existingReg.body.user.id } });
    expect(identity).toBeNull(); // never linked with the wrong password
  });

  it('links with the correct password, then future sign-ins with that provider log in directly', async () => {
    const { response: existingReg, body: existingBody } = await registerUser();
    void existingReg;

    const providerAccountId = uniqueSlug('google-sub');
    const token = uniqueSlug('google-token');
    registerTestOAuthIdentity(token, { providerAccountId, email: existingBody.email, emailVerified: true, name: 'Fida', pictureUrl: null });
    const auth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token });

    const link = await request(app).post('/api/v1/auth/oauth/link').send({ linkingToken: auth.body.linkingToken, password: STRONG_PASSWORD });
    expect(link.status).toBe(200);
    expect(link.body.user.email).toBe(existingBody.email);

    const secondToken = uniqueSlug('google-token');
    registerTestOAuthIdentity(secondToken, { providerAccountId, email: existingBody.email, emailVerified: true, name: 'Fida', pictureUrl: null });
    const secondAuth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token: secondToken });
    expect(secondAuth.status).toBe(200);
    expect(secondAuth.body.isNewSignup).toBeUndefined();
    expect(secondAuth.body.needsLinking).toBeUndefined();
    expect(secondAuth.body.user.email).toBe(existingBody.email);
  });
});

describe('validation and honest refusal', () => {
  it('rejects an unverifiable/garbage token', async () => {
    const res = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'GOOGLE', token: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });

  it('Facebook works identically to Google through the same endpoint', async () => {
    const token = uniqueSlug('fb-token');
    const email = uniqueEmail();
    registerTestOAuthIdentity(token, { providerAccountId: uniqueSlug('fb-id'), email, emailVerified: true, name: 'FB User', pictureUrl: null });

    const auth = await request(app).post('/api/v1/auth/oauth/authenticate').send({ provider: 'FACEBOOK', token });
    expect(auth.status).toBe(200);
    expect(auth.body.isNewSignup).toBe(true);
  });
});
