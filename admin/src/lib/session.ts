import { cookies } from 'next/headers';

import { authConfig } from '@/lib/auth';

/// Server Component / Route Handler only (uses `next/headers`) — kept out of
/// `lib/auth.ts` because that module is also imported by `proxy.ts`, which
/// runs in the Edge middleware runtime where `next/headers`'s `cookies()`
/// isn't the right API.
export async function getSessionAccessToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(authConfig.sessionCookieName)?.value;
}
