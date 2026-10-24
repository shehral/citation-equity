'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import type { CitedSummary, DraftSummary, SiteSummary } from '@/lib/store';
import { cn } from '@/lib/utils';
import { FIRST_ISSUE_ID, START_HERE_ID, VIEW_HREF } from '@/lib/views';

/** Fewer answers than this is a small sample. */
export const FEW_ANSWERS = 3;

export interface NextAction {
  title: string;
  detail: string;
  href: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The one action under the tiles: the open Start here fixes, else the first failing
 * site row, else a few more AI answers. Null before anything is checked, and when none applies.
 */
export function nextUp(s: {
  draft: DraftSummary | null;
  site: SiteSummary | null;
  cited: CitedSummary | null;
}): NextAction | null {
  if (!s.draft && !s.site && !s.cited) return null;
  if (s.draft && s.draft.openStartHere > 0) {
    return {
      title: `Start with ${plural(s.draft.openStartHere, 'quick win')}`,
      detail: s.draft.example
        ? "The example's top fixes, one at a time."
        : "Your draft's top fixes, one at a time.",
      href: `${VIEW_HREF.draft}#${START_HERE_ID}`,
    };
  }
  if (s.site && s.site.fail > 0) {
    // The example's page is not the visitor's, so its line never says "your page".
    const where = s.site.example ? 'the example page' : 'your page';
    return {
      title: s.site.example ? 'See what blocks AI there' : 'Fix what blocks AI on your page',
      detail: `${s.site.fail} ${s.site.fail === 1 ? 'check fails' : 'checks fail'} on ${where}.`,
      href: `${VIEW_HREF.site}#${FIRST_ISSUE_ID}`,
    };
  }
  if (!s.cited || s.cited.answers < FEW_ANSWERS) {
    return {
      title: 'Paste a few more answers',
      detail: 'Answers change every time, so paste a few.',
      href: VIEW_HREF.cited,
    };
  }
  return null;
}

export function NextUp({ action }: { action: NextAction }) {
  return (
    <section
      aria-labelledby="next-up-label"
      className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg bg-brand-soft px-5 py-4"
    >
      <h2 id="next-up-label" className="font-semibold text-brand text-xs uppercase tracking-wider">
        Next up
      </h2>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-medium font-serif text-lg leading-snug">{action.title}</p>
        <p className="text-ink-soft text-sm">{action.detail}</p>
      </div>
      <Link href={action.href} className={cn(buttonVariants(), 'gap-1.5')}>
        Open
        <ArrowRight aria-hidden="true" />
      </Link>
    </section>
  );
}
