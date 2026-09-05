import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { apiClient } from '@/lib/api-client';
import { authConfig } from '@/lib/auth';

export async function POST() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(authConfig.sessionCookieName)?.value;

  if (accessToken) {
    try {
      await apiClient.post('/auth/logout', undefined, { accessToken });
    } catch {
      // Best-effort: the session cookies are cleared below regardless of
      // whether the backend revocation call succeeds (e.g. token already
      // expired, or the backend is briefly unreachable).
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(authConfig.sessionCookieName);
  response.cookies.delete(authConfig.refreshCookieName);
  return response;
}
