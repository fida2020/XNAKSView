import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, apiClient } from '@/lib/api-client';
import { getSessionAccessToken } from '@/lib/session';

interface AdminLiveSessionDetail {
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
  reports: Array<{
    id: string;
    reason: string;
    description: string | null;
    status: string;
    createdAt: string;
  }>;
}

async function getLiveSession(id: string): Promise<AdminLiveSessionDetail | null> {
  const accessToken = await getSessionAccessToken();
  try {
    return await apiClient.get<AdminLiveSessionDetail>(`/admin/live/${id}`, { accessToken });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export default async function LiveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const liveSession = await getLiveSession(id);
  if (!liveSession) notFound();

  return (
    <div>
      <Link href="/live" className="text-sm underline underline-offset-2">
        ← Back to LIVE
      </Link>

      <h1 className="mt-2 text-2xl font-semibold">{liveSession.title}</h1>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          {liveSession.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/media/live/${liveSession.id}/thumbnail`}
              alt=""
              className="w-full rounded-lg bg-black/5 object-cover dark:bg-white/10"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg bg-black/5 dark:bg-white/10">
              <p className="text-sm text-black/60 dark:text-white/60">No thumbnail</p>
            </div>
          )}
          <p className="mt-2 text-xs text-black/40 dark:text-white/40">
            This is an inspection-only view — LIVE video playback is not proxied here (WebRTC, not an HTTP
            file/stream), only the session&apos;s metadata and thumbnail.
          </p>
        </div>

        <dl className="space-y-2 text-sm">
          <Row label="Session ID" value={liveSession.id} />
          <Row
            label="Host"
            value={liveSession.hostAccount.email ?? liveSession.hostAccount.phone ?? liveSession.hostAccount.id}
          />
          <Row label="Status" value={liveSession.status} />
          <Row label="Category" value={liveSession.category ?? '—'} />
          <Row label="Viewer count" value={String(liveSession.viewerCount)} />
          <Row label="Peak viewers" value={String(liveSession.peakViewerCount)} />
          <Row label="Started" value={new Date(liveSession.startedAt).toLocaleString()} />
          <Row label="Ended" value={liveSession.endedAt ? new Date(liveSession.endedAt).toLocaleString() : '—'} />
        </dl>
      </div>

      <h2 className="mt-10 text-lg font-semibold">Reports ({liveSession.reports.length})</h2>
      {liveSession.reports.length === 0 ? (
        <p className="mt-2 text-sm text-black/50 dark:text-white/50">No reports for this LIVE session.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {liveSession.reports.map((report) => (
            <li key={report.id} className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
              <div className="flex items-center justify-between">
                <span className="font-medium">{report.reason}</span>
                <span className="text-xs text-black/50 dark:text-white/50">{report.status}</span>
              </div>
              {report.description && <p className="mt-1 text-black/70 dark:text-white/70">{report.description}</p>}
              <p className="mt-1 text-xs text-black/40 dark:text-white/40">{new Date(report.createdAt).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-black/5 py-1.5 dark:border-white/5">
      <dt className="text-black/50 dark:text-white/50">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
