import { describe, expect, it } from 'vitest';
import espresso from '../../../samples/espresso-bitterness/before.md?raw';
import {
  type AnalysisResult,
  analyze,
  CHECK_IDS,
  type CheckId,
  type CheckResult,
  EVIDENCE,
  groupFixes,
  PRESET_WEIGHTS,
  rankFixes,
  START_HERE_COUNT,
  type Suggestion,
  startHereFixes,
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
  it('puts fixes of a check our own test measured as helping first, before ready edits', () => {
    // question-coverage and reader-words carry the E1 label "helps"; the others do not.
    expect(EVIDENCE['question-coverage'].e1.label).toBe('helps');
    expect(EVIDENCE['reader-words'].e1.label).toBe('helps');
    const edit = fix('question-headings', 10, true);
    const big = fix('lists', 20);
    const words = fix('reader-words', 900);
    const coverage = fix('question-coverage', 500);
    const r = result([
      check('lists', 0, [big]),
      check('question-headings', 0, [edit]),
      check('reader-words', 0.9, [words]),
      check('question-coverage', 0.5, [coverage]),
    ]);
    const ranked = rankFixes(r, weights());
    // Measured first (by gain: 0.5 over 0.1), then the existing rule: the ready edit, then gain.
    expect(ranked.map((f) => f.suggestion.id)).toEqual([coverage.id, words.id, edit.id, big.id]);
    expect(ranked.map((f) => f.measured)).toEqual([true, true, false, false]);
  });

  it('puts fixes of a check that does not count toward the score (an unscored note) after the scored ones, ready edits included', () => {
    // question-headings is an unscored note in both presets (weight 0); its heading edit stays.
    expect(PRESET_WEIGHTS.foundation['question-headings']).toBe(0);
    const edit = fix('question-headings', 10, true);
    const stats = fix('statistics', 500);
    const lead = fix('direct-answer-lead', 5, true);
    const r = result([
      check('question-headings', 0, [edit]),
      check('statistics', 0.9, [stats]),
      check('direct-answer-lead', 0, [lead]),
    ]);
    for (const preset of ['foundation', 'evidence'] as const) {
      const ranked = rankFixes(r, PRESET_WEIGHTS[preset]);
      expect(
        ranked.map((f) => f.suggestion.id),
        preset,
      ).toEqual([stats.id, lead.id, edit.id]);
      expect(
        ranked.map((f) => f.scored),
        preset,
      ).toEqual([true, false, false]);
      expect(ranked[2]?.editable).toBe(true);
    }
    // A custom weight that includes the note ranks it like any scored check again.
    const custom = rankFixes(r, { ...PRESET_WEIGHTS.foundation, 'question-headings': 1 });
    expect(custom.map((f) => f.suggestion.id)).toEqual([edit.id, stats.id, lead.id]);
  });

  it('fills Start here with scored checks first, one fix per check, then unscored notes', () => {
    const s1 = fix('statistics', 300);
    const s2 = fix('statistics', 100);
    const h1 = fix('question-headings', 1, true);
    const h2 = fix('question-headings', 2, true);
    const c1 = fix('cited-sources', 3);
    const r = result([
      check('statistics', 0, [s1, s2]),
      check('question-headings', 0, [h1, h2]),
      check('cited-sources', 0, [c1]),
    ]);
    const top = startHereFixes(rankFixes(r, PRESET_WEIGHTS.foundation));
    expect(top.map((f) => f.suggestion.id)).toEqual([s2.id, h1.id, c1.id]);
  });

  it('within measured fixes, keeps the existing rule: ready edits, gain, then document order', () => {
    const a = fix('reader-words', 40);
    const b = fix('reader-words', 10);
    const c = fix('question-coverage', 5);
    const r = result([check('reader-words', 0.5, [a, b]), check('question-coverage', 0.75, [c])]);
    // reader-words: 1 x 0.5 / 2 = 0.25; question-coverage: 1 x 0.25 / 1 = 0.25: a tie, so start.
    expect(rankFixes(r, weights()).map((f) => f.suggestion.range.start)).toEqual([5, 10, 40]);
  });

  it('puts fixes with a ready edit first among the rest, whatever their gain', () => {
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

  it('ranks the example draft the same way every time: scored fixes first, ready edits first within each part', () => {
    const md = espresso;
    const r = analyze(md);
    const first = rankFixes(r, PRESET_WEIGHTS.foundation);
    const second = rankFixes(analyze(md), PRESET_WEIGHTS.foundation);
    expect(second.map((f) => f.suggestion.id)).toEqual(first.map((f) => f.suggestion.id));
    expect(first.length).toBe(r.checks.flatMap((c) => c.suggestions).length);
    const lastScored = first.findLastIndex((f) => f.scored);
    const firstUnscored = first.findIndex((f) => !f.scored);
    expect(lastScored).toBeGreaterThanOrEqual(0);
    expect(firstUnscored).toBeGreaterThan(lastScored);
    // The example draft has a ready edit (a heading missing its "?"), an unscored note's, which
    // leads the unscored part.
    const unscored = first.slice(firstUnscored);
    const lastEdit = unscored.findLastIndex((f) => f.editable);
    const firstAdvice = unscored.findIndex((f) => !f.editable);
    expect(unscored[lastEdit]?.checkId).toBe('question-headings');
    expect(firstAdvice).toBeGreaterThan(lastEdit);
  });
});

describe('startHereFixes', () => {
  it('takes the top 3 with at most one fix per check, keeping the ranking order', () => {
    expect(START_HERE_COUNT).toBe(3);
    const q1 = fix('question-coverage', 10);
    const q2 = fix('question-coverage', 20);
    const w1 = fix('reader-words', 0);
    const edit = fix('question-headings', 90, true);
    const stats = fix('statistics', 5);
    const ranked = rankFixes(
      result([
        check('question-coverage', 0, [q1, q2]),
        check('reader-words', 0.5, [w1]),
        check('question-headings', 0.9, [edit]),
        check('statistics', 0, [stats]),
      ]),
      weights(),
    );
    // Full order: q1, q2 (measured, gain 0.5), w1 (measured, 0.5 / 1 = 0.5, start 0 first)...
    expect(ranked.map((f) => f.checkId)).toEqual([
      'reader-words',
      'question-coverage',
      'question-coverage',
      'question-headings',
      'statistics',
    ]);
    const top = startHereFixes(ranked);
    expect(top.map((f) => f.suggestion.id)).toEqual([w1.id, q1.id, edit.id]);
    expect(new Set(top.map((f) => f.checkId)).size).toBe(top.length);
  });

  it('shows fewer than 3 when fewer checks have open fixes', () => {
    const a = fix('lists', 1);
    const b = fix('lists', 2);
    const ranked = rankFixes(result([check('lists', 0, [a, b])]), weights());
    expect(startHereFixes(ranked).map((f) => f.suggestion.id)).toEqual([a.id]);
    expect(startHereFixes([])).toEqual([]);
  });

  it('keeps one ready edit in the example draft’s Start here: the question-heading edit', () => {
    const r = analyze(espresso, {
      authorQuestions: ['How do I fix bitter espresso?', 'Why does my espresso taste bitter?'],
      questions: ['How do I fix bitter espresso?', 'Why does my espresso taste bitter?'],
    });
    const ranked = rankFixes(r, PRESET_WEIGHTS.foundation);
    // The top three by ranking are all advice, so the third slot takes the best ready edit.
    expect(ranked.slice(0, 3).some((f) => f.editable)).toBe(false);
    const top = startHereFixes(ranked);
    expect(top.map((f) => f.checkId)).toEqual([
      'question-coverage',
      'reader-words',
      'question-headings',
    ]);
    expect(top[2]?.editable).toBe(true);
    expect(top[2]?.scored).toBe(false);
    expect(top[2]).toBe(ranked.find((f) => f.editable));
  });
});

describe('startHereFixes: one ready edit', () => {
  it('puts the highest-ranked ready edit in the third slot when the top three have none', () => {
    const q = fix('question-coverage', 1);
    const w = fix('reader-words', 2);
    const s = fix('statistics', 3);
    const t = fix('tables', 4);
    const l = fix('lists', 20, true);
    const h = fix('question-headings', 10, true);
    const ranked = rankFixes(
      result([
        check('question-coverage', 0, [q]),
        check('reader-words', 0, [w]),
        check('statistics', 0, [s]),
        check('tables', 0, [t]),
        check('lists', 0, [l]),
        check('question-headings', 0, [h]),
      ]),
      PRESET_WEIGHTS.foundation,
    );
    // lists and question-headings are unscored notes, so their edits rank last; h comes first by start.
    const top = startHereFixes(ranked);
    expect(top.map((f) => f.suggestion.id)).toEqual([q.id, w.id, h.id]);
  });

  it('leaves the list as ranked when it already holds a ready edit, or when no fix is one', () => {
    const q = fix('question-coverage', 1);
    const e = fix('tables', 2, true);
    const s = fix('statistics', 3);
    const h = fix('question-headings', 4, true);
    const withEdit = rankFixes(
      result([
        check('question-coverage', 0, [q]),
        check('tables', 0, [e]),
        check('statistics', 0, [s]),
        check('question-headings', 0, [h]),
      ]),
      PRESET_WEIGHTS.foundation,
    );
    expect(startHereFixes(withEdit).filter((f) => f.editable)).toHaveLength(1);
    const advice = [fix('question-coverage', 1), fix('statistics', 2), fix('tables', 3)];
    const none = rankFixes(
      result(advice.map((a) => check(a.checkId, 0, [a]))),
      PRESET_WEIGHTS.foundation,
    );
    expect(startHereFixes(none).map((f) => f.suggestion.id)).toEqual(advice.map((a) => a.id));
  });

  it('keeps one fix per check: an edit of a check shown above takes that check’s slot', () => {
    const q1 = fix('question-coverage', 1);
    const q2 = fix('question-coverage', 50, true);
    const w = fix('reader-words', 2);
    const s = fix('statistics', 3);
    const ranked = rankFixes(
      result([
        check('question-coverage', 0, [q1, q2]),
        check('reader-words', 0, [w]),
        check('statistics', 0, [s]),
      ]),
      PRESET_WEIGHTS.foundation,
    );
    // q2 is measured and editable, so it already ranks first; force the case with advice only up top.
    const advisoryFirst = ranked.map((f, i) =>
      f.suggestion.id === q2.id ? { ...f, order: 99 } : { ...f, order: i },
    );
    const plain = startHereFixes(advisoryFirst.filter((f) => f.suggestion.id !== q2.id));
    const top = startHereFixes(advisoryFirst);
    // Same checks in the same slots; question-coverage's slot now holds its ready edit.
    expect(top.map((f) => f.checkId)).toEqual(plain.map((f) => f.checkId));
    expect(top.find((f) => f.checkId === 'question-coverage')?.suggestion.id).toBe(q2.id);
    expect(new Set(top.map((f) => f.checkId)).size).toBe(3);
  });

  it('with fewer checks than slots, swaps a check’s advice for its own ready edit', () => {
    const a = fix('statistics', 1);
    const b = fix('statistics', 2);
    const e = fix('lists', 5, true);
    const l = fix('lists', 3);
    const ranked = rankFixes(
      result([check('statistics', 0, [a, b]), check('lists', 0, [l, e])]),
      weights(),
    );
    const top = startHereFixes(ranked);
    expect(top).toHaveLength(2);
    expect(top.some((f) => f.suggestion.id === e.id)).toBe(true);
    expect(new Set(top.map((f) => f.checkId)).size).toBe(2);
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
