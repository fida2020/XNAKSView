'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <h2 className="text-lg font-semibold">Couldn&apos;t load the dashboard</h2>
      <p className="text-sm text-black/60 dark:text-white/60">{error.message}</p>
      <button
        onClick={reset}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
      >
        Try again
      </button>
    </div>
  );
}
