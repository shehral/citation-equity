'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { hasLeftHome, subscribe, type ViewId } from '@/lib/store';
import { cn } from '@/lib/utils';
import { VIEW_HREF } from '@/lib/views';
import { MoreMenu } from './more-menu';
import { PrivacyChip } from './privacy-chip';
import { ViewTabs } from './view-tabs';

interface HeaderProps {
  /** The view on screen, or null on pages that are not views (Research, 404). */
  view: ViewId | null;
  onAbout(): void;
}

/**
 * The slim one-row header: wordmark, view tabs, privacy chip, theme toggle and More.
 * The tabs stay hidden on the home until the user has opened a view once; the
 * server render and first paint assume a first visit, then the store decides.
 */
export function Header({ view, onAbout }: HeaderProps) {
  const leftHome = useSyncExternalStore(subscribe, hasLeftHome, () => false);
  const showTabs = view !== 'home' || leftHome;

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Wordmark compact={showTabs} />
        {showTabs && <ViewTabs current={view} />}
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <PrivacyChip />
          <ThemeToggle />
          <MoreMenu onAbout={onAbout} />
        </div>
      </div>
    </header>
  );
}

/**
 * "Citation Equity" in Newsreader with a low quotation mark in brand indigo. `compact` hides the name below 640px so the tabs fit on one row.
 */
function Wordmark({ compact }: { compact: boolean }) {
  return (
    <Link
      href={VIEW_HREF.home}
      prefetch={false}
      aria-label="Citation Equity home"
      className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-lg bg-brand pt-2.5 font-semibold font-serif text-2xl text-brand-foreground leading-none"
      >
        &ldquo;
      </span>
      <span
        className={cn(
          'font-semibold font-serif text-lg tracking-tight',
          compact && 'max-sm:hidden',
        )}
      >
        Citation Equity
      </span>
    </Link>
  );
}
