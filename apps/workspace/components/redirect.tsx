'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { textLink } from '@/components/page-shell';

interface RedirectProps {
  /** The new route, base-path free ("/cited/"); the router and next/link add the base path. */
  to: string;
  /** The link text of the fallback, the new page's name. */
  label: string;
}

/**
 * Sends an old URL to its new route with router.replace, so Back skips the old page. The old
 * page's anchor carries over unless the target has its own. Until the script runs (or without
 * JavaScript) the page shows a plain link to the new route.
 */
export function Redirect({ to, label }: RedirectProps) {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    router.replace(to.includes('#') || !hash ? to : `${to}${hash}`);
  }, [router, to]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
      <p className="text-base text-muted-foreground">
        This page moved.{' '}
        <Link href={to} prefetch={false} className={textLink}>
          {label}
        </Link>
      </p>
    </main>
  );
}
