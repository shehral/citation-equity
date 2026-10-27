// The browser store behind the dashboard: one summary per view, the active draft slot, the last
// view and whether the user ever left the home. Plain module (no 'use client'), browser-only in
// practice: every function is safe to call during prerender, where it reads as empty.
//
// Storage rules:
// - Only summaries are stored. Pasted HTML and pasted AI answers stay in component memory.
// - Every localStorage access sits in try/catch. Each write also goes to an in-memory map, and
//   reads prefer that map, so with storage blocked (private window, blocked site data, a full
//   quota) values last for this page's lifetime and nothing throws.
// - Keys live under `ce:v1:`, the prefix the rest of the app uses too (draft text, statuses,
//   questions, theme), so clearAll() is the "Clear my data" action for everything.
//
// Reactivity: subscribe() notifies after every write here. getSummary() returns the same object
// for an unchanged stored value, so it can be a useSyncExternalStore snapshot directly.

export type ViewId = 'home' | 'draft' | 'site' | 'cited' | 'questions';

export interface DraftSummary {
  /** The draft slot the summary belongs to: MY_POST_SLOT or an example slug. */
  slot: string;
  /**
   * The AI-ready score (0 to 100) under Standard scoring, whatever mode the draft view shows, so
   * the home's "+N" compares it with baseline.standard.
   */
  score: number;
  /** The score when this slot was first checked, per scoring mode ("+N since you started"). */
  baseline: Record<'standard' | 'evidence', number>;
  /** Start here fixes still open; above 0 makes the tile "Needs attention". */
  openStartHere: number;
  /** True when the example produced it; the tile then says Example. */
  example: boolean;
  /** ISO timestamp of the check. */
  at: string;
}

export interface SiteSummary {
  pass: number;
  warn: number;
  fail: number;
  /** Rows in the check, including those that need the live site. */
  total: number;
  needsLiveSite: number;
  example: boolean;
  at: string;
}

export interface CitedSummary {
  /** Answers pasted. */
  answers: number;
  /** Answers that cite the user's own site; 0 when no site was given. */
  citingYou: number;
  /**
   * The user's own site as a host, e.g. "example.com". Absent when none was given: citingYou
   * then says nothing about them, and the tile asks for a site instead.
   */
  site?: string;
  /** The most cited site kinds, most cited first. */
  topKinds: string[];
  example: boolean;
  at: string;
}

type SummaryKind = 'draft' | 'site' | 'cited';
type SummaryFor<K extends SummaryKind> = K extends 'draft'
  ? DraftSummary
  : K extends 'site'
    ? SiteSummary
    : CitedSummary;

/** The slot for the user's own post; the other slots are example (sample) slugs. */
export const MY_POST_SLOT = 'my-post';

export const VIEW_IDS: readonly ViewId[] = ['home', 'draft', 'site', 'cited', 'questions'];

const PREFIX = 'ce:v1:';
const KEYS = {
  summary: (k: SummaryKind) => `${PREFIX}summary:${k}`,
  activeSlot: `${PREFIX}active-slot`,
  lastView: `${PREFIX}last-view`,
  leftHome: `${PREFIX}left-home`,
  probe: `${PREFIX}probe`,
} as const;

/** This page's copy of every value written here; read before localStorage. */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
/** Other modules' in-memory copies, forgotten by clearAll() too. */
const clearers = new Set<() => void>();
/** Parsed summaries by key, reused while the raw string is unchanged. */
const parsed = new Map<string, { raw: string; value: unknown }>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Writes without notifying; callers notify once per public change. */
function put(key: string, value: string): void {
  memory.set(key, value);
  try {
    storage()?.setItem(key, value);
  } catch {
    // Storage unavailable: the in-memory copy serves this page.
  }
}

function write(key: string, value: string): void {
  put(key, value);
  notify();
}

function notify() {
  for (const listener of [...listeners]) listener();
}

/** True when localStorage can be written and read back now. */
export const storageAvailable = (): boolean => {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEYS.probe, '1');
    const ok = s.getItem(KEYS.probe) === '1';
    s.removeItem(KEYS.probe);
    return ok;
  } catch {
    return false;
  }
};

