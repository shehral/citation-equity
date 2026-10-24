// "+N since you started": the score when a draft slot was first checked, per
// scoring mode. Stored per slot under `ce:v1:`, so "Clear my data" (store.clearAll) removes it.
// localStorage is read first, so a clear elsewhere takes effect at once; when it throws (private
// window, blocked site data) an in-memory copy serves this page.

import { textChange } from './apply';
import { onClearAll } from './store';

export interface Baseline {
  standard: number;
  evidence: number;
}

const key = (slot: string) => `ce:v1:baseline:${slot}`;
const memory = new Map<string, string | null>();
onClearAll(() => memory.clear());

function read(k: string): string | null {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return memory.get(k) ?? null;
  }
}

function write(k: string, value: string | null): void {
  memory.set(k, value);
  try {
    if (value === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, value);
  } catch {
    // Storage unavailable: the in-memory copy serves this page.
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function loadBaseline(slot: string): Baseline | null {
  const raw = read(key(slot));
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    return v && isNum(v.standard) && isNum(v.evidence)
      ? { standard: v.standard, evidence: v.evidence }
      : null;
  } catch {
    return null;
  }
}

/** Stores the slot's baseline; null forgets it, so the next check sets a new one. */
export function saveBaseline(slot: string, baseline: Baseline | null): void {
  write(key(slot), baseline === null ? null : JSON.stringify(baseline));
}

/**
 * True when one change replaces more than half of the previous draft: a paste over most of the
 * text, which makes it another draft. Typing never does; an empty draft has nothing
 * to replace.
 */
export function replacesMostOf(prev: string, next: string): boolean {
  if (prev.trim() === '') return false;
  const change = textChange(prev, next);
  return change.to - change.from > prev.length / 2;
}

/** The change since the baseline, or null when there is no score or no baseline. */
export function sinceStart(score: number | null, base: number | undefined): number | null {
  return score === null || base === undefined ? null : score - base;
}
