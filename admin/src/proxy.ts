import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { authConfig } from '@/lib/auth';

const PUBLIC_PATHS = [authConfig.loginPath];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const sessionCookie = request.cookies.get(authConfig.sessionCookieName);
  const isAuthenticated = Boolean(sessionCookie?.value);

  if (!isAuthenticated && !isPublicPath) {
    const loginUrl = new URL(authConfig.loginPath, request.url);
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthenticated && pathname === authConfig.loginPath) {
    return NextResponse.redirect(new URL(authConfig.defaultAuthedPath, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
