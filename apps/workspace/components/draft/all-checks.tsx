'use client';

import { type CheckId, type CheckResult, EVIDENCE, type Weights } from '@citation-equity/engine';
import { CHECK_NAMES, GRADE_WORDS } from '@/lib/glossary';

interface AllChecksProps {
  checks: CheckResult[];
  weights: Weights;
  showWeights: boolean;
  onShowWeights(show: boolean): void;
  onWeightChange(id: CheckId, value: number): void;
}

/** "All 10 checks": each check's bar and percent, its grade, and the weights behind Adjust weights. */
export function AllChecks({
  checks,
  weights,
  showWeights,
  onShowWeights,
  onWeightChange,
}: AllChecksProps) {
  return (
    <>
      <ul className="space-y-2.5">
        {checks.map((check) => {
          const percent = Math.round(check.score * 100);
          return (
            <li key={check.checkId} className="space-y-1.5">
              <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_2.5rem] items-center gap-2.5">
                <span className="min-w-0">
                  {CHECK_NAMES[check.checkId]}
                  <span className="block text-ink-soft text-xs">
                    {GRADE_WORDS[EVIDENCE[check.checkId].grade]}
                    {detail(check)}
                  </span>
                </span>
                {check.applicable ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="h-1.5 overflow-hidden rounded-full bg-score-track"
                    >
                      <span
                        className="block h-full rounded-full bg-score"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                    <span className="text-right text-ink-soft text-xs tabular-nums">
                      {percent}%
                    </span>
                  </>
                ) : (
                  <span className="col-span-2 text-right text-ink-soft text-xs">
                    Not applicable
                  </span>
                )}
              </div>
              {showWeights && (
                <WeightSlider
                  id={check.checkId}
                  value={weights[check.checkId]}
                  onChange={(v) => onWeightChange(check.checkId, v)}
                />
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        aria-expanded={showWeights}
        onClick={() => onShowWeights(!showWeights)}
        className="rounded-sm font-medium text-brand text-sm underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        Adjust weights
      </button>
    </>
  );
}

/** One short line for the checks whose numbers help. */
function detail(check: CheckResult): string {
  if (check.checkId !== 'comparisons' || !check.applicable) return '';
  const n = check.metrics.comparisons;
  if (n === undefined) return '';
  return ` · ${n === 0 ? 'No comparisons found' : `${n} comparison${n === 1 ? '' : 's'} found`}`;
}

/**
 * The weight of one check, 0 to 2 in steps of 0.05 (so the evidence weights' 0.15 fits).
 * Moving it switches the scoring to Custom.
 */
export function WeightSlider({
  id,
  value,
  onChange,
}: {
  id: CheckId;
  value: number;
  onChange(value: number): void;
}) {
  const inputId = `weight-${id}`;
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={inputId} className="w-14 shrink-0 text-ink-soft text-xs">
        Weight
        <span className="sr-only"> for {CHECK_NAMES[id]}</span>
      </label>
      <input
        id={inputId}
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="h-1.5 w-full cursor-pointer rounded-full accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      />
      <output htmlFor={inputId} className="w-10 shrink-0 text-right text-xs tabular-nums">
        {value.toFixed(2)}
      </output>
    </div>
  );
}
