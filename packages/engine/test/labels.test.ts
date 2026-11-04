import { describe, expect, it } from 'vitest';
import {
  CHECK_IDS,
  type CheckId,
  deriveInputLabels,
  type E1Label,
  E5_INPUT_LABELS,
  E5_RESULTS,
  type E5Results,
  type E5Row,
  EVIDENCE,
  e5LabelOf,
  helpedChecks,
  NOTE_CHECKS,
  QUESTION_CHECKS,
  QUESTION_LABELS,
  type QuestionLineLabels,
  shortAnswer,
  TEST_LABEL_ORDER,
  TEST_LABEL_TEXT,
  TEST_LABELS,
  type TestLabel,
  testLabelOf,
  testLabels,
} from '../src/index';
import { E5_ROWS, e5Results, e5Row } from './e5-fixture';

const UNTESTED: QuestionLineLabels = { words: 'not-tested', answer: 'not-tested' };

describe('label phrases', () => {
  it('words each label in one fixed phrase', () => {
    expect(TEST_LABEL_TEXT).toEqual({
      helped: 'Helped in our test',
      'may-help-less': 'May help less',
      'no-effect': 'No effect in our test',
      unclear: 'Unclear',
      hurt: 'Hurt in our test',
      'not-tested': 'Not tested',
    });
  });

  it('orders notes by label: helped, may help less, unclear, not tested, no effect, hurt', () => {
    expect(TEST_LABEL_ORDER).toEqual([
      'helped',
      'may-help-less',
      'unclear',
      'not-tested',
      'no-effect',
      'hurt',
    ]);
  });
});

describe('testLabelOf', () => {
  it('maps every E1 and E3 label: helps to helped, no effect to no effect, every other ran arm to unclear', () => {
    const expected: Record<E1Label, TestLabel> = {
      helps: 'helped',
      'no-effect': 'no-effect',
      'insufficient-n': 'unclear',
      inconclusive: 'unclear',
      'not-run': 'unclear',
      descriptive: 'unclear',
    };
    for (const [label, test] of Object.entries(expected))
      expect(testLabelOf(label as E1Label), label).toBe(test);
  });
});

describe('e5LabelOf', () => {
  it.each([
    ['helps', 'helped'],
    ['helps, possibly through length or query-term overlap', 'helped'],
    ['no effect larger than δ', 'no-effect'],
    ['inconclusive', 'unclear'],
    ['insufficient n', 'unclear'],
    ['model-dependent', 'unclear'],
    ['reported without a verdict', 'unclear'],
    ['hurts', 'hurt'],
    ['descriptive (gate failed)', 'not-run'],
    ['not run', 'not-run'],
    ['not completed', 'not-run'],
    [null, 'not-run'],
    ['a status no rule names', 'not-run'],
    ['constructor', 'not-run'],
  ] as const)('reads %j as %s', (label, test) => {
    expect(e5LabelOf(label)).toBe(test);
  });
});

