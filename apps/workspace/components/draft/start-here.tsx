'use client';

import type { RankedFix, Suggestion } from '@citation-equity/engine';
import type { FixCopy } from '@/lib/fix-copy';
import type { SuggestionStatus } from '@/lib/storage';
import { START_HERE_ID } from '@/lib/views';
import { type FixActions, FixCard, type WordingState } from './fix-card';

/** An open fix as the rail shows it. */
export interface FixItem {
  fix: RankedFix;
  copy: FixCopy;
  stale: boolean;
  canSuggest: boolean;
  wording?: WordingState;
}

/** A fix the author handled: applied (this session only), done or skipped, with its Undo. */
export interface HandledItem {
  suggestion: Suggestion;
  copy: FixCopy;
  status: Exclude<SuggestionStatus, 'pending'>;
  /** Undo of an applied edit failed because its text was edited since. */
  undoStale: boolean;
}

/** The top three fixes by rankFixes: ready edits first, then the larger expected gain. */
export function StartHere({
  items,
  activeId,
  ...actions
}: FixActions & { items: FixItem[]; activeId: string | null }) {
  if (items.length === 0) return null;
  return (
    <section
      id={START_HERE_ID}
      aria-labelledby="start-here-title"
      className="scroll-mt-24 space-y-2"
    >
      <h2
        id="start-here-title"
        className="px-0.5 font-semibold text-ink-soft text-xs uppercase tracking-wider"
      >
        Start here
      </h2>
      <ol className="space-y-2">
        {items.map((item, i) => (
          <li key={item.fix.suggestion.id}>
            <FixCard
              suggestion={item.fix.suggestion}
              copy={item.copy}
              editable={item.fix.editable}
              idPrefix="start"
              number={i + 1}
              active={item.fix.suggestion.id === activeId}
              stale={item.stale}
              canSuggest={item.canSuggest}
              wording={item.wording}
              {...actions}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
