import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { env } from '@/config/env';
import { getSessionAccessToken } from '@/lib/session';

/// Browser `<img>`/`<video>` tags can't attach an Authorization header, but
/// every backend media endpoint requires one — this proxies media requests
/// through the admin's own session (same pattern the backend itself uses to
/// proxy local-disk storage behind an authenticated route). Generic over any
/// backend path so it covers both video files and thumbnails.
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const accessToken = await getSessionAccessToken();
  if (!accessToken) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const range = request.headers.get('range');
  const backendResponse = await fetch(`${env.apiBaseUrl}/${path.join('/')}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(range ? { Range: range } : {}),
    },
    cache: 'no-store',
  });

  const headers = new Headers();
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = backendResponse.headers.get(key);
    if (value) headers.set(key, value);
  }

  return new NextResponse(backendResponse.body, { status: backendResponse.status, headers });
}
