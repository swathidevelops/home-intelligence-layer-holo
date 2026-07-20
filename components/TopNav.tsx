'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Today' },
  { href: '/leadership', label: 'Leadership' },
  { href: '/rules', label: 'Rules' },
];

export default function TopNav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1180px] items-center gap-6 px-6 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">
            HOME Intelligence Layer
          </span>
          <span className="hidden text-xs text-slate-400 sm:inline">
            prototype · synthetic data
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
