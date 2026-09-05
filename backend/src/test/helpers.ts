import request from 'supertest';

import { createApp } from '@/app';

export const app = createApp();

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
