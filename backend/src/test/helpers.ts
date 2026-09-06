import path from 'path';

import request from 'supertest';

import { createApp } from '@/app';
import { prisma } from '@/lib/prisma';

export const app = createApp();

export const SAMPLE_VIDEO_PATH = path.join(__dirname, 'fixtures', 'sample.mp4');
export const NOT_A_VIDEO_PATH = path.join(__dirname, 'fixtures', 'not-a-video.txt');

let counter = 0;
export function uniqueEmail(): string {
  counter += 1;
  return `test-user-${Date.now()}-${counter}@example.com`;
}

export function uniquePhone(): string {
  counter += 1;
  // +1 followed by 10 digits derived from the counter, kept within E.164 length limits.
  const suffix = String(1000000000 + counter).slice(-10);
  return `+1${suffix}`;
}

const STRONG_PASSWORD = 'Str0ng!Passw0rd';

export function isoDateNYearsAgo(years: number, dayOffset = 0): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() + dayOffset));
  return date.toISOString().slice(0, 10);
}

export async function registerUser(overrides: Partial<Record<string, unknown>> = {}) {
  const body = {
    email: uniqueEmail(),
    password: STRONG_PASSWORD,
    dateOfBirth: isoDateNYearsAgo(25),
    ...overrides,
  };
  const response = await request(app).post('/api/v1/auth/register').send(body);
  return { response, body };
}

export { STRONG_PASSWORD };

/**
 * There is no endpoint that grants admin access (see
 * middleware/requireAdmin.ts) — an operator sets it directly in the
 * database. Tests do the same thing an operator would, via Prisma, rather
 * than exercising a privilege-escalation endpoint that doesn't and
 * shouldn't exist.
 */
export async function registerAdmin(overrides: Partial<Record<string, unknown>> = {}) {
  const { response, body } = await registerUser(overrides);
  await prisma.user.update({ where: { id: response.body.user.id }, data: { isAdmin: true } });
  return { response, body };
}

export async function uploadSampleVideo(
  accessToken: string,
  overrides: { caption?: string; visibility?: 'PUBLIC' | 'PRIVATE' } = {},
) {
  let req = request(app).post('/api/v1/videos').set('Authorization', `Bearer ${accessToken}`).attach('video', SAMPLE_VIDEO_PATH);
  if (overrides.caption !== undefined) req = req.field('caption', overrides.caption);
  if (overrides.visibility !== undefined) req = req.field('visibility', overrides.visibility);
  return req;
}

/** Polls until the video leaves PROCESSING (i.e. reaches READY or FAILED), or times out. */
export async function waitForVideoSettled(videoId: string, accessToken: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await request(app).get(`/api/v1/videos/${videoId}`).set('Authorization', `Bearer ${accessToken}`);
    if (response.body.status !== 'PROCESSING') {
      return response;
    }
    if (Date.now() > deadline) {
      throw new Error(`Video ${videoId} did not leave PROCESSING within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
