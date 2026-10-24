'use client';

import type { CheckDefinition, EvidenceGrade } from '@citation-equity/engine';
import { BookOpen } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export const GRADE_CLASS: Record<EvidenceGrade, string> = {
  strong: 'border-grade-strong/50 text-grade-strong',
  moderate: 'border-grade-moderate/50 text-grade-moderate',
  mixed: 'border-grade-mixed/50 text-grade-mixed',
  untested: 'border-grade-untested/50 text-grade-untested',
};

/** The check's evidence grade; opens a popover with the summary and every source. */
export function EvidenceBadge({ definition }: { definition: CheckDefinition }) {
  const { evidence } = definition;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Evidence for ${definition.title}: ${evidence.grade}. Show summary and sources`}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-xs',
            'outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
            GRADE_CLASS[evidence.grade],
          )}
        >
          <BookOpen className="size-3" aria-hidden="true" />
          Evidence: {evidence.grade}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] overflow-y-auto text-sm"
      >
        <p className="font-medium">
          {definition.title}: evidence {evidence.grade}
        </p>
        <p className="mt-1 text-muted-foreground">{evidence.summary}</p>
        <ul className="mt-3 space-y-2">
          {evidence.sources.map((source) => (
            <li key={source.id}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                {source.citation}
              </a>
              <p className="mt-0.5 text-muted-foreground text-xs">{source.claim}</p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
