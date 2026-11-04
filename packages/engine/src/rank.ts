import { NOTE_CHECKS, TEST_LABEL_ORDER, TEST_LABELS, type TestLabel } from './labels';
import { type AnalysisResult, CHECK_IDS, type CheckId, type Suggestion } from './types';

/** One writing note in the order the draft view offers them. */
export interface RankedNote {
  suggestion: Suggestion;
  checkId: CheckId;
  /** What our own tests found for the note's check. */
  label: TestLabel;
  /** A ready edit (kind 'edit' with an `after`): the author can preview and apply it. */
  editable: boolean;
  /** Position in the ranking, from 0. */
  order: number;
}

const labelRank = (label: TestLabel): number => TEST_LABEL_ORDER.indexOf(label);

/**
 * Ranks the writing notes in `result` (pass only the open ones): the suggestions of the nine note
 * checks, never the two question checks. By label (TEST_LABEL_ORDER), then a ready edit first,
 * then document order (range.start); the suggestion id breaks the last ties, so the order never
 * depends on the order of the input. No score or weight enters.
 */
export function rankNotes(result: AnalysisResult): RankedNote[] {
  const notes = result.checks
    .filter((check) => NOTE_CHECKS.includes(check.checkId))
    .flatMap((check) =>
      check.suggestions.map((suggestion) => ({
        suggestion,
        checkId: check.checkId,
        label: TEST_LABELS[check.checkId],
        editable: suggestion.kind === 'edit' && typeof suggestion.after === 'string',
      })),
    );
  notes.sort(
    (a, b) =>
      labelRank(a.label) - labelRank(b.label) ||
      Number(b.editable) - Number(a.editable) ||
      a.suggestion.range.start - b.suggestion.range.start ||
      (a.suggestion.id < b.suggestion.id ? -1 : a.suggestion.id > b.suggestion.id ? 1 : 0),
  );
  return notes.map((n, order) => ({ ...n, order }));
}

/** The Quick edit: the first ready edit among `notes` in ranking order, or null when none is one. */
export function quickEdit(notes: RankedNote[]): RankedNote | null {
  return [...notes].sort((a, b) => a.order - b.order).find((n) => n.editable) ?? null;
}

/**
 * Ranked notes by check: groups in label order (TEST_LABEL_ORDER), then registry order; the
 * notes of a group in document order.
 */
export function groupNotes(
  notes: RankedNote[],
): { checkId: CheckId; label: TestLabel; count: number; notes: RankedNote[] }[] {
  const groups = new Map<CheckId, RankedNote[]>();
  for (const n of notes) {
    const list = groups.get(n.checkId);
    if (list) list.push(n);
    else groups.set(n.checkId, [n]);
  }
  return [...groups]
    .map(([checkId, list]) => ({
      checkId,
      label: list[0].label,
      count: list.length,
      notes: [...list].sort(
        (a, b) => a.suggestion.range.start - b.suggestion.range.start || a.order - b.order,
      ),
    }))
    .sort(
      (a, b) =>
        labelRank(a.label) - labelRank(b.label) ||
        CHECK_IDS.indexOf(a.checkId) - CHECK_IDS.indexOf(b.checkId),
    );
}