/** Calls `listener` after every change made through this module; returns the unsubscribe. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const VALID: { [K in SummaryKind]: (v: Record<string, unknown>) => boolean } = {
  draft: (v) =>
    isStr(v.slot) &&
    isNum(v.score) &&
    isObj(v.baseline) &&
    isNum(v.baseline.standard) &&
    isNum(v.baseline.evidence) &&
    isNum(v.openStartHere),
  site: (v) =>
    isNum(v.pass) && isNum(v.warn) && isNum(v.fail) && isNum(v.total) && isNum(v.needsLiveSite),
  cited: (v) =>
    isNum(v.answers) &&
    isNum(v.citingYou) &&
    (v.site === undefined || isStr(v.site)) &&
    Array.isArray(v.topKinds) &&
    v.topKinds.every(isStr),
};

/** The stored summary for a view, or null when none is stored or it is unreadable. */
export function getSummary<K extends SummaryKind>(k: K): SummaryFor<K> | null {
  const key = KEYS.summary(k);
  const raw = read(key);
  if (raw === null) return null;
  const cached = parsed.get(key);
  if (cached?.raw === raw) return cached.value as SummaryFor<K> | null;
  let value: unknown = null;
  try {
    const v: unknown = JSON.parse(raw);
    if (isObj(v) && typeof v.example === 'boolean' && isStr(v.at) && VALID[k](v)) value = v;
  } catch {
    value = null;
  }
  parsed.set(key, { raw, value });
  return value as SummaryFor<K> | null;
}

/** Stores a view's summary, replacing the previous one (an example's or the user's). */
export function setSummary(k: 'draft', s: DraftSummary): void;
export function setSummary(k: 'site', s: SiteSummary): void;
export function setSummary(k: 'cited', s: CitedSummary): void;
export function setSummary(k: SummaryKind, s: DraftSummary | SiteSummary | CitedSummary): void {
  write(KEYS.summary(k), JSON.stringify(s));
}

/** Forgets a view's summary, so its tile reads Not checked again. */
export function clearSummary(k: SummaryKind): void {
  const key = KEYS.summary(k);
  memory.delete(key);
  parsed.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // Storage unavailable: the in-memory copy is gone, which is all this page reads.
  }
  notify();
}

/** The draft slot the draft view, its tile and its summary follow; MY_POST_SLOT by default. */
export function getActiveSlot(): string {
  const slot = read(KEYS.activeSlot);
  return slot ? slot : MY_POST_SLOT;
}

export function setActiveSlot(slot: string): void {
  write(KEYS.activeSlot, slot);
}

/** The view the user was last on, or null on a first visit. */
export function getLastView(): ViewId | null {
  const v = read(KEYS.lastView);
  return v !== null && (VIEW_IDS as readonly string[]).includes(v) ? (v as ViewId) : null;
}

/** Records the current view. Any view other than home also marks that the user left the home. */
export function setLastView(v: ViewId): void {
  const leaving = v !== 'home' && read(KEYS.leftHome) !== '1';
  if (!leaving && read(KEYS.lastView) === v) return;
  if (leaving) put(KEYS.leftHome, '1');
  put(KEYS.lastView, v);
  notify();
}

/** True once the user has opened any view other than the home (the header then shows tabs). */
export function hasLeftHome(): boolean {
  return read(KEYS.leftHome) === '1';
}

/**
 * Registers a module's own in-memory copy (draft text, baselines, pasted input) so "Clear my
 * data" forgets it with everything here.
 */
export function onClearAll(clear: () => void): void {
  clearers.add(clear);
}

/** "Clear my data": removes every `ce:v1:*` key from localStorage and from memory. */
export function clearAll(): void {
  memory.clear();
  parsed.clear();
  for (const clear of clearers) clear();
  const s = storage();
  if (s) {
    try {
      const ours: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (key?.startsWith(PREFIX)) ours.push(key);
      }
      for (const key of ours) s.removeItem(key);
    } catch {
      // Storage unavailable: nothing was stored there either.
    }
  }
  notify();
}
