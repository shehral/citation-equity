import { describe, expect, it } from 'vitest';
import espresso from '../../../samples/espresso-bitterness/before.md?raw';
import {
  type AnalysisResult,
  analyze,
  type CheckId,
  type CheckResult,
  groupNotes,
  NOTE_CHECKS,
  quickEdit,
  rankNotes,
  type Suggestion,
  TEST_LABELS,
} from '../src/index';

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
    schemaVersion: 2,
    engineVersion: '0.0.0',
    markdown: '',
    wordCount: 100,
    checks,
    questions: { from: 'page', rows: [], covered: 0 },
  };
}

describe('rankNotes', () => {
  it('ranks the open writing notes only, never the two question checks', () => {
    const r = result([
      check('reader-words', 0, [fix('reader-words', 1)]),
      check('question-coverage', 0, [fix('question-coverage', 2, true)]),
      check('lists', 0, [fix('lists', 3)]),
    ]);
    const notes = rankNotes(r);
    expect(notes.map((f) => f.checkId)).toEqual(['lists']);
    expect(notes[0]).toMatchObject({ label: TEST_LABELS.lists, editable: false, order: 0 });
  });

  it('orders by label, then a ready edit first, then document order, then id, whatever the input order', () => {
    // statistics, tables and standalone-paragraphs read Unclear; lists and question-headings No effect.
    expect([
      TEST_LABELS.statistics,
      TEST_LABELS.tables,
      TEST_LABELS['standalone-paragraphs'],
    ]).toEqual(['unclear', 'unclear', 'unclear']);
    expect([TEST_LABELS.lists, TEST_LABELS['question-headings']]).toEqual([
      'no-effect',
      'no-effect',
    ]);
    const headingEdit = fix('question-headings', 1, true);
    const lists = fix('lists', 2);
    const stats = fix('statistics', 50);
    const table = fix('tables', 10);
    const paragraphEdit = fix('standalone-paragraphs', 90, true);
    const tieA = fix('tables', 70);
    const tieB = fix('statistics', 70);
    const checks = [
      check('question-headings', 0, [headingEdit]),
      check('lists', 0, [lists]),
      check('statistics', 0.9, [stats, tieB]),
      check('tables', 0, [table, tieA]),
      check('standalone-paragraphs', 0, [paragraphEdit]),
    ];
    const ids = rankNotes(result(checks)).map((f) => f.suggestion.id);
    const [first, second] = [tieA.id, tieB.id].sort();
    expect(ids).toEqual([
      paragraphEdit.id,
      table.id,
      stats.id,
      first,
      second,
      headingEdit.id,
      lists.id,
    ]);
    expect(rankNotes(result([...checks].reverse())).map((f) => f.suggestion.id)).toEqual(ids);
    expect(rankNotes(result(checks)).map((f) => f.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('counts only an edit with `after` as a ready edit', () => {
    const noAfter: Suggestion = { ...fix('tables', 1), kind: 'edit' };
    expect(rankNotes(result([check('tables', 0, [noAfter])]))[0]?.editable).toBe(false);
  });
});

describe('quickEdit', () => {
  it('takes the first ready edit in note order, or null when there is none', () => {
    // statistics (Unclear) ranks first but is advice; the two No effect edits follow by position.
    const advice = fix('statistics', 1);
    const listsEdit = fix('lists', 5, true);
    const headingEdit = fix('question-headings', 9, true);
    const notes = rankNotes(
      result([
        check('statistics', 0, [advice]),
        check('lists', 0, [listsEdit]),
        check('question-headings', 0, [headingEdit]),
      ]),
    );
    expect(quickEdit(notes)?.suggestion.id).toBe(listsEdit.id);
    expect(quickEdit([...notes].reverse())?.suggestion.id).toBe(listsEdit.id);
    const next = notes.filter((n) => n.suggestion.id !== listsEdit.id);
    expect(quickEdit(next)?.suggestion.id).toBe(headingEdit.id);
    expect(quickEdit(notes.filter((n) => !n.editable))).toBeNull();
    expect(quickEdit([])).toBeNull();
  });

  it('is the question-heading "?" edit on the example draft', () => {
    const questions = [
      'Why does my espresso taste bitter?',
      'How do I fix bitter espresso?',
      'What water temperature should I use for espresso?',
      'How long should an espresso shot take?',
    ];
    const edit = quickEdit(rankNotes(analyze(espresso, { questions })));
    expect(edit?.checkId).toBe('question-headings');
    expect(edit?.suggestion.before).toBe('Why espresso turns bitter');
    expect(edit?.suggestion.after).toBe('Why espresso turns bitter?');
    expect(quickEdit(rankNotes(analyze(espresso)))?.suggestion.id).toBe(edit?.suggestion.id);
  });
});

describe('groupNotes', () => {
  it('groups by label, then registry order, with notes in document order', () => {
    const l1 = fix('lists', 300);
    const l2 = fix('lists', 100, true);
    const t = fix('tables', 200);
    const s = fix('statistics', 50);
    const h = fix('question-headings', 10, true);
    const groups = groupNotes(
      rankNotes(
        result([
          check('lists', 0, [l1, l2]),
          check('tables', 0.5, [t]),
          check('statistics', 0.9, [s]),
          check('question-headings', 0, [h]),
        ]),
      ),
    );
    expect(groups.map((g) => [g.checkId, g.label, g.count])).toEqual([
      ['statistics', 'unclear', 1],
      ['tables', 'unclear', 1],
      ['question-headings', 'no-effect', 1],
      ['lists', 'no-effect', 2],
    ]);
    expect(groups[3]?.notes.map((n) => n.suggestion.range.start)).toEqual([100, 300]);
    expect(groups.every((g) => NOTE_CHECKS.includes(g.checkId))).toBe(true);
  });

  it('returns no group for no notes', () => {
    expect(groupNotes([])).toEqual([]);
  });
});
