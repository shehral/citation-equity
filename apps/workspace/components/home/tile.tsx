'use client';

import { ArrowRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';

/** A tile is not checked yet, checked, or needs attention. */
export type TileState = 'not-checked' | 'checked' | 'attention';

const STATE: Record<TileState, { label: string; className: string }> = {
  'not-checked': { label: 'Not checked', className: 'bg-sunken text-ink-soft' },
  checked: { label: 'Checked', className: 'bg-done-soft text-done' },
  attention: { label: 'Needs attention', className: 'bg-brand-soft text-brand' },
};

export interface TileProps {
  name: string;
  /** The plain question the tile answers. */
  question: string;
  icon: LucideIcon;
  state: TileState;
  /** True when the example produced the result: the tile then says Example. */
  example?: boolean;
  href: string;
  /** The tile's one link, at its foot; the whole tile is clickable through it. */
  cta: string;
  children: ReactNode;
}

/**
 * One home tile: name, state, question, body and one link. The link stretches over the tile, so
 * the tile reads as one control while its text stays plain text for screen readers.
 */
export function Tile({
  name,
  question,
  icon: Icon,
  state,
  example,
  href,
  cta,
  children,
}: TileProps) {
  const nameId = useId();
  const { label, className } = STATE[state];
  return (
    <section
      aria-labelledby={nameId}
      className={cn(
        'relative flex min-h-60 flex-col gap-3.5 rounded-lg border bg-surface p-5 shadow-card',
        'transition-[border-color,box-shadow,translate] duration-150',
        'hover:border-border-strong hover:shadow-pop motion-safe:hover:-translate-y-0.5',
        'has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring',
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-soft text-brand">
          <Icon className="size-[18px]" aria-hidden="true" strokeWidth={1.75} />
        </span>
        <h2 id={nameId} className="font-semibold text-[15px]">
          {name}
        </h2>
        <span className="ml-auto flex items-center gap-1.5">
          {example ? (
            <span className="rounded-md bg-sunken px-1.5 py-1 font-medium text-[11px] text-ink-soft uppercase leading-none tracking-wide">
              Example
            </span>
          ) : null}
          <span
            className={cn(
              'whitespace-nowrap rounded-full px-2.5 py-1 font-medium text-xs leading-none',
              className,
            )}
          >
            {label}
          </span>
        </span>
      </div>
      <p className="font-medium font-serif text-xl leading-tight tracking-tight">{question}</p>
      <div className="flex flex-1 flex-col justify-end gap-2">
        {children}
        <Link
          href={href}
          className={cn(
            'flex items-center gap-1.5 font-medium text-brand text-sm outline-none',
            'after:absolute after:inset-0 after:rounded-lg after:content-[""]',
          )}
        >
          {cta}
          <span className="sr-only">: {name}</span>
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

/**
 * A big number with its unit, as the tiles show their status. The space between them is real
 * text, so the tile reads "5 of 7 pass" (not "5of 7 pass") to screen readers and in copied text.
 */
export function Big({ n, of, children }: { n: number; of: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="font-medium font-serif text-5xl tabular-nums lining-nums leading-none tracking-tight">
        {n}
      </span>{' '}
      <span className="text-[15px] text-ink-soft">{of}</span>
      {children}
    </div>
  );
}

/** A one-line status under the big number. */
export function Meta({ children }: { children: ReactNode }) {
  return <p className="text-ink-soft text-sm">{children}</p>;
}
