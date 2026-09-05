import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { authConfig } from '@/lib/auth';
import { env } from '@/config/env';

const PUBLIC_PATHS = [authConfig.loginPath];

function redirectToLogin(request: NextRequest, pathname: string) {
  const loginUrl = new URL(authConfig.loginPath, request.url);
  loginUrl.searchParams.set('redirectTo', pathname);
  const response = NextResponse.redirect(loginUrl);
  // The cookie we just failed to verify is either missing, expired, or
  // revoked — clear it so the browser doesn't keep sending a dead token.
  response.cookies.delete(authConfig.sessionCookieName);
  response.cookies.delete(authConfig.refreshCookieName);
  return response;
}

/**
 * Verifies the session against the backend on every protected navigation,
 * rather than just checking that a cookie is present. This runs in
 * middleware (before any page starts rendering/streaming) deliberately —
 * doing this check inside a Server Component under a route with a
 * `loading.tsx` boundary causes `redirect()` to fight with React's
 * streaming/hydration and throw, instead of cleanly navigating.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const accessToken = request.cookies.get(authConfig.sessionCookieName)?.value;

  if (!accessToken) {
    return isPublicPath ? NextResponse.next() : redirectToLogin(request, pathname);
  }

  let isValidSession = false;
  try {
    const response = await fetch(`${env.apiBaseUrl}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    isValidSession = response.ok;
  } catch {
    // Backend unreachable — fail closed rather than let an unverifiable
    // session through to admin pages.
    isValidSession = false;
  }

  if (!isValidSession) {
    return isPublicPath ? NextResponse.next() : redirectToLogin(request, pathname);
  }

  if (isPublicPath) {
    return NextResponse.redirect(new URL(authConfig.defaultAuthedPath, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
