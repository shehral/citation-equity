// Your questions: the keyword list, the imported queries and the local model's suggestions the
// /questions/ view turns into the site's reader questions, kept in this browser only (under the
// app's `ce:v1:` prefix, so "Clear my data" removes it). As in store.ts and storage.ts, every
// localStorage access sits in try/catch, and a value localStorage refuses goes to an in-memory
// copy that reads prefer, so with storage blocked the list lasts for this page's lifetime.
// Nothing here makes a request.
//
// "Use in my draft" (addToDraft) writes one question into the open draft's reader questions,
// as the author's own question, through lib/storage.ts, and refreshes the draft tile.

import {
  type ImportedQuery,
  rankImportedQueries,
  type SiteQuestion,
} from '@citation-equity/engine';
import { draftKeyFor, draftSummaryFor } from './draft-summary';
import {
  hasQuestion,
  initialQuestions,
  MAX_QUESTIONS,
  mergeQuestions,
  type WorkspaceQuestion,
} from './questions';
import { MY_DRAFT_SLUG, sampleFor, startingText } from './samples';
import { loadDraft, loadQuestions, saveQuestions } from './storage';
import { getActiveSlot, onClearAll, setSummary } from './store';

export interface SiteInput {
  /** The paste box, as typed: one keyword per line, optionally with a volume. */
  keywords: string;
  /** The last imported export, its top queries only. */
  imported: { name: string; queries: ImportedQuery[] } | null;
  /** Questions the local model suggested from the keywords. */
  suggested: string[];
}

export const EMPTY_SITE_INPUT: SiteInput = Object.freeze({
  keywords: '',
  imported: null,
  suggested: [],
}) as SiteInput;

/** How many of an export's queries are kept, by rank: far more than the 50 the list shows. */
export const IMPORT_KEEP = 200;

const KEY = 'ce:v1:site-questions';

/** The value localStorage refused, if it did; reads prefer it, so it serves this page. */
let memory: string | undefined;
let cached: { raw: string | null; value: SiteInput } | null = null;
const listeners = new Set<() => void>();

// "Clear my data" removes every ce:v1: key; this one goes first, so listeners read it as gone.
onClearAll(() => {
  memory = undefined;
  cached = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: nothing was stored there either.
  }
  notify();
});

function notify() {
  for (const listener of [...listeners]) listener();
}

function readRaw(): string | null {
  if (memory !== undefined) return memory;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v));

function isQuery(v: unknown): v is ImportedQuery {
  if (typeof v !== 'object' || v === null) return false;
  const q = v as Record<string, unknown>;
  return (
    isStr(q.text) &&
    (q.source === 'search-console' || q.source === 'bing-ai') &&
    isNum(q.impressions) &&
    isNum(q.clicks) &&
    isNum(q.citations)
  );
}

function parse(raw: string | null): SiteInput {
  if (raw === null) return EMPTY_SITE_INPUT;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof v !== 'object' || v === null) return EMPTY_SITE_INPUT;
    const imported = v.imported as { name?: unknown; queries?: unknown } | null | undefined;
    const importedOk =
      imported === null ||
      (typeof imported === 'object' &&
        isStr(imported.name) &&
        Array.isArray(imported.queries) &&
        imported.queries.every(isQuery));
    if (!isStr(v.keywords) || !importedOk || !Array.isArray(v.suggested)) return EMPTY_SITE_INPUT;
    if (!v.suggested.every(isStr)) return EMPTY_SITE_INPUT;
    return v as unknown as SiteInput;
  } catch {
    return EMPTY_SITE_INPUT;
  }
}

/** The stored list's input; the same object while nothing changed (a useSyncExternalStore snapshot). */
export function getSiteInput(): SiteInput {
  const raw = readRaw();
  if (cached?.raw === raw) return cached.value;
  const value = parse(raw);
  cached = { raw, value };
  return value;
}

export function setSiteInput(input: SiteInput): void {
  const raw = JSON.stringify(input);
  try {
    window.localStorage.setItem(KEY, raw);
    memory = undefined;
  } catch {
    // Storage unavailable: the in-memory copy serves this page.
    memory = raw;
  }
  notify();
}

/** Calls `listener` after every change here, "Clear my data" included; returns the unsubscribe. */
export function subscribeSiteInput(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** An export's top IMPORT_KEEP queries, by the importer's own rank (citations, then impressions). */
export const keepImported = (queries: ImportedQuery[]): ImportedQuery[] =>
  rankImportedQueries(queries)
    .slice(0, IMPORT_KEEP)
    .map((r) => r.query);

/**
 * The source a site question carries into a draft's reader questions: an export's own, else
 * "Your keywords". Never a generated source, so the draft counts it as the author's question.
 */
export const draftSourceOf = (source: SiteQuestion['source']): WorkspaceQuestion['source'] =>
  source === 'search-console' || source === 'bing-ai' ? source : 'keywords';

export type AddResult = 'added' | 'already' | 'full';

/**
 * "Use in my draft": adds `question` to the open draft's reader questions (the example's, when
 * the example is open), after the questions it has. Refuses a question already there and a
 * draft that holds MAX_QUESTIONS. The draft tile's summary follows at once. `empty` says the
 * draft has no text yet, which the view tells the author, since Reader questions shows only
 * once the draft has text.
 */
export function addToDraft(question: WorkspaceQuestion): {
  result: AddResult;
  example: boolean;
  /** True when the draft has no text yet, so the draft view shows no Reader questions. */
  empty: boolean;
} {
  const slot = getActiveSlot();
  const key = draftKeyFor(slot);
  const example = key !== MY_DRAFT_SLUG;
  const text = loadDraft(key) ?? startingText(key);
  const empty = text.trim() === '';
  const current = loadQuestions(key) ?? initialQuestions(sampleFor(key), text);
  if (hasQuestion(current, question.text)) return { result: 'already', example, empty };
  if (current.length >= MAX_QUESTIONS) return { result: 'full', example, empty };
  saveQuestions(key, mergeQuestions(current, [question]));
  const summary = draftSummaryFor(slot);
  if (summary) setSummary('draft', summary);
  return { result: 'added', example, empty };
}
