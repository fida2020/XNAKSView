export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-7 w-40 rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-72 rounded bg-black/10 dark:bg-white/10" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-lg border border-black/10 dark:border-white/10" />
        ))}
      </div>
    </div>
  );
}
