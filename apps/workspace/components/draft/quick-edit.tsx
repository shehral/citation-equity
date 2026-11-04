'use client';

import type { Suggestion } from '@citation-equity/engine';
import { type ReactNode, useId } from 'react';
import type { FixCopy } from '@/lib/fix-copy';
import { type FixActions, FixCard, type WordingState } from './fix-card';

interface QuickEditProps extends FixActions {
  suggestion: Suggestion;
  copy: FixCopy;
  editable: boolean;
  active: boolean;
  stale: boolean;
  canSuggest: boolean;
  wording?: WordingState;
  /** The note's label chip, shown after its title. */
  chip: ReactNode;
}

/**
 * The one ready edit Start here always keeps when the draft has one: the first among the open
 * writing notes. It is a fix card like any other (Preview, with Apply only in the preview; Done
 * and Skip in the overflow); the same fix also appears in its notes group, so its ids carry their
 * own prefix.
 */
export function QuickEdit({ chip, ...card }: QuickEditProps) {
  const titleId = `${useId()}-title`;
  return (
    <section aria-labelledby={titleId} className="space-y-2">
      <h3 id={titleId} className="px-0.5 font-medium text-ink-soft text-sm">
        Quick edit
      </h3>
      <FixCard {...card} idPrefix="quick" number={1} chip={chip} />
    </section>
  );
}
