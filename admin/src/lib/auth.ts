const SESSION_COOKIE = 'xnakview_admin_session';

/// Auth-ready helper: today this only checks whether a session cookie is
/// present so route protection has something real to key off of. Phase 2
/// replaces this with actual session verification (e.g. validating the
/// token against the backend or a signed session).
export function hasSessionCookie(cookieHeader: string | undefined | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${SESSION_COOKIE}=`) && part.length > SESSION_COOKIE.length + 1);
}

export const authConfig = {
  sessionCookieName: SESSION_COOKIE,
  loginPath: '/login',
  defaultAuthedPath: '/dashboard',
};
