'use client';

import type { CheckDefinition } from '@citation-equity/engine';
import { PRESET_LABELS } from '@/lib/presets';
import type { ActivePreset } from '@/lib/use-analysis';
import { cn } from '@/lib/utils';

interface PresetToggleProps {
  value: ActivePreset;
  hasCustom: boolean;
  onChange(preset: ActivePreset): void;
}

/** Foundation design / Evidence-weighted, plus Custom once a weight has been moved. */
export function PresetToggle({ value, hasCustom, onChange }: PresetToggleProps) {
  const options: ActivePreset[] = hasCustom
    ? ['foundation', 'evidence', 'custom']
    : ['foundation', 'evidence'];
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="sr-only">Weight preset</legend>
      <span aria-hidden="true" className="hidden text-muted-foreground text-sm sm:inline">
        Weights
      </span>
      <div className="inline-flex rounded-md border p-0.5">
        {options.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={value === preset}
            onClick={() => onChange(preset)}
            className={cn(
              'rounded-sm px-2.5 py-1 text-sm outline-none transition-colors',
              'focus-visible:ring-[3px] focus-visible:ring-ring',
              value === preset
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {PRESET_LABELS[preset]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

interface WeightSliderProps {
  definition: CheckDefinition;
  value: number;
  onChange(value: number): void;
}

/** Weight of one check, 0 to 2 in steps of 0.05 (so the evidence preset's 0.15 fits). Moving it switches the preset to Custom. */
export function WeightSlider({ definition, value, onChange }: WeightSliderProps) {
  const id = `weight-${definition.id}`;
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-14 shrink-0 text-muted-foreground text-xs">
        Weight
        <span className="sr-only"> for {definition.title}</span>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="h-1.5 w-full cursor-pointer accent-primary rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      />
      <output htmlFor={id} className="w-10 shrink-0 text-right text-xs tabular-nums">
        {value.toFixed(2)}
      </output>
    </div>
  );
}
