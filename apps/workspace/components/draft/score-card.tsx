'use client';

import { type AnalysisResult, UNSCORED_CHECKS } from '@citation-equity/engine';
import Link from 'next/link';
import { useId } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UNSCORED_NOTES } from '@/lib/glossary';
import type { ActivePreset } from '@/lib/use-analysis';
import { cn } from '@/lib/utils';
import { RESEARCH_HREF } from '@/lib/views';
import { ScoringPopover } from './scoring-popover';

interface ScoreCardProps {
  scores: AnalysisResult['scores'];
  mode: ActivePreset;
  hasCustom: boolean;
  /** The change since the slot was first checked ("+N since you started"); null for none. */
  since: number | null;
  /** True while the analysis trails the editor. */
  pending: boolean;
  onModeChange(mode: ActivePreset): void;
  onAdjustWeights(): void;
}

const R = 34;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** The score in a ring (0 to 100), filled in the score colour. */
function ScoreRing({ score }: { score: number }) {
  const filled = (Math.min(100, Math.max(0, score)) / 100) * CIRCUMFERENCE;
  return (
    <div
      role="img"
      aria-label={`AI-ready score: ${score} out of 100`}
      className="relative size-20 shrink-0"
    >
      <svg viewBox="0 0 80 80" aria-hidden="true" className="size-full -rotate-90">
        <circle cx="40" cy="40" r={R} fill="none" strokeWidth="7" className="stroke-score-track" />
        <circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          className="stroke-score motion-safe:transition-[stroke-dasharray] motion-safe:duration-500"
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center font-serif text-3xl tabular-nums lining-nums"
      >
        {score}
      </span>
    </div>
  );
}

/**
 * The AI-ready score: a ring, "+N since you started", the one caveat with its Why, and the
 * Scoring popover. Shown only for a draft with content; the rail says "No content yet" otherwise.
 */
export function ScoreCard({
  scores,
  mode,
  hasCustom,
  since,
  pending,
  onModeChange,
  onAdjustWeights,
}: ScoreCardProps) {
  const id = useId();
  const score = scores[mode];
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-lg border bg-surface p-4 shadow-card"
    >
      <div className="flex items-center gap-4">
        {score === null ? (
          <p className="font-serif text-lg">No check applies to this draft yet</p>
        ) : (
          <ScoreRing score={score} />
        )}
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="font-medium text-sm">
            AI-ready score
          </h2>
          {since !== null && since !== 0 && (
            <p
              className={cn(
                'mt-1 inline-block rounded-full px-2 py-0.5 text-xs tabular-nums',
                since > 0 ? 'bg-done-soft text-done' : 'bg-sunken text-ink-soft',
              )}
            >
              {`${since > 0 ? '+' : ''}${since} since you started`}
            </p>
          )}
          <p aria-live="polite" className="sr-only">
            {pending ? 'Updating' : ''}
          </p>
        </div>
        <ScoringPopover
          scores={scores}
          mode={mode}
          hasCustom={hasCustom}
          onModeChange={onModeChange}
          onAdjustWeights={onAdjustWeights}
        />
      </div>
      <p className="mt-3 text-ink-soft text-sm">
        A writing checklist, not a forecast.{' '}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="rounded-sm font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              Why?
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="space-y-2 rounded-lg text-sm leading-relaxed shadow-pop"
          >
            <p>
              No check is proven to raise AI citations yet. The score shows how clearly the post is
              written for quoting.
            </p>
            {UNSCORED_CHECKS.map((id) => (
              <p key={id}>{UNSCORED_NOTES[id]}</p>
            ))}
            <Link
              href={RESEARCH_HREF}
              prefetch={false}
              className="inline-block rounded-sm font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              See the research
            </Link>
          </PopoverContent>
        </Popover>
      </p>
    </section>
  );
}
