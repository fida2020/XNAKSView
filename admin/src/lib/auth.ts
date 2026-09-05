const SESSION_COOKIE = 'xnakview_admin_session';
const REFRESH_COOKIE = 'xnakview_admin_refresh';

export const authConfig = {
  sessionCookieName: SESSION_COOKIE,
  refreshCookieName: REFRESH_COOKIE,
  loginPath: '/login',
  defaultAuthedPath: '/dashboard',
};

// Admin sessions mirror the backend's own JWT_ACCESS_TTL / JWT_REFRESH_TTL
// (15m / 30d) — kept in sync manually since the admin app doesn't share the
// backend's env config.
export const SESSION_COOKIE_MAX_AGE_SECONDS = 15 * 60;
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  };
}
