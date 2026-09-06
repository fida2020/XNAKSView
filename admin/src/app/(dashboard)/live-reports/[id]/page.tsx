import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, apiClient } from '@/lib/api-client';
import { getSessionAccessToken } from '@/lib/session';

interface AdminLiveReportDetail {
  id: string;
  reason: string;
  description: string | null;
  status: 'PENDING' | 'REVIEWED' | 'DISMISSED' | 'ACTIONED';
  createdAt: string;
  reporter: { id: string; email: string | null; phone: string | null };
  liveSession: {
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
  };
}

async function getLiveReport(id: string): Promise<AdminLiveReportDetail | null> {
  const accessToken = await getSessionAccessToken();
  try {
    return await apiClient.get<AdminLiveReportDetail>(`/admin/live-reports/${id}`, { accessToken });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export default async function LiveReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getLiveReport(id);
  if (!report) notFound();

  return (
    <div>
      <Link href="/live-reports" className="text-sm underline underline-offset-2">
        ← Back to LIVE reports
      </Link>

      <h1 className="mt-2 text-2xl font-semibold">Report: {report.reason}</h1>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          {report.liveSession.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/media/live/${report.liveSession.id}/thumbnail`}
              alt=""
              className="w-full rounded-lg bg-black/5 object-cover dark:bg-white/10"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg bg-black/5 dark:bg-white/10">
              <p className="text-sm text-black/60 dark:text-white/60">
                Not playable ({report.liveSession.status})
              </p>
            </div>
          )}
          <Link href={`/live/${report.liveSession.id}`} className="mt-2 block text-sm underline underline-offset-2">
            View full LIVE session details →
          </Link>
        </div>

        <dl className="space-y-2 text-sm">
          <Row label="Report ID" value={report.id} />
          <Row label="Status" value={report.status} />
          <Row label="Reported by" value={report.reporter.email ?? report.reporter.phone ?? report.reporter.id} />
          <Row label="LIVE title" value={report.liveSession.title} />
          <Row label="LIVE status" value={report.liveSession.status} />
          <Row label="Reported at" value={new Date(report.createdAt).toLocaleString()} />
        </dl>
      </div>

      {report.description && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-black/50 dark:text-white/50">Reporter&apos;s description</h2>
          <p className="mt-1 text-sm">{report.description}</p>
        </div>
      )}

      <p className="mt-10 text-xs text-black/40 dark:text-white/40">
        This is an inspection-only view — taking action on a report (dismiss/actioned, ending the LIVE session) is
        not part of this step.
      </p>
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
