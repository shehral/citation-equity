'use client';

import { OctagonAlert } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { FIRST_ISSUE_ID, VIEW_HREF } from '@/lib/views';

/** Why each blocker keeps the page away from AI search, in one sentence (no closing stop). */
const REASON: Record<string, string> = {
  'crawler-access': 'Its robots.txt blocks a crawler AI search needs',
  'indexing-directives': 'A tag keeps it out of search results',
  'renders-without-js': 'Its text appears only after JavaScript runs',
};

/** For a blocker with no reason of its own here, so the sentence never starts bare. */
const ANY_REASON = 'It can keep the page out of AI answers';

/**
 * The home's banner while the stored site check lists a blocker: how many, on whose page, the
 * first one's reason ("and 1 more" after it, in the same sentence), and a link to the first one
 * on Your site. Nothing without a blocker.
 */
export function BlockerBanner({ blockers, example }: { blockers: string[]; example: boolean }) {
  const n = blockers.length;
  if (n === 0) return null;
  // The example's page is not the visitor's, so it is never "your page".
  const where = example ? 'the example page' : 'your page';
  const reason = REASON[blockers[0] ?? ''] ?? ANY_REASON;
  return (
    <section
      aria-label="Blocker"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive bg-surface px-4 py-3 text-foreground"
    >
      <OctagonAlert
        aria-hidden="true"
        className="size-5 shrink-0 text-destructive"
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-semibold">
          {n === 1 ? `A blocker on ${where}` : `${n} blockers on ${where}`}
        </p>
        <p className="text-sm">{n > 1 ? `${reason}, and ${n - 1} more.` : `${reason}.`}</p>
      </div>
      <Link
        href={`${VIEW_HREF.site}#${FIRST_ISSUE_ID}`}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        See blockers
      </Link>
    </section>
  );
}