describe('TEST_LABELS', () => {
  it("gives each check its label: the notes from our tests, the question checks for the reader's own questions", () => {
    expect(TEST_LABELS).toEqual({
      'standalone-paragraphs': 'unclear',
      'question-headings': 'no-effect',
      lists: 'no-effect',
      statistics: 'unclear',
      tables: 'unclear',
      'expert-quotes': 'unclear',
      'cited-sources': 'no-effect',
      'direct-answer-lead': 'no-effect',
      'question-coverage': QUESTION_LABELS.reader.answer,
      comparisons: 'unclear',
      'reader-words': QUESTION_LABELS.reader.words,
    });
    expect(Object.keys(TEST_LABELS)).toEqual([...CHECK_IDS]);
    for (const id of NOTE_CHECKS)
      expect(TEST_LABELS[id], id).toBe(testLabelOf(EVIDENCE[id].e1.label));
  });

  it('takes the two question checks from the input table given, and nothing else from it', () => {
    const inputs = { ...QUESTION_LABELS, reader: { words: 'hurt', answer: 'no-effect' } } as const;
    const labels = testLabels(inputs);
    expect(labels['reader-words']).toBe('hurt');
    expect(labels['question-coverage']).toBe('no-effect');
    for (const id of NOTE_CHECKS) expect(labels[id], id).toBe(TEST_LABELS[id]);
    expect(testLabels()).toEqual(TEST_LABELS);
  });

  it("with E5's results: the reader's own questions keep E1's labels (step 5 helps), the guesses take theirs", () => {
    expect(QUESTION_LABELS).toBe(E5_INPUT_LABELS);
    expect(QUESTION_LABELS).toEqual({
      reader: {
        words: testLabelOf(EVIDENCE['reader-words'].e1.label),
        answer: testLabelOf(EVIDENCE['question-coverage'].e1.label),
      },
      keyword: { words: 'no-effect', answer: 'may-help-less' },
      'local-model': { words: 'not-tested', answer: 'no-effect' },
      page: UNTESTED,
    });
    expect(QUESTION_LABELS.reader).toEqual({ words: 'helped', answer: 'helped' });
    // Two Helped (for the reader's own questions), four No effect, five Unclear.
    const count = (label: TestLabel) =>
      Object.values(TEST_LABELS).filter((l) => l === label).length;
    expect([count('helped'), count('no-effect'), count('unclear')]).toEqual([2, 4, 5]);
  });

  it('never labels a question made from the page as anything but Not tested', () => {
    expect(QUESTION_LABELS.page).toEqual(UNTESTED);
    for (const r of [
      e5Results(),
      e5Results({ missing_words_measured: true }),
      e5Results({ retention: { '9K': 'keeps the gain', '9L': 'keeps the gain' } }),
    ])
      expect(deriveInputLabels(r).page).toEqual(UNTESTED);
  });
});

