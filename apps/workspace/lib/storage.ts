// Per-draft persistence in localStorage. Every access sits in try/catch. When
// localStorage refuses a write (a private window, blocked site data, a full
// quota), the value goes to an in-memory copy that reads prefer, so the draft,
// its Done and Skip choices and its reader questions last for this page's
// lifetime: switching views inside the app keeps them, and the home tile agrees
// with the draft view. A full reload then starts empty, as nothing was stored.

import { MAX_QUESTIONS, mergeQuestions, SOURCE_LABELS, type WorkspaceQuestion } from './questions';
import { onClearAll } from './store';

export type SuggestionStatus = 'pending' | 'applied' | 'done' | 'ignored';

const PREFIX = 'ce:v1:';
const STATUSES = new Set<string>(['pending', 'applied', 'done', 'ignored']);

const statusesKey = (draftKey: string) => `${PREFIX}statuses:${draftKey}`;
const draftItemKey = (draftKey: string) => `${PREFIX}draft:${draftKey}`;
const questionsKey = (draftKey: string) => `${PREFIX}questions:${draftKey}`;

/**
 * Values localStorage refused, by key; null marks a key removed while it was refused. Only these
 * keys are read from memory, so a value localStorage holds is always read from there.
 */
const memory = new Map<string, string | null>();
onClearAll(() => memory.clear());

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    // Storage unavailable: the in-memory copy serves this page.
    memory.set(key, value);
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
    memory.delete(key);
  } catch {
    // Storage unavailable: read the key as removed for this page.
    memory.set(key, null);
  }
}

export function loadStatuses(draftKey: string): Record<string, SuggestionStatus> {
  const raw = read(statusesKey(draftKey));
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, SuggestionStatus> = {};
  for (const [id, status] of Object.entries(parsed)) {
    if (typeof status === 'string' && STATUSES.has(status)) out[id] = status as SuggestionStatus;
  }
  return out;
}

export function saveStatuses(draftKey: string, s: Record<string, SuggestionStatus>): void {
  write(statusesKey(draftKey), JSON.stringify(s));
}

export function loadDraft(draftKey: string): string | null {
  return read(draftItemKey(draftKey));
}

export function saveDraft(draftKey: string, markdown: string): void {
  write(draftItemKey(draftKey), markdown);
}

/**
 * Forgets the saved draft text only (statuses and questions stay). The workspace calls it while
 * the draft equals its starting text, so a later change to a sample reaches returning visitors.
 */
export function forgetDraft(draftKey: string): void {
  remove(draftItemKey(draftKey));
}

/**
 * The draft's saved target questions; null when none were saved (or the value
 * is unreadable), so the caller prefills. An empty list is a saved choice.
 */
export function loadQuestions(draftKey: string): WorkspaceQuestion[] | null {
  const raw = read(questionsKey(draftKey));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: WorkspaceQuestion[] = [];
  for (const item of parsed) {
    const { text, source } = (item ?? {}) as Record<string, unknown>;
    if (typeof text !== 'string' || text.trim() === '') continue;
    if (typeof source !== 'string' || !Object.hasOwn(SOURCE_LABELS, source)) continue;
    out.push({ text, source: source as WorkspaceQuestion['source'] });
  }
  // Drops duplicates an older build may have saved, and keeps at most MAX_QUESTIONS.
  return mergeQuestions([], out).slice(0, MAX_QUESTIONS);
}

export function saveQuestions(draftKey: string, questions: WorkspaceQuestion[]): void {
  write(questionsKey(draftKey), JSON.stringify(questions));
}

/** Forgets the saved questions, so the draft's next load generates them from its text. */
export function forgetQuestions(draftKey: string): void {
  remove(questionsKey(draftKey));
}

/** Forgets the saved draft and statuses (used by "Reset draft"). */
export function clearDraft(draftKey: string): void {
  remove(draftItemKey(draftKey));
  remove(statusesKey(draftKey));
}
