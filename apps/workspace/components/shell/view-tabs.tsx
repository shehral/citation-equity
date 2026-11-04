'use client';

import {
  FileCode,
  type LucideIcon,
  MessageCircleQuestionMark,
  MessagesSquare,
  PenLine,
} from 'lucide-react';
import Link from 'next/link';
import type { ViewId } from '@/lib/store';
import { cn } from '@/lib/utils';
import { VIEW_HREF } from '@/lib/views';

/** The views, named by what they hold, in the order of the flow: the home is Your questions. */
export const VIEW_TABS: { view: ViewId; label: string; icon: LucideIcon }[] = [
  { view: 'home', label: 'Your questions', icon: MessageCircleQuestionMark },
  { view: 'draft', label: 'Your draft', icon: PenLine },
  { view: 'site', label: 'Your site', icon: FileCode },
  { view: 'cited', label: 'Results', icon: MessagesSquare },
];

/** The header's view tabs. Below 640px each tab shows its icon; the label stays for screen readers. */
export function ViewTabs({ current }: { current: ViewId | null }) {
  return (
    <nav aria-label="Views" className="min-w-0">
      <ul className="flex items-center gap-0.5 sm:gap-1">
        {VIEW_TABS.map(({ view, label, icon: Icon }) => {
          const active = view === current;
          return (
            <li key={view}>
              <Link
                href={VIEW_HREF[view]}
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md px-2.5 font-medium text-ink-soft text-sm',
                  'outline-none transition-colors hover:bg-sunken hover:text-foreground',
                  'focus-visible:ring-[3px] focus-visible:ring-ring motion-safe:duration-150',
                  active && 'bg-brand-soft text-brand hover:bg-brand-soft hover:text-brand',
                )}
              >
                <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
                <span className="max-sm:sr-only">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
