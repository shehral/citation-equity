import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

const navLink =
  'rounded-sm text-muted-foreground text-sm hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

/** Header and reading column for the text pages (/evidence, /site, /off-page, /about). */
export function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b px-4 py-3">
        <Link
          href="/"
          prefetch={false}
          className="rounded-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          Citation Equity
        </Link>
        <nav
          aria-label="Pages"
          className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-4"
        >
          <Link href="/" prefetch={false} className={navLink}>
            Workspace
          </Link>
          <Link href="/evidence" prefetch={false} className={navLink}>
            Evidence
          </Link>
          <Link href="/site" prefetch={false} className={navLink}>
            Site readiness
          </Link>
          <Link href="/off-page" prefetch={false} className={navLink}>
            Off-page
          </Link>
          <Link href="/about" prefetch={false} className={navLink}>
            About
          </Link>
          <ThemeToggle />
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="font-semibold text-3xl">{title}</h1>
        {children}
      </main>
    </div>
  );
}

export const textLink =
  'rounded-sm underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring';
