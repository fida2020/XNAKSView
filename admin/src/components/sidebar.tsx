import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/videos', label: 'Videos' },
  { href: '/reports', label: 'Reports' },
  { href: '/live', label: 'LIVE' },
  { href: '/live-reports', label: 'LIVE Reports' },
  // Future sections mount here as their domains ship:
  // { href: '/users', label: 'Users' },
  // { href: '/verification', label: 'Verification' },
] as const;

export function Sidebar() {
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-black/10 bg-black/[.02] dark:border-white/10 dark:bg-white/[.02]">
      <div className="px-5 py-5">
        <span className="text-lg font-semibold tracking-tight">XNAKView</span>
        <p className="text-xs text-black/50 dark:text-white/50">Admin</p>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-md px-3 py-2 text-sm font-medium text-black/80 hover:bg-black/5 dark:text-white/80 dark:hover:bg-white/10"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="px-5 py-4 text-xs text-black/40 dark:text-white/40">
        BALOCH SAHAB TECHNOLOGIES
      </div>
    </aside>
  );
}
