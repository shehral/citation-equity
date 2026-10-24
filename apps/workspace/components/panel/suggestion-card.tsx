'use client';

import type { CheckDefinition, Suggestion } from '@citation-equity/engine';
import { Check, CircleCheck, GitCompare, Locate, Sparkles, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { offersWordingHelper } from '@/lib/wording-helper';
import { EvidenceBadge } from './evidence-badge';

export const STALE_MESSAGE = 'Out of date. The text changed since this was suggested.';

export interface SuggestionActions {
  onShow(s: Suggestion): void;
  onPreview(s: Suggestion): void;
  onApply(s: Suggestion): void;
  onMarkDone(s: Suggestion): void;
  onIgnore(s: Suggestion): void;
  /** Asks the local model for wording (advisories only); omitted, the card offers no helper. */
  onSuggestWording?(s: Suggestion): void;
}

/** The wording helper's state for one card: asking, or a message to show (an error). */
export type WordingState = { status: 'asking' } | { status: 'error'; message: ReactNode };

interface SuggestionCardProps extends SuggestionActions {
  suggestion: Suggestion;
  definition: CheckDefinition;
  stale?: boolean;
  active?: boolean;
  wording?: WordingState;
  /** What the check found at this text (too short, opens with "This", ...), when the rationale does not say it. */
  finding?: string;
}

/**
 * One suggestion. An `edit` offers Preview change and Apply; an `advisory`
 * offers Mark done and, when given `onSuggestWording`, a local wording helper
 * whose proposal opens side by side. Both offer Show in draft and Ignore.
 * Nothing changes the draft except an Apply click.
 */
export function SuggestionCard({
  suggestion: s,
  definition,
  stale = false,
  active = false,
  wording,
  finding,
  ...actions
}: SuggestionCardProps) {
  const titleId = `suggestion-${s.id}-title`;
  const { onSuggestWording } = actions;
  // Not for statistics, quotes or sources: a model would invent the figure, speaker or source.
  const canSuggest = onSuggestWording !== undefined && offersWordingHelper(s);
  const asking = wording?.status === 'asking';
  return (
    <article
      aria-labelledby={titleId}
      className={cn('rounded-lg border bg-card p-3', active && 'border-ring ring-1 ring-ring')}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="font-medium text-sm">
          {s.title}
        </h3>
        <EvidenceBadge definition={definition} />
      </div>
      <p className="mt-1 text-muted-foreground text-xs">{definition.title}</p>
      <p className="mt-2 text-sm">
        {finding && <span className="font-medium">{finding} </span>}
        {s.rationale}
      </p>
      <blockquote className="mt-2 line-clamp-4 whitespace-pre-wrap border-l-2 pl-3 font-mono text-muted-foreground text-xs">
        {s.before}
      </blockquote>
      {stale && (
        <p
          role="status"
          className="mt-2 rounded-md bg-warning px-2 py-1 text-sm text-warning-foreground"
        >
          {STALE_MESSAGE}
        </p>
      )}
      {wording?.status === 'error' && (
        <div role="status" className="mt-2 space-y-2 rounded-md border p-2 text-sm">
          {wording.message}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => actions.onShow(s)}>
          <Locate aria-hidden="true" />
          Show in draft
        </Button>
        {s.kind === 'edit' ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => actions.onPreview(s)}>
              <GitCompare aria-hidden="true" />
              Preview change
            </Button>
            <Button type="button" size="sm" onClick={() => actions.onApply(s)}>
              <Check aria-hidden="true" />
              Apply
            </Button>
          </>
        ) : (
          <>
            <Button type="button" size="sm" onClick={() => actions.onMarkDone(s)}>
              <CircleCheck aria-hidden="true" />
              Mark done
            </Button>
            {canSuggest && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={asking}
                onClick={() => onSuggestWording(s)}
              >
                <Sparkles aria-hidden="true" />
                {asking ? 'Asking the local model' : 'Suggest wording (local model)'}
              </Button>
            )}
          </>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={() => actions.onIgnore(s)}>
          <X aria-hidden="true" />
          Ignore
        </Button>
      </div>
    </article>
  );
}
