import type { AnalysisResult } from '@citation-equity/engine';
import Link from 'next/link';
import { EVIDENCE_STANCE, PRESET_LABELS } from '@/lib/presets';
import type { ActivePreset } from '@/lib/use-analysis';
import { cn } from '@/lib/utils';

interface ScoreCardProps {
  scores: AnalysisResult['scores'];
  wordCount: number;
  active: ActivePreset;
  pending: boolean;
}

/** The active preset's score, the other preset scores in small text, and what the score is not. */
export function ScoreCard({ scores, wordCount, active, pending }: ScoreCardProps) {
  const score = scores[active];
  const others = (['foundation', 'evidence'] as const).filter((p) => p !== active);
  const empty = wordCount === 0 ? 'No content yet' : 'No check applies to this draft yet';
  return (
    <section aria-labelledby="score-heading" className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="score-heading" className="font-medium text-muted-foreground text-sm">
          GEO Score, {PRESET_LABELS[active]}
        </h2>
        <span aria-live="polite" className="text-muted-foreground text-xs">
          {pending ? 'Updating' : ''}
        </span>
      </div>
      <p className={cn('mt-1 font-semibold tabular-nums', score === null ? 'text-xl' : 'text-5xl')}>
        {score === null ? empty : score}
        {score !== null && (
          <span className="ml-1 font-normal text-base text-muted-foreground">/ 100</span>
        )}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm">
        {others.map((p) => (
          <li key={p}>
            {PRESET_LABELS[p]}: <span className="tabular-nums">{scores[p] ?? 'none'}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-muted-foreground text-sm">
        {EVIDENCE_STANCE}{' '}
        <Link
          href="/evidence"
          prefetch={false}
          className="rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          Read the evidence
        </Link>
      </p>
    </section>
  );
}
