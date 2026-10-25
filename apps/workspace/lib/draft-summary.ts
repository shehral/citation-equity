// The draft tile's summary for a draft slot, computed with the engine from what the draft view
// will open, and the one way to switch the active draft so the tile follows it at once.
// The draft view keeps the summary current after each analysis; this covers the
// moment of the switch, before the view has analyzed anything.

import { analyze, START_HERE_COUNT } from '@citation-equity/engine';
import { loadBaseline } from './baseline';
import { authorQuestionTexts, initialQuestions } from './questions';
import { MY_DRAFT_SLUG, SAMPLES, sampleFor, startingText } from './samples';
import { loadDraft, loadQuestions, loadStatuses } from './storage';
import {
  clearSummary,
  type DraftSummary,
  getSummary,
  MY_POST_SLOT,
  setActiveSlot,
  setSummary,
} from './store';

/** Start here shows the top 3 open fixes, at most one per check. */
export { START_HERE_COUNT };

/** The storage key of a store slot: an example's slug, else the My post key (`my-draft`). */
export function draftKeyFor(slot: string): string {
  return SAMPLES.some((s) => s.slug === slot) ? slot : MY_DRAFT_SLUG;
}

/** The store slot of a storage key. */
export const slotFor = (key: string) => (key === MY_DRAFT_SLUG ? MY_POST_SLOT : key);

/**
 * The summary of a slot's draft as the draft view will open it: the saved draft and questions
 * when there are any, else the example's own. The score is the Standard score. The
 * baseline is the slot's stored one, else an earlier summary's for the same slot, else this
 * score, so "+N since you started" survives. Null when the draft is empty (nothing to score).
 */
export function draftSummaryFor(slot: string, at: Date = new Date()): DraftSummary | null {
  const key = draftKeyFor(slot);
  const text = loadDraft(key) ?? startingText(key);
  if (text.trim() === '') return null;
  const saved = loadQuestions(key) ?? initialQuestions(sampleFor(key), text);
  const result = analyze(text, {
    questions: saved.map((q) => q.text),
    authorQuestions: authorQuestionTexts(saved),
  });
  const standard = result.scores.foundation;
  const evidence = result.scores.evidence;
  if (standard === null || evidence === null) return null;
  const statuses = loadStatuses(key);
  // Start here takes at most one fix per check, so it counts the checks with an open fix.
  const open = result.checks.filter((c) =>
    c.suggestions.some((s) => (statuses[s.id] ?? 'pending') === 'pending'),
  ).length;
  const previous = getSummary('draft');
  const s = slotFor(key);
  return {
    slot: s,
    score: standard,
    baseline:
      loadBaseline(s) ?? (previous?.slot === s ? previous.baseline : { standard, evidence }),
    openStartHere: Math.min(START_HERE_COUNT, open),
    example: s !== MY_POST_SLOT,
    at: at.toISOString(),
  };
}

/**
 * Makes `slot` the active draft and replaces the draft tile's summary with that draft's, or
 * clears it when the draft is empty, so the tile never shows the previous draft (an example's
 * score after "Use my own post").
 */
export function selectDraftSlot(slot: string, at: Date = new Date()): void {
  setActiveSlot(slot);
  const summary = draftSummaryFor(slot, at);
  if (summary) setSummary('draft', summary);
  else clearSummary('draft');
}
