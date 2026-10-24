import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleX,
  type LucideIcon,
  TriangleAlert,
} from 'lucide-react';
import { useId } from 'react';
import { GradeLabel } from '@/components/grade-label';
import { cn } from '@/lib/utils';
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

/** Source titles without the "Read <date>." stamp, which stays in docs. */
const title = (citation: string) => citation.replace(/\s*Read \d{4}-\d{2}-\d{2}\.\s*$/, '');

/** One compact result row: status, name and finding; Why it matters on tap. */
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
            <GradeLabel grade={row.evidence.grade} />
          </p>
          <ul className="space-y-1">
            {row.evidence.sources.map((s) => (
              <li key={s.id}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-words rounded-sm text-ink-soft underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  {title(s.citation)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </li>
  );
}
