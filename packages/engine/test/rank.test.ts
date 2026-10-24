import { describe, expect, it } from 'vitest';
import espresso from '../../../samples/espresso-bitterness/before.md?raw';
import {
  type AnalysisResult,
  analyze,
  CHECK_IDS,
  type CheckId,
  type CheckResult,
  groupFixes,
  PRESET_WEIGHTS,
  rankFixes,
  type Suggestion,
  type Weights,
} from '../src/index';

const weights = (overrides: Partial<Weights> = {}): Weights => ({
  ...(Object.fromEntries(CHECK_IDS.map((id) => [id, 1])) as Weights),
  ...overrides,
});

let n = 0;
function fix(checkId: CheckId, start: number, edit = false): Suggestion {
  n++;
  return {
    id: `${checkId}-${start}-${n}`,
    checkId,
    kind: edit ? 'edit' : 'advisory',
    range: { start, end: start + 5 },
    before: 'xxxxx',
    ...(edit ? { after: 'yyyyy' } : {}),
    title: `Fix ${checkId}`,
    rationale: 'Because.',
    grade: 'mixed',
  };
}

function check(checkId: CheckId, score: number, suggestions: Suggestion[]): CheckResult {
  return { checkId, score, applicable: true, findings: [], suggestions, metrics: {} };
}

function result(checks: CheckResult[]): AnalysisResult {
  return {
    schemaVersion: 1,
    engineVersion: '0.0.0',
    markdown: '',
    wordCount: 100,
    checks,
    scores: { foundation: 50, evidence: 50, custom: null },
  };
}

describe('rankFixes', () => {
  it('puts fixes with a ready edit first, whatever their gain', () => {
    const edit = fix('question-headings', 90, true);
    const big = fix('lists', 10);
    const r = result([check('lists', 0, [big]), check('question-headings', 0.9, [edit])]);
    expect(rankFixes(r, weights()).map((f) => f.suggestion.id)).toEqual([edit.id, big.id]);
  });

  it('does not count an edit kind without `after` as editable', () => {
    const noAfter: Suggestion = { ...fix('tables', 1), kind: 'edit' };
    const [ranked] = rankFixes(result([check('tables', 0, [noAfter])]), weights());
    expect(ranked?.editable).toBe(false);
  });

  it('orders the rest by weight x (1 - check score) / open fixes in that check', () => {
    // lists: 1 x 0.5 / 1 = 0.5; statistics: 2 x 0.5 / 4 = 0.25; tables: 1 x 0.9 / 1 = 0.9
    const lists = fix('lists', 300);
    const stats = [fix('statistics', 100), fix('statistics', 110), fix('statistics', 120)];
    const stats4 = fix('statistics', 130);
    const table = fix('tables', 500);
    const r = result([
      check('lists', 0.5, [lists]),
      check('statistics', 0.5, [...stats, stats4]),
      check('tables', 0.1, [table]),
    ]);
    const ranked = rankFixes(r, weights({ statistics: 2 }));
    expect(ranked.map((f) => f.checkId)).toEqual([
      'tables',
      'lists',
      'statistics',
      'statistics',
      'statistics',
      'statistics',
    ]);
    expect(ranked[0]?.gain).toBeCloseTo(0.9);
    expect(ranked[1]?.gain).toBeCloseTo(0.5);
    expect(ranked[2]?.gain).toBeCloseTo(0.25);
  });

  it('breaks ties by document order and numbers the result', () => {
    const a = fix('lists', 40);
    const b = fix('tables', 20);
    const c = fix('lists', 10);
    const ranked = rankFixes(result([check('lists', 0, [a, c]), check('tables', 0.5, [b])]), {
      ...weights(),
    });
    // lists: 1 x 1 / 2 = 0.5, tables: 1 x 0.5 / 1 = 0.5: all tie, so range.start decides.
    expect(ranked.map((f) => f.suggestion.range.start)).toEqual([10, 20, 40]);
    expect(ranked.map((f) => f.order)).toEqual([0, 1, 2]);
  });

  it('gives a zero gain to a check whose weight is zero or that does not apply', () => {
    const off = fix('lists', 1);
    const na: CheckResult = { ...check('tables', 0, [fix('tables', 2)]), applicable: false };
    const ranked = rankFixes(result([check('lists', 0, [off]), na]), weights({ lists: 0 }));
    expect(ranked.every((f) => f.gain === 0)).toBe(true);
  });

  it('is deterministic: the same input gives the same order, whatever the check order', () => {
    const fixes = [
      fix('lists', 50),
      fix('tables', 50),
      fix('statistics', 50, true),
      fix('cited-sources', 5),
    ];
    const checks = [
      check('lists', 0.2, [fixes[0] as Suggestion]),
      check('tables', 0.2, [fixes[1] as Suggestion]),
      check('statistics', 0.2, [fixes[2] as Suggestion]),
      check('cited-sources', 0.2, [fixes[3] as Suggestion]),
    ];
    const once = rankFixes(result(checks), weights()).map((f) => f.suggestion.id);
    const reversed = rankFixes(result([...checks].reverse()), weights()).map(
      (f) => f.suggestion.id,
    );
    expect(reversed).toEqual(once);
    // Same gain and same start: the id decides, so the order never depends on input order.
    expect(once.slice(2, 4)).toEqual([...once.slice(2, 4)].sort());
  });

  it('ranks the example draft with its edits first, the same way every time', () => {
    const md = espresso;
    const r = analyze(md);
    const first = rankFixes(r, PRESET_WEIGHTS.foundation);
    const second = rankFixes(analyze(md), PRESET_WEIGHTS.foundation);
    expect(second.map((f) => f.suggestion.id)).toEqual(first.map((f) => f.suggestion.id));
    expect(first.length).toBe(r.checks.flatMap((c) => c.suggestions).length);
    // The example draft has a ready edit (a heading missing its "?") among advice.
    const lastEdit = first.findLastIndex((f) => f.editable);
    const firstAdvice = first.findIndex((f) => !f.editable);
    expect(lastEdit).toBeGreaterThanOrEqual(0);
    expect(firstAdvice).toBeGreaterThan(lastEdit);
  });
});

describe('groupFixes', () => {
  it('groups by check in the order of each check’s best fix, with counts and document order', () => {
    const l1 = fix('lists', 300);
    const l2 = fix('lists', 100);
    const t = fix('tables', 200, true);
    const s = fix('statistics', 50);
    const ranked = rankFixes(
      result([
        check('lists', 0, [l1, l2]),
        check('tables', 0.5, [t]),
        check('statistics', 0.9, [s]),
      ]),
      weights(),
    );
    const groups = groupFixes(ranked);
    expect(groups.map((g) => [g.checkId, g.count])).toEqual([
      ['tables', 1],
      ['lists', 2],
      ['statistics', 1],
    ]);
    expect(groups[1]?.fixes.map((f) => f.suggestion.range.start)).toEqual([100, 300]);
  });

  it('returns no group for no fixes', () => {
    expect(groupFixes([])).toEqual([]);
  });
});
