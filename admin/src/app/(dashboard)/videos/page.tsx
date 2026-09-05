import Link from 'next/link';

import { apiClient } from '@/lib/api-client';
import { getSessionAccessToken } from '@/lib/session';

interface AdminVideo {
  id: string;
  caption: string | null;
  status: 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';
  visibility: 'PUBLIC' | 'PRIVATE';
  likeCount: number;
  commentCount: number;
  viewCount: number;
  createdAt: string;
  owner: { id: string; email: string | null; phone: string | null };
}

interface AdminVideoListResponse {
  videos: AdminVideo[];
  nextCursor: string | null;
}

async function getVideos(cursor?: string, status?: string): Promise<AdminVideoListResponse> {
  const accessToken = await getSessionAccessToken();
  const params = new URLSearchParams({ limit: '20' });
  if (cursor) params.set('cursor', cursor);
  if (status) params.set('status', status);
  return apiClient.get<AdminVideoListResponse>(`/admin/videos?${params.toString()}`, { accessToken });
}

const STATUS_FILTERS = ['PROCESSING', 'READY', 'FAILED', 'DELETED'] as const;

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string }>;
}) {
  const { cursor, status } = await searchParams;
  const { videos, nextCursor } = await getVideos(cursor, status);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Videos</h1>

      <div className="mt-4 flex gap-2 text-sm">
        <Link
          href="/videos"
          className={`rounded-full px-3 py-1 ${!status ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/15 dark:border-white/15'}`}
        >
          All
        </Link>
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={`/videos?status=${s}`}
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
              <th className="py-2 pr-4">Caption</th>
              <th className="py-2 pr-4">Owner</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Visibility</th>
              <th className="py-2 pr-4">Likes</th>
              <th className="py-2 pr-4">Comments</th>
              <th className="py-2 pr-4">Views</th>
              <th className="py-2 pr-4">Created</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => (
              <tr key={video.id} className="border-b border-black/5 dark:border-white/5">
                <td className="py-2 pr-4">
                  {video.status === 'READY' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media/videos/${video.id}/thumbnail`}
                      alt=""
                      className="h-14 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-10 items-center justify-center rounded bg-black/5 text-[10px] dark:bg-white/10">
                      {video.status}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-4 max-w-xs truncate">
                  <Link href={`/videos/${video.id}`} className="underline underline-offset-2">
                    {video.caption || '(no caption)'}
                  </Link>
                </td>
                <td className="py-2 pr-4">{video.owner.email ?? video.owner.phone}</td>
                <td className="py-2 pr-4">{video.status}</td>
                <td className="py-2 pr-4">{video.visibility}</td>
                <td className="py-2 pr-4">{video.likeCount}</td>
                <td className="py-2 pr-4">{video.commentCount}</td>
                <td className="py-2 pr-4">{video.viewCount}</td>
                <td className="py-2 pr-4">{new Date(video.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {videos.length === 0 && <p className="py-8 text-center text-black/50 dark:text-white/50">No videos found.</p>}
      </div>

      {nextCursor && (
        <div className="mt-4">
          <Link
            href={`/videos?${new URLSearchParams({ ...(status ? { status } : {}), cursor: nextCursor }).toString()}`}
            className="text-sm underline underline-offset-2"
          >
            Next page →
          </Link>
        </div>
      )}
    </div>
  );
}
