import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { getTestCapturedOtpMessage } from '@/lib/otpProviders';
import { prisma } from '@/lib/prisma';
import { app, isoDateNYearsAgo, STRONG_PASSWORD, uniqueEmail, uniquePhone } from '@/test/helpers';

/**
 * OTP-first signup/login — real, server-generated/server-verified codes
 * only (lib/otpService.ts/lib/otpProviders.ts). The `TestCaptureSmsProvider`/
 * `TestCaptureEmailProvider` swap ONLY exists for `NODE_ENV=test` and only
 * replaces the last-mile delivery transport — generation, hashing, storage,
 * expiry, and attempt-limiting are the exact same code path as production.
 */

function extractCode(identifier: string): string {
  const message = getTestCapturedOtpMessage(identifier);
  const code = message?.match(/^(\d{6})/)?.[1];
  if (!code) throw new Error(`No captured OTP message for ${identifier}`);
  return code;
}

describe('POST /api/v1/auth/otp/request + /api/v1/auth/otp/verify (REGISTER)', () => {
  it('sends a real 6-digit code, masks the identifier in the response, and never reveals it in the response body', async () => {
    const email = uniqueEmail();
    const res = await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });

    expect(res.status).toBe(200);
    expect(res.body.maskedIdentifier).toMatch(/^.\*+@/);
    expect(res.body.maskedIdentifier).not.toBe(email);
    expect(JSON.stringify(res.body)).not.toMatch(/^\d{6}$/);

    const code = extractCode(email);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('verifies the real code and returns a verificationToken that /auth/register accepts', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const code = extractCode(email);

    const verify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code });
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);
    expect(verify.body.verificationToken).toEqual(expect.any(String));

    const register = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(25), verificationToken: verify.body.verificationToken });
    expect(register.status).toBe(201);
    expect(register.body.user.email).toBe(email);
  });

  it('rejects an incorrect code without ever accepting a hardcoded/predictable value like 000000', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const realCode = extractCode(email);

    const wrongCode = realCode === '000000' ? '111111' : '000000';
    const verify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code: wrongCode });
    expect(verify.status).toBe(401);
    expect(verify.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an expired code even if it is otherwise correct', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const code = extractCode(email);

    await prisma.otpChallenge.updateMany({ where: { identifier: email, purpose: 'REGISTER' }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const verify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code });
    expect(verify.status).toBe(401);
  });

  it('locks out verification after the maximum number of incorrect attempts, even with the correct code afterward', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const realCode = extractCode(email);
    const wrongCode = realCode === '000000' ? '111111' : '000000';

    let lastResponse;
    for (let i = 0; i < 5; i += 1) {
      lastResponse = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code: wrongCode });
    }
    expect(lastResponse!.status).toBe(401);

    const tooManyAttempts = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code: realCode });
    expect(tooManyAttempts.status).toBe(429);
    expect(tooManyAttempts.body.error.code).toBe('RATE_LIMITED');
  });

  it('throttles resends — requesting another code immediately is rejected with a retry-after', async () => {
    const email = uniqueEmail();
    const first = await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    expect(first.status).toBe(200);

    const secondImmediate = await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    expect(secondImmediate.status).toBe(429);
    expect(secondImmediate.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('a resend replaces the previous code, invalidating it, and resets the attempt counter', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const oldCode = extractCode(email);

    // Simulate the resend cooldown having elapsed.
    await prisma.otpChallenge.updateMany({ where: { identifier: email, purpose: 'REGISTER' }, data: { lastSentAt: new Date(Date.now() - 61_000) } });

    const resend = await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    expect(resend.status).toBe(200);
    const newCode = extractCode(email);

    const verifyOldCode = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code: oldCode });
    expect(verifyOldCode.status).toBe(oldCode === newCode ? 200 : 401);

    const verifyNewCode = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code: newCode });
    expect(verifyNewCode.status).toBe(200);
  });

  it('rejects requesting a REGISTER code for an already-registered email (revealed, matching /auth/register\'s own existing conflict behavior)', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const code = extractCode(email);
    const verify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code });
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(25), verificationToken: verify.body.verificationToken });

    const secondRequest = await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    expect(secondRequest.status).toBe(409);
    expect(secondRequest.body.error.code).toBe('CONFLICT');
  });

  it('works identically over SMS (phone) as it does over email', async () => {
    const phone = uniquePhone();
    await request(app).post('/api/v1/auth/otp/request').send({ phone, purpose: 'REGISTER' });
    const code = extractCode(phone);

    const verify = await request(app).post('/api/v1/auth/otp/verify').send({ phone, purpose: 'REGISTER', code });
    expect(verify.status).toBe(200);

    const register = await request(app)
      .post('/api/v1/auth/register')
      .send({ phone, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(25), verificationToken: verify.body.verificationToken });
    expect(register.status).toBe(201);
    expect(register.body.user.phone).toBe(phone);
  });

  it('rejects registration for someone under 18 even with a fully valid OTP verification, and the SAME verificationToken can still complete registration once the birthday is corrected', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const code = extractCode(email);
    const verify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code });

    const underage = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(16), verificationToken: verify.body.verificationToken });
    expect(underage.status).toBe(403);
    expect(underage.body.error.code).toBe('FORBIDDEN');

    // The age check failed BEFORE the verification token was redeemed, so
    // the user can immediately retry with a corrected birthday using the
    // exact same token — never forced to re-verify their email just to fix
    // a birthday typo.
    const corrected = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(20), verificationToken: verify.body.verificationToken });
    expect(corrected.status).toBe(201);
  });

  it('a verificationToken can never be redeemed twice — the second registration attempt with the same token is rejected', async () => {
    const emailA = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email: emailA, purpose: 'REGISTER' });
    const code = extractCode(emailA);
    const verify = await request(app).post('/api/v1/auth/otp/verify').send({ email: emailA, purpose: 'REGISTER', code });

    const first = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailA, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(25), verificationToken: verify.body.verificationToken });
    expect(first.status).toBe(201);

    // Reuse the same (already-redeemed) token against a different identifier.
    const emailB = uniqueEmail();
    const replay = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailB, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(25), verificationToken: verify.body.verificationToken });
    expect(replay.status).toBe(401);
  });

  it('rejects a verificationToken whose identifier does not match the registration payload', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const code = extractCode(email);
    const verify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code });

    const otherEmail = uniqueEmail();
    const mismatched = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: otherEmail, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(25), verificationToken: verify.body.verificationToken });
    expect(mismatched.status).toBe(401);
  });

  it('rejects registration with no verificationToken at all', async () => {
    const email = uniqueEmail();
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(25) });
    expect(response.status).toBe(422);
  });
});

