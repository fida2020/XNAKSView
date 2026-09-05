import { cookies } from 'next/headers';

import { apiClient } from '@/lib/api-client';
import { authConfig } from '@/lib/auth';
import { env } from '@/config/env';
import { LogoutButton } from '@/components/logout-button';

interface HealthSummary {
  status: 'ok' | 'degraded';
  dependencies: {
    database: { ok: boolean };
    cache: { ok: boolean };
  };
}

interface MeResponse {
  id: string;
  email: string | null;
  phone: string | null;
  status: string;
}

async function getBackendHealth(): Promise<HealthSummary | null> {
  try {
    const res = await fetch(`${env.apiBaseUrl}/health`, { cache: 'no-store' });
    if (!res.ok && res.status !== 503) return null;
    return (await res.json()) as HealthSummary;
  } catch {
    return null;
  }
}

// Middleware (`proxy.ts`) already verified this session against the backend
// before this page was allowed to render, so `accessToken` here is expected
// to be valid — if the call below still fails (e.g. revoked in the instant
// between middleware and render), that's a genuine, rare error and is
// allowed to surface to the route's `error.tsx` boundary rather than being
// papered over.
async function getAuthenticatedAdmin(): Promise<MeResponse> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(authConfig.sessionCookieName)?.value;
  return apiClient.get<MeResponse>('/me', { accessToken });
}

export default async function DashboardPage() {
  const [health, admin] = await Promise.all([getBackendHealth(), getAuthenticatedAdmin()]);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Signed in as {admin.email ?? admin.phone} · {admin.status}
          </p>
        </div>
        <LogoutButton />
      </div>

      <p className="mt-6 text-sm text-black/60 dark:text-white/60">
        Placeholder overview — real analytics and metrics arrive in a later step.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Backend API" value={health ? 'Reachable' : 'Unreachable'} />
        <StatCard label="Database" value={health?.dependencies.database.ok ? 'Healthy' : 'Unknown / Down'} />
        <StatCard label="Cache" value={health?.dependencies.cache.ok ? 'Healthy' : 'Unknown / Down'} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <p className="text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}
