// The draft tile's summary for a draft slot, computed with the engine from what the draft view
// will open, and the one way to switch the active draft so the tile follows it at once.
// The draft view keeps the summary current after each analysis; this covers the
// moment of the switch, before the view has analyzed anything.

import { analyze } from '@citation-equity/engine';
import { draftQuestionsFor, draftTextFor, isEmptyDraft } from './open-draft';
import { MY_DRAFT_SLUG, SAMPLES } from './samples';
import { clearSummary, type DraftSummary, MY_POST_SLOT, setActiveSlot, setSummary } from './store';

/** The storage key of a store slot: an example's slug, else the My post key (`my-draft`). */
export function draftKeyFor(slot: string): string {
  return SAMPLES.some((s) => s.slug === slot) ? slot : MY_DRAFT_SLUG;
}

/** The store slot of a storage key. */
export const slotFor = (key: string) => (key === MY_DRAFT_SLUG ? MY_POST_SLOT : key);

/**
 * The summary of a slot's draft as the draft view will open it: the saved draft and questions
 * when there are any, else the example's own. It counts the questions covered, as the draft
 * view's card does, on the draft's own questions or, with none, on the page's own. Null when the
 * draft has no words (nothing to measure).
 */
export function draftSummaryFor(slot: string, at: Date = new Date()): DraftSummary | null {
  const key = draftKeyFor(slot);
  const text = draftTextFor(key);
  if (isEmptyDraft(text)) return null;
  const questions = draftQuestionsFor(key);
  const result = analyze(text, { questions: questions.map((q) => q.text) });
  const s = slotFor(key);
  return {
    slot: s,
    covered: result.questions.covered,
    total: result.questions.rows.length,
    fromPage: result.questions.from === 'page',
    example: s !== MY_POST_SLOT,
    at: at.toISOString(),
  };
}

/**
 * Replaces the draft tile's summary with `slot`'s, or clears it when that draft is empty, so the
 * tile never shows another draft's count.
 */
export function refreshDraftSummary(slot: string, at: Date = new Date()): void {
  const summary = draftSummaryFor(slot, at);
  if (summary) setSummary('draft', summary);
  else clearSummary('draft');
}

/**
 * Makes `slot` the active draft and refreshes the draft tile's summary, so the tile never shows
 * the previous draft (an example's count after "Use my own post").
 */
export function selectDraftSlot(slot: string, at: Date = new Date()): void {
  setActiveSlot(slot);
  refreshDraftSummary(slot, at);
}
