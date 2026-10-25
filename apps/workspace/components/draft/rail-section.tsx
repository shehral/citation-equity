'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { cn } from '@/lib/utils';

interface RailSectionProps {
  title: string;
  icon: LucideIcon;
  /** A short summary next to the title, e.g. "4 · 1 answered". */
  meta?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
  className?: string;
}

/**
 * A collapsed section of the fix rail (Reader questions, All checks, Test it). Its body is
 * rendered from the first time it opens, so nothing in it is on the page at load; after that it
 * is only hidden, so collapsing never drops its state (a test run, a connection, a file read).
 */
export function RailSection({
  title,
  icon: Icon,
  meta,
  open,
  onOpenChange,
  children,
  className,
}: RailSectionProps) {
  const id = useId();
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return (
    <div className={cn('rounded-lg border bg-surface shadow-card', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => onOpenChange(!open)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-3.5 py-3 text-left font-medium text-sm',
          'outline-none transition-colors hover:bg-sunken focus-visible:ring-[3px] focus-visible:ring-ring',
        )}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0 text-ink-soft" strokeWidth={1.75} />
        <span id={`${id}-title`} className="min-w-0 flex-1">
          {title}
        </span>{' '}
        {meta && <span className="font-normal text-ink-soft text-xs tabular-nums">{meta}</span>}
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-ink-faint motion-safe:transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {(open || opened) && (
        <section
          id={`${id}-body`}
          hidden={!open}
          aria-labelledby={`${id}-title`}
          className="space-y-3 px-3.5 pb-3.5 text-sm motion-safe:animate-in motion-safe:fade-in-0"
        >
          {children}
        </section>
      )}
    </div>
  );
}
