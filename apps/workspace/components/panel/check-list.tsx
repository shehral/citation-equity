'use client';

import type {
  CheckId,
  CheckResult,
  QuestionCoverage,
  Range,
  Weights,
} from '@citation-equity/engine';
import { CircleAlert, CircleCheck, Locate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DEFINITIONS_BY_ID } from '@/lib/presets';
import { CIRCULARITY_NOTE } from '@/lib/questions';
import { cn } from '@/lib/utils';
import { EvidenceBadge } from './evidence-badge';
import { WeightSlider } from './weight-controls';

interface CheckListProps {
  checks: CheckResult[];
  weights: Weights;
  onWeightChange(id: CheckId, value: number): void;
  /** Each target question and where the draft answers it (or should). */
  questionCoverage?: QuestionCoverage[];
  /** Selects a range in the editor. */
  onShowRange?(range: Range): void;
}

/** Every check: title, score bar or "Not applicable", evidence badge and weight. */
export function CheckList({
  checks,
  weights,
  onWeightChange,
  questionCoverage = [],
  onShowRange,
}: CheckListProps) {
  return (
    <section aria-labelledby="checks-heading" className="rounded-lg border bg-card p-4">
      <h2 id="checks-heading" className="font-medium">
        Checks
      </h2>
      <ul className="mt-3 divide-y">
        {checks.map((check) => {
          const definition = DEFINITIONS_BY_ID[check.checkId];
          const percent = Math.round(check.score * 100);
          const titleId = `check-title-${check.checkId}`;
          return (
            <li key={check.checkId} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={titleId} className="font-medium text-sm">
                  {definition.title}
                </h3>
                <EvidenceBadge definition={definition} />
              </div>
              {check.applicable ? (
                <div className="flex items-center gap-3">
                  <div
                    aria-hidden="true"
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums">
                    <span className="sr-only">Score </span>
                    {percent}%
                  </span>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">Not applicable to this draft</p>
              )}
              {check.checkId === 'question-coverage' && (
                <CoverageDetail
                  titleId={titleId}
                  rows={questionCoverage}
                  onShowRange={onShowRange}
                />
              )}
              {check.checkId === 'comparisons' && <ComparisonsDetail check={check} />}
              <WeightSlider
                definition={definition}
                value={weights[check.checkId]}
                onChange={(v) => onWeightChange(check.checkId, v)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The question-coverage card: each target question, Covered or Not covered, and where. */
function CoverageDetail({
  titleId,
  rows,
  onShowRange,
}: {
  titleId: string;
  rows: QuestionCoverage[];
  onShowRange?(range: Range): void;
}) {
  return (
    <section aria-labelledby={titleId} className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Add target questions above to run this check.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: two rows may hold the same text while it is being edited
            <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 text-xs',
                  row.covered ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {row.covered ? (
                  <CircleCheck aria-hidden="true" className="size-3.5" />
                ) : (
                  <CircleAlert aria-hidden="true" className="size-3.5" />
                )}
                {row.covered ? 'Covered' : 'Not covered'}
              </span>
              <span className="min-w-0 flex-1">{row.question}</span>
              {onShowRange && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onShowRange(row.range)}
                >
                  <Locate aria-hidden="true" />
                  Show in draft<span className="sr-only">: {row.question}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">{CIRCULARITY_NOTE}</p>
    </section>
  );
}

/** The comparisons card: how many comparisons the draft makes, or when the check applies. */
function ComparisonsDetail({ check }: { check: CheckResult }) {
  const n = check.metrics.comparisons;
  if (!check.applicable)
    return <p className="text-muted-foreground text-xs">Applies to drafts of 300 words or more.</p>;
  if (n === undefined) return null;
  return (
    <p className="text-muted-foreground text-xs">
      {n === 0
        ? 'No explicit comparison found in a heading, sentence or table row.'
        : `${n} explicit comparison${n === 1 ? '' : 's'} found in headings, sentences and table rows.`}
    </p>
  );
}
