'use client';

import type { AnalysisResult } from '@citation-equity/engine';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ActivePreset } from '@/lib/use-analysis';
import { cn } from '@/lib/utils';

/** The scoring modes as the draft view names them. */
export const SCORING_LABELS: Record<ActivePreset, string> = {
  foundation: 'Standard',
  evidence: 'By evidence',
  custom: 'Custom',
};

interface ScoringPopoverProps {
  scores: AnalysisResult['scores'];
  mode: ActivePreset;
  /** True once a weight has been moved, so Custom is a choice. */
  hasCustom: boolean;
  onModeChange(mode: ActivePreset): void;
  onAdjustWeights(): void;
}

/** "Scoring" on the score card: Standard / By evidence (and Custom), and Adjust weights. */
export function ScoringPopover({
  scores,
  mode,
  hasCustom,
  onModeChange,
  onAdjustWeights,
}: ScoringPopoverProps) {
  const [open, setOpen] = useState(false);
  const modes: ActivePreset[] = hasCustom
    ? ['foundation', 'evidence', 'custom']
    : ['foundation', 'evidence'];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Scoring" title="Scoring">
          <SlidersHorizontal aria-hidden="true" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg shadow-pop"
      >
        <p className="font-medium text-sm">Scoring</p>
        <div className="flex flex-wrap gap-1 rounded-lg bg-sunken p-1">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onModeChange(m)}
              className={cn(
                'flex-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm tabular-nums outline-none',
                'focus-visible:ring-[3px] focus-visible:ring-ring',
                mode === m
                  ? 'bg-surface text-foreground shadow-card'
                  : 'text-ink-soft hover:text-foreground',
              )}
            >
              {`${SCORING_LABELS[m]} · ${scores[m] ?? 'none'}`}
            </button>
          ))}
        </div>
        <p className="text-ink-soft text-xs">By evidence gives better-tested checks more weight.</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setOpen(false);
            onAdjustWeights();
          }}
        >
          Adjust weights
        </Button>
      </PopoverContent>
    </Popover>
  );
}
