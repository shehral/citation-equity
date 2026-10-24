'use client';

import { Lock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** The one privacy statement of the working screens; the chip is its only home. */
export const PRIVACY_NOTE =
  'Everything you paste stays in this browser. The only connection is to AI on your own computer, after you connect it.';

/** "Stays in your browser": a header chip whose popover holds the privacy note. */
export function PrivacyChip() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border bg-surface px-2.5 text-ink-soft text-xs',
            'outline-none transition-colors hover:border-border-strong hover:text-foreground',
            'focus-visible:ring-[3px] focus-visible:ring-ring motion-safe:duration-150',
          )}
        >
          <Lock aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          <span className="max-sm:sr-only">Stays in your browser</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-lg text-sm leading-relaxed shadow-pop">
        <p>{PRIVACY_NOTE}</p>
      </PopoverContent>
    </Popover>
  );
}
