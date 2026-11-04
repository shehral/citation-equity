import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleX,
  type LucideIcon,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useId } from 'react';
import { cn } from '@/lib/utils';
import { RESEARCH_HREF } from '@/lib/views';
import type { RowStatus, SiteRow } from './site-check';

/** Which group a row is shown in: a blocker item, or one of the other page notes. */
export type RowKind = 'blocker' | 'note';

type Pill = { label: string; icon: LucideIcon; className: string };

const DESTRUCTIVE = 'border border-destructive/40 text-destructive';
const STALE = 'bg-stale-soft text-stale';
const DONE = 'bg-done-soft text-done';
const MUTED = 'border border-border text-muted-foreground';

/**
 * Each status's pill, by group. A blocker item says whether it keeps the page out of AI answers;
 * a page note keeps the plain verdict.
 */
const PILLS: Record<RowKind, Record<RowStatus, Pill>> = {
  blocker: {
    fail: { label: 'Blocker', icon: CircleX, className: DESTRUCTIVE },
    warn: { label: 'Check', icon: TriangleAlert, className: STALE },
    pass: { label: 'Clear', icon: CircleCheck, className: DONE },
    live: { label: 'Needs live site', icon: CircleDashed, className: MUTED },
  },
  note: {
    pass: { label: 'Pass', icon: CircleCheck, className: DONE },
    warn: { label: 'Warning', icon: TriangleAlert, className: STALE },
    fail: { label: 'Fix', icon: CircleX, className: DESTRUCTIVE },
    live: { label: 'Not checked', icon: CircleDashed, className: MUTED },
  },
};

/** Shared by the row and live-site disclosures: a summary with a chevron and a focus ring. */
export const disclosureSummary =
  'flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring [&::-webkit-details-marker]:hidden';

export function Chevron() {
  return (
    <ChevronDown
      className="size-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
      aria-hidden="true"
    />
  );
}

/** A row's status pill; `data-pill` (the status) marks it, so a check can read the pill alone. */
export function StatusChip({ status, kind }: { status: RowStatus; kind: RowKind }) {
  const { label, icon: Icon, className } = PILLS[kind][status];
  return (
    <span
      data-pill={status}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

/** One compact result row: status, name and finding; Why it matters on tap, with Learn more. */
export function SiteRowItem({ row, kind, id }: { row: SiteRow; kind: RowKind; id?: string }) {
  const nameId = useId();
  return (
    <li id={id} aria-labelledby={nameId} className="scroll-mt-24 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span id={nameId} className="mr-auto font-medium">
          {row.name}
        </span>
        <StatusChip status={row.status} kind={kind} />
      </div>
      <p className="mt-1 break-words text-ink-soft text-sm">{row.result}</p>
      <details className="group mt-1 text-sm">
        <summary className={cn(disclosureSummary, 'text-brand hover:text-brand-hover')}>
          Why it matters
          <Chevron />
        </summary>
        <div className="mt-2 space-y-2 border-border border-l-2 pl-3">
          {row.detail && <p className="break-words text-ink-soft">{row.detail}</p>}
          <p>
            {row.what} {row.why}
          </p>
          <p>
            <Link
              href={`${RESEARCH_HREF}#site-${row.id}`}
              prefetch={false}
              className="rounded-sm font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              Learn more
              <span className="sr-only">: {row.name}</span>
            </Link>
          </p>
        </div>
      </details>
    </li>
  );
}
