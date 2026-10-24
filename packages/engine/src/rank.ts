import type { AnalysisResult, CheckId, Suggestion, Weights } from './types';

/** One fix in the order the draft view offers them ("Start here" takes the first three). */
export interface RankedFix {
  suggestion: Suggestion;
  checkId: CheckId;
  /** A ready edit (kind 'edit' with an `after`): the author can preview and apply it. */
  editable: boolean;
  /** Expected score gain: weight x (1 - check score) / the check's open fixes. */
  gain: number;
  /** Position in the ranking, from 0. */
  order: number;
}

/**
 * Ranks the fixes in `result` (pass only the open ones, for example a result whose suggestions
 * were filtered to the pending ones). Fixes with a ready edit come first, then the larger
 * expected gain, then document order (range.start); the suggestion id breaks the last ties, so
 * the order never depends on the order of the input. A check that does not apply, or whose
 * weight is not a positive number, gains nothing.
 */
export function rankFixes(result: AnalysisResult, weights: Weights): RankedFix[] {
  const fixes: Omit<RankedFix, 'order'>[] = [];
  for (const check of result.checks) {
    const open = check.suggestions.length;
    if (open === 0) continue;
    const w = weights[check.checkId];
    const weight = Number.isFinite(w) && w > 0 ? w : 0;
    const score = Math.min(1, Math.max(0, check.score));
    const gain = check.applicable ? (weight * (1 - score)) / open : 0;
    for (const suggestion of check.suggestions) {
      fixes.push({
        suggestion,
        checkId: check.checkId,
        editable: suggestion.kind === 'edit' && typeof suggestion.after === 'string',
        gain,
      });
    }
  }
  fixes.sort(
    (a, b) =>
      Number(b.editable) - Number(a.editable) ||
      b.gain - a.gain ||
      a.suggestion.range.start - b.suggestion.range.start ||
      (a.suggestion.id < b.suggestion.id ? -1 : a.suggestion.id > b.suggestion.id ? 1 : 0),
  );
  return fixes.map((f, order) => ({ ...f, order }));
}

/** Ranked fixes by check: groups in the order of each check's best fix, fixes in document order. */
export function groupFixes(
  fixes: RankedFix[],
): { checkId: CheckId; count: number; fixes: RankedFix[] }[] {
  const groups = new Map<CheckId, RankedFix[]>();
  for (const f of [...fixes].sort((a, b) => a.order - b.order)) {
    const list = groups.get(f.checkId);
    if (list) list.push(f);
    else groups.set(f.checkId, [f]);
  }
  return [...groups].map(([checkId, list]) => ({
    checkId,
    count: list.length,
    fixes: [...list].sort(
      (a, b) => a.suggestion.range.start - b.suggestion.range.start || a.order - b.order,
    ),
  }));
}
