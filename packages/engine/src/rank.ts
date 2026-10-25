import { EVIDENCE } from './evidence';
import type { AnalysisResult, CheckId, Suggestion, Weights } from './types';

/** One fix in the order the draft view offers them ("Start here" takes the first three). */
export interface RankedFix {
  suggestion: Suggestion;
  checkId: CheckId;
  /**
   * The check counts toward the score under these weights (weight above 0). False for an unscored
   * note in Standard and By evidence, unless a custom weight includes it.
   */
  scored: boolean;
  /** The check's fix helped in our own test (its label is "helps"). */
  measured: boolean;
  /** A ready edit (kind 'edit' with an `after`): the author can preview and apply it. */
  editable: boolean;
  /** Expected score gain: weight x (1 - check score) / the check's open fixes. */
  gain: number;
  /** Position in the ranking, from 0. */
  order: number;
}

/**
 * Ranks the fixes in `result` (pass only the open ones, for example a result whose suggestions
 * were filtered to the pending ones). Fixes of a check that counts toward the score come before
 * those of a check that does not (an unscored note, weight 0), whatever else they offer. Within
 * each, fixes of a check our own test measured as helping (label "helps") come first; then fixes
 * with a ready edit, then the larger expected gain, then
 * document order (range.start); the suggestion id breaks the last ties, so
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
    const scored = weight > 0;
    const score = Math.min(1, Math.max(0, check.score));
    const gain = check.applicable ? (weight * (1 - score)) / open : 0;
    for (const suggestion of check.suggestions) {
      fixes.push({
        suggestion,
        checkId: check.checkId,
        scored,
        measured: EVIDENCE[check.checkId].e1.label === 'helps',
        editable: suggestion.kind === 'edit' && typeof suggestion.after === 'string',
        gain,
      });
    }
  }
  fixes.sort(
    (a, b) =>
      Number(b.scored) - Number(a.scored) ||
      Number(b.measured) - Number(a.measured) ||
      Number(b.editable) - Number(a.editable) ||
      b.gain - a.gain ||
      a.suggestion.range.start - b.suggestion.range.start ||
      (a.suggestion.id < b.suggestion.id ? -1 : a.suggestion.id > b.suggestion.id ? 1 : 0),
  );
  return fixes.map((f, order) => ({ ...f, order }));
}

/** How many fixes Start here shows. */
export const START_HERE_COUNT = 3;

/**
 * The fixes Start here shows: the first `count` of `fixes` (in ranking order) with at most one
 * fix per check, so one check's many fixes never fill the list. Fewer when fewer checks have
 * open fixes. Start here always keeps one ready edit: when none of those is one but `fixes` has
 * one, the last slot takes the highest-ranked ready edit (scored or not) of a check not already
 * shown above it; when every ready edit belongs to a check shown above, it takes that check's slot.
 */
export function startHereFixes(fixes: RankedFix[], count = START_HERE_COUNT): RankedFix[] {
  const ordered = [...fixes].sort((a, b) => a.order - b.order);
  const seen = new Set<CheckId>();
  const out: RankedFix[] = [];
  for (const f of ordered) {
    if (out.length >= count) break;
    if (seen.has(f.checkId)) continue;
    seen.add(f.checkId);
    out.push(f);
  }
  if (out.length === 0 || out.some((f) => f.editable)) return out;
  // The slots that stay: all but the last when the list is full, else all of them.
  const kept = out.length >= count ? out.slice(0, -1) : out;
  const keptChecks = new Set(kept.map((f) => f.checkId));
  const edit = ordered.find((f) => f.editable && !keptChecks.has(f.checkId));
  if (edit) return [...kept, edit];
  // Every ready edit belongs to a check shown above: it takes that check's slot.
  const own = ordered.find((f) => f.editable);
  return own ? out.map((f) => (f.checkId === own.checkId ? own : f)) : out;
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
