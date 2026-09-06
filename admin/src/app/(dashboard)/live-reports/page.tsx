import Link from 'next/link';

import { apiClient } from '@/lib/api-client';
import { getSessionAccessToken } from '@/lib/session';

interface AdminLiveReport {
  id: string;
  reason: string;
  status: 'PENDING' | 'REVIEWED' | 'DISMISSED' | 'ACTIONED';
  createdAt: string;
  liveSession: { id: string; title: string; status: 'LIVE' | 'ENDED'; hostId: string };
  reporter: { id: string; email: string | null; phone: string | null };
}

interface AdminLiveReportListResponse {
  reports: AdminLiveReport[];
  nextCursor: string | null;
}

async function getLiveReports(cursor?: string, status?: string): Promise<AdminLiveReportListResponse> {
  const accessToken = await getSessionAccessToken();
  const params = new URLSearchParams({ limit: '20' });
  if (cursor) params.set('cursor', cursor);
  if (status) params.set('status', status);
  return apiClient.get<AdminLiveReportListResponse>(`/admin/live-reports?${params.toString()}`, { accessToken });
}

const STATUS_FILTERS = ['PENDING', 'REVIEWED', 'DISMISSED', 'ACTIONED'] as const;

export default async function LiveReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string }>;
}) {
  const { cursor, status } = await searchParams;
  const { reports, nextCursor } = await getLiveReports(cursor, status);

  return (
    <div>
      <h1 className="text-2xl font-semibold">LIVE Reports</h1>

      <div className="mt-4 flex gap-2 text-sm">
        <Link
          href="/live-reports"
          className={`rounded-full px-3 py-1 ${!status ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/15 dark:border-white/15'}`}
        >
          All
        </Link>
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={`/live-reports?status=${s}`}
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
              <th className="py-2 pr-4">Reason</th>
              <th className="py-2 pr-4">LIVE session</th>
              <th className="py-2 pr-4">Reporter</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Reported</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id} className="border-b border-black/5 dark:border-white/5">
                <td className="py-2 pr-4">
                  <Link href={`/live-reports/${report.id}`} className="underline underline-offset-2">
                    {report.reason}
                  </Link>
                </td>
                <td className="py-2 pr-4 max-w-xs truncate">
                  <Link href={`/live/${report.liveSession.id}`} className="underline underline-offset-2">
                    {report.liveSession.title}
                  </Link>
                  <span className="ml-1 text-xs text-black/40 dark:text-white/40">({report.liveSession.status})</span>
                </td>
                <td className="py-2 pr-4">{report.reporter.email ?? report.reporter.phone}</td>
                <td className="py-2 pr-4">{report.status}</td>
                <td className="py-2 pr-4">{new Date(report.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {reports.length === 0 && (
          <p className="py-8 text-center text-black/50 dark:text-white/50">No LIVE reports found.</p>
        )}
      </div>

      {nextCursor && (
        <div className="mt-4">
          <Link
            href={`/live-reports?${new URLSearchParams({ ...(status ? { status } : {}), cursor: nextCursor }).toString()}`}
            className="text-sm underline underline-offset-2"
          >
            Next page →
          </Link>
        </div>
      )}
    </div>
  );
}
