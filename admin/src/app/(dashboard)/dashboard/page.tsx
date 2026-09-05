import { env } from '@/config/env';

interface HealthSummary {
  status: 'ok' | 'degraded';
  dependencies: {
    database: { ok: boolean };
    cache: { ok: boolean };
  };
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

export default async function DashboardPage() {
  const health = await getBackendHealth();

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        Placeholder overview — real analytics and metrics arrive in Phase 10.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