describe('deriveInputLabels', () => {
  const reader = { words: 'helped', answer: 'helped' } as const;

  /**
   * The fixture's rows with the main-set row of `step` and `contrast` given `label`, or left out
   * when `label` is undefined (a contrast cut for time).
   */
  const relabelled = (step: string, contrast: string, label?: string | null): E5Row[] =>
    E5_ROWS.flatMap((r) =>
      r.set === 'main' && r.step === step && r.contrast === contrast
        ? label === undefined
          ? []
          : [{ ...r, label }]
        : [r],
    );
  const LOSES = { retention: { '9K': 'loses the gain', '9L': 'loses the gain' } } as const;

  it('gives a guess that keeps the gain the reader label, one partly kept May help less', () => {
    expect(deriveInputLabels(e5Results())).toEqual({
      reader,
      keyword: { words: 'no-effect', answer: 'helped' },
      'local-model': { words: 'not-tested', answer: 'may-help-less' },
      page: UNTESTED,
    });
    const swapped = e5Results({
      retention: { '9K': 'partly kept, unclear', '9L': 'keeps the gain' },
    });
    expect(deriveInputLabels(swapped).keyword.answer).toBe('may-help-less');
    expect(deriveInputLabels(swapped)['local-model'].answer).toBe('helped');
  });

  it('reads May help less for a guess that loses the gain but still helps against the unedited page', () => {
    // The fixture's 9K and 9L rows against the unedited page read "helps".
    expect(deriveInputLabels(e5Results(LOSES))).toEqual({
      reader,
      keyword: { words: 'no-effect', answer: 'may-help-less' },
      'local-model': { words: 'not-tested', answer: 'may-help-less' },
      page: UNTESTED,
    });
    // E1's note on length or query-term overlap still counts as helps.
    const noted = e5Results(
      LOSES,
      relabelled(
        'family',
        '9K vs original',
        'helps, possibly through length or query-term overlap',
      ),
    );
    expect(deriveInputLabels(noted).keyword.answer).toBe('may-help-less');
  });

  it('gives a guess that loses the gain its own label against the unedited page otherwise', () => {
    const cases: [string, TestLabel][] = [
      ['no effect larger than δ', 'no-effect'],
      ['inconclusive', 'unclear'],
      ['insufficient n', 'unclear'],
      ['model-dependent', 'unclear'],
      ['hurts', 'hurt'],
    ];
    for (const [label, test] of cases) {
      const keyword = e5Results(LOSES, relabelled('family', '9K vs original', label));
      expect(deriveInputLabels(keyword).keyword.answer, label).toBe(test);
      // The other guess keeps its own row's reading.
      expect(deriveInputLabels(keyword)['local-model'].answer, label).toBe('may-help-less');
      const local = e5Results(LOSES, relabelled('family', '9L vs original', label));
      expect(deriveInputLabels(local)['local-model'].answer, label).toBe(test);
    }
    // Only the main set's row counts: the replication family has the same contrast names.
    const replicationHelps = e5Results(LOSES, [
      ...relabelled('family', '9K vs original', 'no effect larger than δ'),
      e5Row('family', '9K vs original', { set: 'replication', label: 'helps' }),
    ]);
    expect(deriveInputLabels(replicationHelps).keyword.answer).toBe('no-effect');
  });

  it('leaves a guess that loses the gain Not tested when its test against the unedited page gave nothing', () => {
    for (const label of [undefined, null, 'not run', 'descriptive (gate failed)']) {
      const r = e5Results(LOSES, relabelled('family', '9K vs original', label));
      expect(deriveInputLabels(r).keyword.answer, String(label)).toBe('not-tested');
    }
  });

  it('leaves every guess Not tested when the gate did not pass, and step 5 still relabels line (b)', () => {
    const r = e5Results({
      gate_passed: false,
      gate_label: 'no effect larger than δ',
      retention: { '9K': 'descriptive (gate failed)', '9L': 'descriptive (gate failed)' },
      readers_words_label: 'inconclusive',
    });
    expect(deriveInputLabels(r)).toEqual({
      reader: { words: 'helped', answer: 'unclear' },
      // The missing words are their own test, which the gate does not hold back.
      keyword: { words: 'no-effect', answer: 'not-tested' },
      'local-model': UNTESTED,
      page: UNTESTED,
    });
    // A guess's reading cannot count while the gate failed, whatever it says.
    for (const retention of [{ '9K': 'keeps the gain' }, LOSES.retention] as const) {
      const odd = e5Results({ gate_passed: false, gate_label: 'inconclusive', retention });
      expect(deriveInputLabels(odd).keyword.answer).toBe('not-tested');
    }
  });

  it("gives the keyword line (a) the reader's label once the missing words are measured, else their test's", () => {
    const measured = e5Results({ missing_words_measured: true });
    expect(deriveInputLabels(measured).keyword).toEqual({ words: 'helped', answer: 'helped' });
    expect(deriveInputLabels(measured)['local-model'].words).toBe('not-tested');
    // Not measured: no effect against the placebo reads No effect (the fixture's row) ...
    expect(deriveInputLabels(e5Results()).keyword.words).toBe('no-effect');
    // ... a helps that missed the rule (12K vs original not above 0), or any other verdict,
    // reads Unclear ...
    for (const label of ['helps', 'inconclusive', 'insufficient n', 'model-dependent', 'hurts']) {
      const r = e5Results({}, relabelled('arm12', '12K vs P12K', label));
      expect(deriveInputLabels(r).keyword.words, label).toBe('unclear');
    }
    // ... and a missing-words test that did not run reads Not tested.
    for (const label of [undefined, null, 'not run']) {
      const r = e5Results({}, relabelled('arm12', '12K vs P12K', label));
      expect(deriveInputLabels(r).keyword.words, String(label)).toBe('not-tested');
    }
  });

  it("never gives the local model's question a line (a) label: E5 did not work its words in", () => {
    for (const r of [
      e5Results({ missing_words_measured: true }),
      e5Results({ retention: { '9K': 'keeps the gain', '9L': 'keeps the gain' } }),
      e5Results(LOSES),
    ])
      expect(deriveInputLabels(r)['local-model'].words).toBe('not-tested');
  });

  it('leaves a guess cut for time Not tested', () => {
    const cut = e5Results({ retention: { '9K': 'keeps the gain' } });
    expect(deriveInputLabels(cut)['local-model']).toEqual(UNTESTED);
    const notRun = e5Results({ retention: { '9K': 'keeps the gain', '9L': 'not run' } });
    expect(deriveInputLabels(notRun)['local-model']).toEqual(UNTESTED);
  });

  it("moves only the reader's line (b) with step 5, and keeps E1's label when step 5 did not run", () => {
    expect(
      deriveInputLabels(e5Results({ readers_words_label: 'no effect larger than δ' })).reader,
    ).toEqual({ words: 'helped', answer: 'no-effect' });
    expect(deriveInputLabels(e5Results({ readers_words_label: 'hurts' })).reader).toEqual({
      words: 'helped',
      answer: 'hurt',
    });
    expect(deriveInputLabels(e5Results({ readers_words_label: 'not run' })).reader).toEqual(reader);
    // A kept guess takes the reader label as step 5 leaves it.
    const kept = e5Results({ readers_words_label: 'inconclusive' });
    expect(deriveInputLabels(kept).keyword.answer).toBe('unclear');
  });

  it('changes no label for a secondary run', () => {
    const r = { ...e5Results({ readers_words_label: 'hurts' }), secondary: true };
    expect(deriveInputLabels(r)).toEqual({
      reader,
      keyword: UNTESTED,
      'local-model': UNTESTED,
      page: UNTESTED,
    });
  });

  it('feeds the tally and the helped set through testLabels', () => {
    const labels = testLabels(
      deriveInputLabels(e5Results({ readers_words_label: 'no effect larger than δ' })),
    );
    expect(labels['question-coverage']).toBe('no-effect');
    expect(helpedChecks(labels)).toEqual(['reader-words']);
  });

  it("gives E5's results: a keyword's question May help less with No effect for its words, a local model's No effect", () => {
    expect(deriveInputLabels(E5_RESULTS as E5Results)).toEqual({
      reader: { words: 'helped', answer: 'helped' },
      keyword: { words: 'no-effect', answer: 'may-help-less' },
      'local-model': { words: 'not-tested', answer: 'no-effect' },
      page: UNTESTED,
    });
  });
});

