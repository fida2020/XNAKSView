import Link from 'next/link';

import { apiClient } from '@/lib/api-client';
import { getSessionAccessToken } from '@/lib/session';

interface AdminLiveSession {
  id: string;
  hostId: string;
  title: string;
  category: string | null;
  thumbnailUrl: string | null;
  status: 'LIVE' | 'ENDED';
  viewerCount: number;
  peakViewerCount: number;
  startedAt: string;
  endedAt: string | null;
  hostAccount: { id: string; email: string | null; phone: string | null };
}

interface AdminLiveListResponse {
  liveSessions: AdminLiveSession[];
  nextCursor: string | null;
}

async function getLiveSessions(cursor?: string, status?: string): Promise<AdminLiveListResponse> {
  const accessToken = await getSessionAccessToken();
  const params = new URLSearchParams({ limit: '20' });
  if (cursor) params.set('cursor', cursor);
  if (status) params.set('status', status);
  return apiClient.get<AdminLiveListResponse>(`/admin/live?${params.toString()}`, { accessToken });
}

const STATUS_FILTERS = ['LIVE', 'ENDED'] as const;

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string }>;
}) {
  const { cursor, status } = await searchParams;
  const { liveSessions, nextCursor } = await getLiveSessions(cursor, status);

  return (
    <div>
      <h1 className="text-2xl font-semibold">LIVE</h1>

      <div className="mt-4 flex gap-2 text-sm">
        <Link
          href="/live"
          className={`rounded-full px-3 py-1 ${!status ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/15 dark:border-white/15'}`}
        >
          All
        </Link>
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={`/live?status=${s}`}
            className={`rounded-full px-3 py-1 ${status === s ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/15 dark:border-white/15'}`}
          >
            {s}
          </Link>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-black/50 dark:border-white/10 dark:text-white/50">
              <th className="py-2 pr-4">Thumbnail</th>
              <th className="py-2 pr-4">Title</th>
              <th className="py-2 pr-4">Host</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Viewers</th>
              <th className="py-2 pr-4">Peak</th>
              <th className="py-2 pr-4">Started</th>
            </tr>
          </thead>
          <tbody>
            {liveSessions.map((session) => (
              <tr key={session.id} className="border-b border-black/5 dark:border-white/5">
                <td className="py-2 pr-4">
                  {session.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media/live/${session.id}/thumbnail`}
                      alt=""
                      className="h-14 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-10 items-center justify-center rounded bg-black/5 text-[10px] dark:bg-white/10">
                      —
                    </div>
                  )}
                </td>
                <td className="py-2 pr-4 max-w-xs truncate">
                  <Link href={`/live/${session.id}`} className="underline underline-offset-2">
                    {session.title}
                  </Link>
                  {session.category && (
                    <span className="ml-1 text-xs text-black/40 dark:text-white/40">({session.category})</span>
                  )}
                </td>
                <td className="py-2 pr-4">{session.hostAccount.email ?? session.hostAccount.phone}</td>
                <td className="py-2 pr-4">
                  <span
                    className={
                      session.status === 'LIVE'
                        ? 'rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white'
                        : 'text-black/60 dark:text-white/60'
                    }
                  >
                    {session.status}
                  </span>
                </td>
                <td className="py-2 pr-4">{session.viewerCount}</td>
                <td className="py-2 pr-4">{session.peakViewerCount}</td>
                <td className="py-2 pr-4">{new Date(session.startedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {liveSessions.length === 0 && (
          <p className="py-8 text-center text-black/50 dark:text-white/50">No LIVE sessions found.</p>
        )}
      </div>

      {nextCursor && (
        <div className="mt-4">
          <Link
            href={`/live?${new URLSearchParams({ ...(status ? { status } : {}), cursor: nextCursor }).toString()}`}
            className="text-sm underline underline-offset-2"
          >
            Next page →
          </Link>
        </div>
      )}
    </div>
  );
}
