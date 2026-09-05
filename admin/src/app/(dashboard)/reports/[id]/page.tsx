import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, apiClient } from '@/lib/api-client';
import { getSessionAccessToken } from '@/lib/session';

interface AdminReportDetail {
  id: string;
  reason: string;
  description: string | null;
  status: 'PENDING' | 'REVIEWED' | 'DISMISSED' | 'ACTIONED';
  createdAt: string;
  reporter: { id: string; email: string | null; phone: string | null };
  video: {
    id: string;
    caption: string | null;
    status: 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';
    userId: string;
  };
}

async function getReport(id: string): Promise<AdminReportDetail | null> {
  const accessToken = await getSessionAccessToken();
  try {
    return await apiClient.get<AdminReportDetail>(`/admin/reports/${id}`, { accessToken });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();

  return (
    <div>
      <Link href="/reports" className="text-sm underline underline-offset-2">
        ← Back to reports
      </Link>

      <h1 className="mt-2 text-2xl font-semibold">Report: {report.reason}</h1>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          {report.video.status === 'READY' ? (
            <video controls className="w-full rounded-lg bg-black" src={`/api/media/videos/${report.video.id}/file`} />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg bg-black/5 dark:bg-white/10">
              <p className="text-sm text-black/60 dark:text-white/60">Not playable ({report.video.status})</p>
            </div>
          )}
          <Link href={`/videos/${report.video.id}`} className="mt-2 block text-sm underline underline-offset-2">
            View full video details →
          </Link>
        </div>

        <dl className="space-y-2 text-sm">
          <Row label="Report ID" value={report.id} />
          <Row label="Status" value={report.status} />
          <Row label="Reported by" value={report.reporter.email ?? report.reporter.phone ?? report.reporter.id} />
          <Row label="Video caption" value={report.video.caption || '(no caption)'} />
          <Row label="Video status" value={report.video.status} />
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
        This is an inspection-only view — taking action on a report (dismiss/actioned, video takedown) is not part of
        this step.
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
