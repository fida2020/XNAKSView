import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, apiClient } from '@/lib/api-client';
import { getSessionAccessToken } from '@/lib/session';

interface AdminVideoDetail {
  id: string;
  caption: string | null;
  status: 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';
  visibility: 'PUBLIC' | 'PRIVATE';
  processingError?: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  shareCount: number;
  createdAt: string;
  owner: { id: string; email: string | null; phone: string | null };
  reports: Array<{
    id: string;
    reason: string;
    description: string | null;
    status: string;
    createdAt: string;
  }>;
}

async function getVideo(id: string): Promise<AdminVideoDetail | null> {
  const accessToken = await getSessionAccessToken();
  try {
    return await apiClient.get<AdminVideoDetail>(`/admin/videos/${id}`, { accessToken });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await getVideo(id);
  if (!video) notFound();

  return (
    <div>
      <Link href="/videos" className="text-sm underline underline-offset-2">
        ← Back to videos
      </Link>

      <h1 className="mt-2 text-2xl font-semibold">{video.caption || '(no caption)'}</h1>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          {video.status === 'READY' ? (
            <video controls className="w-full rounded-lg bg-black" src={`/api/media/videos/${video.id}/file`} />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg bg-black/5 dark:bg-white/10">
              <p className="text-sm text-black/60 dark:text-white/60">
                {video.status === 'PROCESSING' ? 'Still processing…' : `Not playable (${video.status})`}
              </p>
            </div>
          )}
          {video.processingError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">Error: {video.processingError}</p>
          )}
        </div>

        <dl className="space-y-2 text-sm">
          <Row label="Video ID" value={video.id} />
          <Row label="Owner" value={video.owner.email ?? video.owner.phone ?? video.owner.id} />
          <Row label="Status" value={video.status} />
          <Row label="Visibility" value={video.visibility} />
          <Row label="Duration" value={video.durationMs ? `${(video.durationMs / 1000).toFixed(1)}s` : '—'} />
          <Row label="Dimensions" value={video.width && video.height ? `${video.width}×${video.height}` : '—'} />
          <Row label="Likes" value={String(video.likeCount)} />
          <Row label="Comments" value={String(video.commentCount)} />
          <Row label="Views" value={String(video.viewCount)} />
          <Row label="Shares" value={String(video.shareCount)} />
          <Row label="Created" value={new Date(video.createdAt).toLocaleString()} />
        </dl>
      </div>

      <h2 className="mt-10 text-lg font-semibold">Reports ({video.reports.length})</h2>
      {video.reports.length === 0 ? (
        <p className="mt-2 text-sm text-black/50 dark:text-white/50">No reports for this video.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {video.reports.map((report) => (
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
