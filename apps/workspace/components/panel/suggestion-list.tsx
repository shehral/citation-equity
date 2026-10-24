'use client';

import type { Suggestion } from '@citation-equity/engine';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DEFINITIONS_BY_ID } from '@/lib/presets';
import type { SuggestionStatus } from '@/lib/storage';
import {
  STALE_MESSAGE,
  type SuggestionActions,
  SuggestionCard,
  type WordingState,
} from './suggestion-card';

export interface HandledSuggestion {
  suggestion: Suggestion;
  status: Exclude<SuggestionStatus, 'pending'>;
  /** Undo of an applied edit failed because its text was edited since. */
  undoStale: boolean;
}

interface SuggestionListProps extends SuggestionActions {
  pending: Suggestion[];
  handled: HandledSuggestion[];
  /** Suggestions whose Apply found the text changed, by id. */
  stale: Record<string, Suggestion>;
  activeId: string | null;
  /** The local wording helper's state per suggestion id. */
  wording?: Record<string, WordingState>;
  /** What each suggestion's check found at its text, by id, where the rationale does not say it. */
  findings?: Record<string, string>;
  onUndo(item: HandledSuggestion): void;
  onDismissStale(id: string): void;
}

/** A short quote of the text a handled row is about, so two rows with one title differ. */
function excerpt(item: HandledSuggestion): string {
  const { before, after } = item.suggestion;
  const text = (item.status === 'applied' && after !== undefined ? after : before)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text;
}

const STATUS_LABEL: Record<HandledSuggestion['status'], string> = {
  applied: 'Applied',
  done: 'Done',
  ignored: 'Ignored',
};

/**
 * Pending suggestions first, in draft order. Handled ones (applied, done,
 * ignored) sit in a collapsed section, each with Undo. There are no bulk
 * actions: every change is one click on one suggestion.
 */
export function SuggestionList({
  pending,
  handled,
  stale,
  activeId,
  wording = {},
  findings = {},
  onUndo,
  onDismissStale,
  ...actions
}: SuggestionListProps) {
  const liveIds = new Set(pending.map((s) => s.id));
  const outdated = Object.values(stale).filter((s) => !liveIds.has(s.id));
  return (
    <section aria-labelledby="suggestions-heading" className="space-y-3">
      <h2 id="suggestions-heading" className="font-medium">
        Suggestions <span className="text-muted-foreground">({pending.length})</span>
      </h2>
      {outdated.map((s) => (
        <div
          key={`outdated-${s.id}`}
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning p-3 text-sm text-warning-foreground"
        >
          <p>
            <span className="font-medium">{s.title}.</span> {STALE_MESSAGE}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => onDismissStale(s.id)}>
            Dismiss
          </Button>
        </div>
      ))}
      {pending.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
          No open suggestions for this draft.
        </p>
      ) : (
        <ul className="space-y-3">
          {pending.map((s) => (
            <li key={s.id}>
              <SuggestionCard
                suggestion={s}
                definition={DEFINITIONS_BY_ID[s.checkId]}
                stale={s.id in stale}
                active={s.id === activeId}
                wording={wording[s.id]}
                finding={findings[s.id]}
                {...actions}
              />
            </li>
          ))}
        </ul>
      )}
      {handled.length > 0 && (
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer rounded-lg px-3 py-2 font-medium text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
            Handled ({handled.length})
          </summary>
          <ul className="divide-y border-t">
            {handled.map((item) => (
              <li key={item.suggestion.id} className="space-y-1 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <p>
                      <span className="text-muted-foreground">{STATUS_LABEL[item.status]}:</span>{' '}
                      {item.suggestion.title}
                    </p>
                    <p className="truncate font-mono text-muted-foreground text-xs">
                      {excerpt(item)}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onUndo(item)}>
                    <Undo2 aria-hidden="true" />
                    Undo
                    <span className="sr-only">
                      : {item.suggestion.title}, at "{excerpt(item)}"
                    </span>
                  </Button>
                </div>
                {item.undoStale && (
                  <p role="status" className="text-warning-foreground text-xs">
                    Cannot undo: the applied text was edited since.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