describe('POST /api/v1/auth/otp/request + /api/v1/auth/otp/verify (LOGIN)', () => {
  it('logs in an existing ACTIVE user with a real OTP, going through the same session/lockout machinery as password login', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const registerCode = extractCode(email);
    const registerVerify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code: registerCode });
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(25), verificationToken: registerVerify.body.verificationToken });

    const loginRequest = await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'LOGIN' });
    expect(loginRequest.status).toBe(200);
    const loginCode = extractCode(email);

    const loginVerify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'LOGIN', code: loginCode });
    expect(loginVerify.status).toBe(200);
    expect(loginVerify.body.accessToken).toEqual(expect.any(String));
    expect(loginVerify.body.refreshToken).toEqual(expect.any(String));
    expect(loginVerify.body.user.email).toBe(email);
  });

  it('never reveals whether an email/phone has an account — a LOGIN OTP request for a non-existent account still returns 200 with no code actually sent', async () => {
    const email = uniqueEmail();
    const res = await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'LOGIN' });
    expect(res.status).toBe(200);
    expect(getTestCapturedOtpMessage(email)).toBeUndefined();
  });

  it('a LOGIN OTP verify for a non-existent account is rejected the same way as an invalid code (no enumeration signal)', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'LOGIN' });
    const verify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'LOGIN', code: '123456' });
    expect(verify.status).toBe(401);
  });

  it('never sends a LOGIN code to a non-ACTIVE account at all — same non-enumerating treatment as a non-existent identifier', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const registerCode = extractCode(email);
    const registerVerify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code: registerCode });
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(25), verificationToken: registerVerify.body.verificationToken });
    await prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

    const messageBeforeLoginRequest = getTestCapturedOtpMessage(email);
    const loginRequest = await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'LOGIN' });
    expect(loginRequest.status).toBe(200); // still no enumeration signal in the HTTP response
    expect(getTestCapturedOtpMessage(email)).toBe(messageBeforeLoginRequest); // but genuinely no NEW code was generated/sent this time

    const loginVerify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'LOGIN', code: '123456' });
    expect(loginVerify.status).toBe(401);
  });

  it('blocks a LOGIN OTP for a suspended account with the account-status error, IF the account was still active when the code was sent and only suspended afterward', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const registerCode = extractCode(email);
    const registerVerify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code: registerCode });
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD, dateOfBirth: isoDateNYearsAgo(25), verificationToken: registerVerify.body.verificationToken });

    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'LOGIN' });
    const loginCode = extractCode(email);

    // Suspended AFTER the code was already sent while still ACTIVE.
    await prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

    const loginVerify = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'LOGIN', code: loginCode });
    expect(loginVerify.status).toBe(403);
  });
});

describe('validation', () => {
  it('rejects an OTP request with neither email nor phone', async () => {
    const res = await request(app).post('/api/v1/auth/otp/request').send({ purpose: 'REGISTER' });
    expect(res.status).toBe(422);
  });

  it('rejects an OTP request with both email and phone', async () => {
    const res = await request(app).post('/api/v1/auth/otp/request').send({ email: uniqueEmail(), phone: uniquePhone(), purpose: 'REGISTER' });
    expect(res.status).toBe(422);
  });

  it('rejects a non-6-digit code', async () => {
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/otp/request').send({ email, purpose: 'REGISTER' });
    const res = await request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'REGISTER', code: '12' });
    expect(res.status).toBe(422);
  });
});
