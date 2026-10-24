'use client';

import { MY_DRAFT_LABEL, MY_DRAFT_SLUG, type Sample } from '@/lib/samples';
import { cn } from '@/lib/utils';

interface SamplePickerProps {
  samples: Sample[];
  value: string;
  onChange(slug: string): void;
}

/** The sample drafts, then "My draft" for the author's own text. */
export function SamplePicker({ samples, value, onChange }: SamplePickerProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sample-picker" className="text-muted-foreground text-sm">
        Draft
      </label>
      <select
        id="sample-picker"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className={cn(
          'h-8 max-w-56 rounded-md border bg-background px-2 text-sm',
          'outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
        )}
      >
        <optgroup label="Samples">
          {samples.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.title}
            </option>
          ))}
        </optgroup>
        <option value={MY_DRAFT_SLUG}>{MY_DRAFT_LABEL} (your own text)</option>
      </select>
    </div>
  );
}
