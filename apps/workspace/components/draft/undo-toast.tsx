'use client';

import { Undo2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ToastState {
  /** Bumped per toast, so a new action restarts the timer even with the same message. */
  id: number;
  message: string;
  /** Stays until dismissed: for an action whose Undo is the only way back to lost text. */
  persist?: boolean;
}

/** How long the toast stays, unless the pointer or focus is on it. */
export const TOAST_MS = 5000;

/**
 * "Applied." / "Done." / "Skipped." / "Reset." with one Undo, after the last action. Undo is
 * also on the handled fix in its group, so a missed toast never loses the way back.
 */
export function UndoToast({
  toast,
  onUndo,
  onDismiss,
  raised = false,
}: {
  toast: ToastState | null;
  /** Sits above the phone's fix bar while that bar is on screen. */
  raised?: boolean;
  onUndo(): void;
  onDismiss(): void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const start = () => {
    stop();
    timer.current = setTimeout(() => dismiss.current(), TOAST_MS);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: restarts per toast id only
  useEffect(() => {
    if (toast === null || toast.persist) return;
    start();
    return stop;
  }, [toast?.id]);

  if (toast === null) return null;
  return (
    <div
      role="status"
      aria-label="Last action"
      onPointerEnter={stop}
      onPointerLeave={() => toast?.persist || start()}
      onFocus={stop}
      onBlur={() => toast?.persist || start()}
      className={cn(
        'fixed right-4 bottom-4 left-4 z-40 mx-auto flex max-w-sm items-center gap-2 rounded-lg border',
        raised && 'max-lg:bottom-20',
        'border-border-strong bg-surface py-2 pr-2 pl-4 text-sm shadow-pop',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2',
      )}
    >
      <p className="min-w-0 flex-1">{toast.message}</p>
      <Button type="button" size="sm" variant="ghost" onClick={onUndo}>
        <Undo2 aria-hidden="true" />
        Undo
      </Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