describe('helpedChecks and shortAnswer', () => {
  it('lists the checks labelled Helped, in registry order', () => {
    expect(helpedChecks()).toEqual(CHECK_IDS.filter((id) => TEST_LABELS[id] === 'helped'));
    expect(helpedChecks()).toEqual(['question-coverage', 'reader-words']);
    const none = Object.fromEntries(CHECK_IDS.map((id) => [id, 'unclear'])) as Record<
      CheckId,
      TestLabel
    >;
    expect(helpedChecks(none)).toEqual([]);
  });

  it('says what helped in one sentence, for each set', () => {
    expect(shortAnswer(['question-coverage', 'reader-words'])).toBe(
      "Short answer: of the single checks, only your reader's words near the top helped in our tests.",
    );
    expect(shortAnswer(['reader-words', 'question-coverage'])).toBe(
      shortAnswer(['question-coverage', 'reader-words']),
    );
    expect(shortAnswer(['reader-words'])).toBe(
      "Short answer: of the single checks, only your reader's words in the opening helped in our tests.",
    );
    expect(shortAnswer(['question-coverage'])).toBe(
      "Short answer: of the single checks, only a section that answers the reader's question helped in our tests.",
    );
    expect(shortAnswer([])).toBe('Short answer: no single check clearly helped in our tests.');
    expect(shortAnswer(['tables', 'question-headings'])).toBe(
      'Short answer: of the single checks, question headings and tables for comparisons helped in our tests.',
    );
    expect(shortAnswer(['reader-words', 'lists', 'question-coverage'])).toBe(
      "Short answer: of the single checks, lists for enumerations, target questions answered and your reader's words up top helped in our tests.",
    );
  });
});

describe('QUESTION_CHECKS and NOTE_CHECKS', () => {
  it('splits the eleven checks into the two question lines and nine notes in registry order', () => {
    expect(QUESTION_CHECKS).toEqual(['reader-words', 'question-coverage']);
    expect(NOTE_CHECKS).toEqual([
      'standalone-paragraphs',
      'question-headings',
      'lists',
      'statistics',
      'tables',
      'expert-quotes',
      'cited-sources',
      'direct-answer-lead',
      'comparisons',
    ]);
    expect([...NOTE_CHECKS, ...QUESTION_CHECKS].sort()).toEqual([...CHECK_IDS].sort());
  });
});
