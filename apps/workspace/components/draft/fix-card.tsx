'use client';

import type { Suggestion } from '@citation-equity/engine';
import { CircleCheck, Ellipsis, EyeOff, GitCompare, LocateFixed, WandSparkles } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { excerpt, type FixCopy, STALE_MESSAGE } from '@/lib/fix-copy';
import { cn } from '@/lib/utils';

/** The local wording helper's state for one card: asking, or a message to show (an error). */
export type WordingState = { status: 'asking' } | { status: 'error'; message: ReactNode };

export interface FixActions {
  /** Opens the before/after preview of an edit; Apply lives only there. */
  onPreview(s: Suggestion): void;
  /** Selects the passage in the draft. */
  onShow(s: Suggestion): void;
  onDone(s: Suggestion): void;
  onSkip(s: Suggestion): void;
  onSuggestWording(s: Suggestion): void;
}

interface FixCardProps extends FixActions {
  suggestion: Suggestion;
  copy: FixCopy;
  editable: boolean;
  /** A prefix that keeps ids unique when one fix is on screen twice (Start here and its group). */
  idPrefix: string;
  /** The number shown on the card (Start here 1 to 3, or the fix's place in its group). */
  number?: number;
  active?: boolean;
  stale?: boolean;
  /** True when Suggest wording may be offered: an advisory, a model connected, not data. */
  canSuggest?: boolean;
  wording?: WordingState;
}

const itemClass = cn(
  'flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none',
  'data-[highlighted]:bg-sunken data-[highlighted]:text-foreground',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-soft',
);

/**
 * One fix: its title, the line it is about, one reason and one main button (Preview for an edit,
 * Show me for advice), with Done and Skip in the overflow (plus Show me, for an edit). Nothing
 * here changes the draft: an edit is applied only from its preview.
 */
export function FixCard({
  suggestion: s,
  copy,
  editable,
  idPrefix,
  number,
  active = false,
  stale = false,
  canSuggest = false,
  wording,
  ...actions
}: FixCardProps) {
  const titleId = `${idPrefix}-${s.id}-title`;
  const asking = wording?.status === 'asking';
  const line = excerpt(s.before);
  return (
    <article
      aria-labelledby={titleId}
      data-kind={editable ? 'edit' : 'advisory'}
      data-fix={s.id}
      className={cn(
        'rounded-lg border bg-surface p-3 motion-safe:transition-colors',
        active ? 'border-brand ring-[3px] ring-brand-soft' : 'hover:border-border-strong',
      )}
    >
      <div className="flex items-start gap-2.5">
        {number !== undefined && (
          <span
            aria-hidden="true"
            className="grid size-5.5 shrink-0 place-items-center rounded-full bg-brand-soft font-semibold text-brand text-xs tabular-nums"
          >
            {number}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <h3 id={titleId} className="font-semibold text-sm leading-snug">
            {copy.title}
          </h3>
          {line !== '' && (
            <p className="truncate font-serif text-ink-soft text-sm italic">{line}</p>
          )}
          <p className="text-ink-soft text-sm">{copy.reason}</p>
          {stale && (
            <p role="status" className="rounded-md bg-stale-soft px-2 py-1 text-stale text-sm">
              {STALE_MESSAGE}
            </p>
          )}
          {wording?.status === 'error' && (
            <div role="status" className="space-y-2 rounded-md border p-2 text-sm">
              {wording.message}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {editable ? (
              <Button type="button" size="sm" onClick={() => actions.onPreview(s)}>
                <GitCompare aria-hidden="true" />
                Preview
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => actions.onShow(s)}>
                <LocateFixed aria-hidden="true" />
                Show me
              </Button>
            )}
            {canSuggest && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={asking}
                onClick={() => actions.onSuggestWording(s)}
              >
                <WandSparkles aria-hidden="true" />
                {asking ? 'Writing...' : 'Suggest wording'}
              </Button>
            )}
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`More actions: ${copy.title}`}
                  className="ml-auto"
                >
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className={cn(
                    'z-50 min-w-36 rounded-lg border bg-popover p-1 text-popover-foreground shadow-pop',
                    'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0',
                  )}
                >
                  {editable && (
                    // An edit's main button is Preview; Show me is here, so a phone can still jump
                    // to its passage.
                    <DropdownMenu.Item className={itemClass} onSelect={() => actions.onShow(s)}>
                      <LocateFixed aria-hidden="true" strokeWidth={1.75} />
                      Show me
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Item className={itemClass} onSelect={() => actions.onDone(s)}>
                    <CircleCheck aria-hidden="true" strokeWidth={1.75} />
                    Done
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={itemClass} onSelect={() => actions.onSkip(s)}>
                    <EyeOff aria-hidden="true" strokeWidth={1.75} />
                    Skip
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>
    </article>
  );
}
