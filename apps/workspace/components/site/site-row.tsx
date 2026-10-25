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

const STATUS: Record<RowStatus, { label: string; icon: LucideIcon; className: string }> = {
  pass: { label: 'Pass', icon: CircleCheck, className: 'bg-done-soft text-done' },
  warn: { label: 'Warning', icon: TriangleAlert, className: 'bg-stale-soft text-stale' },
  fail: { label: 'Fix', icon: CircleX, className: 'border border-destructive/40 text-destructive' },
  live: {
    label: 'Not checked',
    icon: CircleDashed,
    className: 'border border-border text-muted-foreground',
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

export function StatusChip({ status }: { status: RowStatus }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <span
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
export function SiteRowItem({ row, id }: { row: SiteRow; id?: string }) {
  const nameId = useId();
  return (
    <li id={id} aria-labelledby={nameId} className="scroll-mt-24 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span id={nameId} className="mr-auto font-medium">
          {row.name}
        </span>
        <StatusChip status={row.status} />
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
