'use client';

import { type CheckId, EVIDENCE } from '@citation-equity/engine';
import {
  ArrowUpToLine,
  ChevronRight,
  Heading,
  Link2,
  List,
  type LucideIcon,
  Percent,
  Pilcrow,
  Quote,
  Scale,
  Table2,
  Target,
  Undo2,
} from 'lucide-react';
import { GradeLabel } from '@/components/grade-label';
import { Button } from '@/components/ui/button';
import { excerpt } from '@/lib/fix-copy';
import { CHECK_NAMES } from '@/lib/glossary';
import { cn } from '@/lib/utils';
import type { FixActions } from './fix-card';
import { FixCard } from './fix-card';
import type { FixItem, HandledItem } from './start-here';

/** One icon per check, so groups are recognizable without reading. */
export const CHECK_ICONS: Record<CheckId, LucideIcon> = {
  'standalone-paragraphs': Pilcrow,
  'question-headings': Heading,
  lists: List,
  statistics: Percent,
  tables: Table2,
  'expert-quotes': Quote,
  'cited-sources': Link2,
  'direct-answer-lead': ArrowUpToLine,
  'question-coverage': Target,
  comparisons: Scale,
};

export interface FixGroup {
  checkId: CheckId;
  /** Open fixes, in document order. */
  items: FixItem[];
  handled: HandledItem[];
}

const STATUS_WORD: Record<HandledItem['status'], string> = {
  applied: 'Applied',
  done: 'Done',
  ignored: 'Skipped',
};

interface FixGroupsProps extends FixActions {
  groups: FixGroup[];
  open: ReadonlySet<CheckId>;
  onToggle(checkId: CheckId): void;
  activeId: string | null;
  onUndo(item: HandledItem): void;
}

/**
 * All fixes, grouped by check: each group collapsed, its count in the title and its evidence grade
 * once. Groups carry no action of their own; every change is one click on one fix.
 */
export function FixGroups({
  groups,
  open,
  onToggle,
  activeId,
  onUndo,
  ...actions
}: FixGroupsProps) {
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="all-fixes-title" className="space-y-2">
      <h2
        id="all-fixes-title"
        className="px-0.5 font-semibold text-ink-soft text-xs uppercase tracking-wider"
      >
        All fixes
      </h2>
      <ul className="space-y-2">
        {groups.map((g) => {
          const Icon = CHECK_ICONS[g.checkId];
          const isOpen = open.has(g.checkId);
          const bodyId = `group-${g.checkId}`;
          return (
            <li
              key={g.checkId}
              className={cn(
                'overflow-hidden rounded-lg border bg-surface',
                isOpen && 'shadow-card',
              )}
            >
              <div className={cn('flex items-center gap-1 pr-2', isOpen && 'bg-sunken')}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() => onToggle(g.checkId)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2.5 pl-3.5 text-left text-sm',
                    'outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
                  )}
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      'size-4 shrink-0 text-ink-faint motion-safe:transition-transform',
                      isOpen && 'rotate-90',
                    )}
                  />
                  <Icon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-ink-soft"
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0 flex-1 font-medium">{CHECK_NAMES[g.checkId]}</span>{' '}
                  <span className="rounded-full bg-sunken px-2 py-0.5 text-ink-soft text-xs tabular-nums">
                    {g.items.length > 0 ? g.items.length : 'Done'}
                  </span>
                </button>
                <GradeLabel grade={EVIDENCE[g.checkId].grade} checkId={g.checkId} />
              </div>
              {isOpen && (
                <div id={bodyId} className="space-y-2 p-2">
                  {g.items.length > 0 && (
                    <ol className="space-y-2">
                      {g.items.map((item, i) => (
                        <li key={item.fix.suggestion.id}>
                          <FixCard
                            suggestion={item.fix.suggestion}
                            copy={item.copy}
                            editable={item.fix.editable}
                            idPrefix="group"
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
                  )}
                  {g.handled.length > 0 && (
                    <ul className="divide-y rounded-lg border">
                      {g.handled.map((h) => (
                        <HandledRow key={h.suggestion.id} item={h} onUndo={onUndo} />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HandledRow({ item, onUndo }: { item: HandledItem; onUndo(item: HandledItem): void }) {
  const { before, after } = item.suggestion;
  const line = excerpt(item.status === 'applied' && after !== undefined ? after : before);
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="text-ink-soft">{STATUS_WORD[item.status]}:</span>{' '}
          <span className="text-ink-soft line-through">{line}</span>
        </p>
        <Button type="button" size="xs" variant="ghost" onClick={() => onUndo(item)}>
          <Undo2 aria-hidden="true" />
          Undo
          <span className="sr-only">
            : {item.copy.title}, at "{line}"
          </span>
        </Button>
      </div>
      {item.undoStale && (
        <p role="status" className="text-stale text-xs">
          Cannot undo: the applied text was edited since.
        </p>
      )}
    </li>
  );
}
