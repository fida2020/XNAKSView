import { NextResponse } from 'next/server';

import { ApiError, apiClient } from '@/lib/api-client';
import { refreshCookieOptions, sessionCookieOptions, authConfig } from '@/lib/auth';

interface BackendAuthResponse {
  user: { id: string; email: string | null; phone: string | null; status: string };
  accessToken: string;
  refreshToken: string;
}

/// Authenticates against the same backend `/auth/login` every other
/// XNAKView client uses — there is no separate admin-only credential store
/// yet, since the schema has no role/permission concept in Step 2. This is a
/// deliberate foundation-stage limitation: it proves the login/session
/// plumbing end-to-end, and gets replaced with real role-gated admin auth
/// once that concept exists.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.password !== 'string' || (!body.email && !body.phone)) {
    return NextResponse.json({ error: { message: 'Email or phone and password are required' } }, { status: 400 });
  }

  try {
    const data = await apiClient.post<BackendAuthResponse>('/auth/login', {
      email: body.email || undefined,
      phone: body.phone || undefined,
      password: body.password,
    });

    const response = NextResponse.json({ user: data.user });
    response.cookies.set(authConfig.sessionCookieName, data.accessToken, sessionCookieOptions());
    response.cookies.set(authConfig.refreshCookieName, data.refreshToken, refreshCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    return NextResponse.json({ error: { message: 'Unable to reach the backend' } }, { status: 502 });
  }
}
