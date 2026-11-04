import { E5_INPUT_LABELS, type E5Results, plannedRows } from './e5';
import { EVIDENCE } from './evidence';
import { CHECK_DEFINITIONS } from './registry';
import { CHECK_IDS, type CheckId, type E1Label } from './types';

// What our own tests found, as fixed labels: one per writing note (from E1 and E3, through
// EVIDENCE) and one per line of a question (from the E5 module, per question input). Labels are
// read from here and never retyped, so a new result changes them in one place.

/** What our own tests found for a check or a question line. */
export type TestLabel =
  | 'helped'
  | 'may-help-less'
  | 'no-effect'
  | 'unclear'
  | 'hurt'
  | 'not-tested';

/**
 * Where a question came from, as far as our tests go: the reader's own (typed or imported), a
 * guess from a keyword, one a local model wrote, or one made from the page itself. Every test
 * used the reader's exact question.
 */
export type QuestionInput = 'reader' | 'keyword' | 'local-model' | 'page';

/** The labels of a question's two lines: (a) words up top, (b) answered. */
export interface QuestionLineLabels {
  words: TestLabel;
  answer: TestLabel;
}

/** Each label as every screen words it. */
export const TEST_LABEL_TEXT: Record<TestLabel, string> = {
  helped: 'Helped in our test',
  'may-help-less': 'May help less',
  'no-effect': 'No effect in our test',
  unclear: 'Unclear',
  hurt: 'Hurt in our test',
  'not-tested': 'Not tested',
};

/** The order notes and their groups follow, by label. */
export const TEST_LABEL_ORDER: TestLabel[] = [
  'helped',
  'may-help-less',
  'unclear',
  'not-tested',
  'no-effect',
  'hurt',
];

/**
 * A check's label from its E1 or E3 result. Every arm that ran without a verdict (too few pages,
 * inconclusive, descriptive, or no edit that passed) reads Unclear, not Not tested: the test ran.
 */
export function testLabelOf(label: E1Label): TestLabel {
  switch (label) {
    case 'helps':
      return 'helped';
    case 'no-effect':
      return 'no-effect';
    case 'insufficient-n':
    case 'inconclusive':
    case 'not-run':
    case 'descriptive':
      return 'unclear';
  }
}

/** The label each word of e5_results.json gives; any other word changes no label. */
const E5_WORDS = new Map<string, TestLabel>([
  ['helps', 'helped'],
  ['helps, possibly through length or query-term overlap', 'helped'],
  ['no effect larger than δ', 'no-effect'],
  ['inconclusive', 'unclear'],
  ['insufficient n', 'unclear'],
  ['model-dependent', 'unclear'],
  ['reported without a verdict', 'unclear'],
  ['hurts', 'hurt'],
]);

/**
 * A label from e5_results.json's words, or 'not-run' when the contrast gave the tool nothing to
 * go on: "descriptive (gate failed)", a status such as "not run", or no label.
 */
export function e5LabelOf(label: string | null): TestLabel | 'not-run' {
  return (label === null ? undefined : E5_WORDS.get(label)) ?? 'not-run';
}

const NOT_TESTED: QuestionLineLabels = { words: 'not-tested', answer: 'not-tested' };

/**
 * The question inputs' labels that `results` set. Step 5 (the pooled 9 vs original) relabels
 * line (b) of the reader's own questions; line (a) keeps E1's label. The labels of the guesses
 * follow the measured results, a rule chosen after E5's results (the plan's readings stand):
 *
 * - Line (b) of a keyword's (9K) or a local model's (9L) question, once the gate passed: a guess
 *   that keeps the gain takes the reader's line (b) label; one partly kept reads May help less;
 *   one that loses the gain reads May help less while it still helps against the unedited page
 *   (its Holm test; E1's note on length or query-term overlap counts as helps), and otherwise
 *   that test's own label. A failed gate, or a guess or test that did not run, reads Not tested.
 * - Line (a) of a keyword's question, from its missing words (12K, its own test, not gated):
 *   measured (12K beats its placebo and is above the unedited page) takes the reader's line (a)
 *   label; no effect against the placebo reads No effect; any other result Unclear; no result
 *   Not tested.
 * - Line (a) of a local model's question reads Not tested: E5 did not work its words in.
 * - A question made from the page always reads Not tested (E5's 9G is a placebo), and a secondary
 *   run changes nothing.
 */
export function deriveInputLabels(results: E5Results): Record<QuestionInput, QuestionLineLabels> {
  const e1: QuestionLineLabels = {
    words: testLabelOf(EVIDENCE['reader-words'].e1.label),
    answer: testLabelOf(EVIDENCE['question-coverage'].e1.label),
  };
  if (results.secondary)
    return { reader: e1, keyword: NOT_TESTED, 'local-model': NOT_TESTED, page: NOT_TESTED };
  const { readings } = results;
  const planned = plannedRows(results);
  /** The label of a planned main-set contrast, 'not-run' when the run has no row for it. */
  const labelOf = (step: string, contrast: string) =>
    e5LabelOf(planned.find((p) => p.step === step && p.contrast === contrast)?.row?.label ?? null);
  const step5 = e5LabelOf(readings.readers_words_label);
  const reader = { words: e1.words, answer: step5 === 'not-run' ? e1.answer : step5 };
  const guess = (g: '9K' | '9L'): TestLabel => {
    if (!readings.gate_passed) return 'not-tested';
    const reading = readings.retention[g];
    if (reading === 'keeps the gain') return reader.answer;
    if (reading === 'partly kept, unclear') return 'may-help-less';
    if (reading !== 'loses the gain') return 'not-tested';
    const vsOriginal = labelOf('family', `${g} vs original`);
    if (vsOriginal === 'helped') return 'may-help-less';
    return vsOriginal === 'not-run' ? 'not-tested' : vsOriginal;
  };
  const missingWords = (): TestLabel => {
    if (readings.missing_words_measured) return reader.words;
    const vsPlacebo = labelOf('arm12', '12K vs P12K');
    if (vsPlacebo === 'not-run') return 'not-tested';
    return vsPlacebo === 'no-effect' ? 'no-effect' : 'unclear';
  };
  return {
    reader,
    keyword: { words: missingWords(), answer: guess('9K') },
    'local-model': { words: 'not-tested', answer: guess('9L') },
    page: NOT_TESTED,
  };
}

/** Each question input's two line labels, as the E5 module sets them. */
export const QUESTION_LABELS = E5_INPUT_LABELS;

/** The two checks measured per question: line (a) words up top, line (b) answered. */
export const QUESTION_CHECKS: CheckId[] = ['reader-words', 'question-coverage'];

/** The nine writing-note checks, in registry order. */
export const NOTE_CHECKS: CheckId[] = CHECK_IDS.filter((id) => !QUESTION_CHECKS.includes(id));

/**
 * Each check's label: a note's from its E1 or E3 result; the two question checks' from the
 * reader's own questions in `inputs` (their measured label, which step 5 of E5 can move).
 */
export function testLabels(
  inputs: Record<QuestionInput, QuestionLineLabels> = QUESTION_LABELS,
): Record<CheckId, TestLabel> {
  const of = (id: CheckId): TestLabel =>
    id === 'reader-words'
      ? inputs.reader.words
      : id === 'question-coverage'
        ? inputs.reader.answer
        : testLabelOf(EVIDENCE[id].e1.label);
  return Object.fromEntries(CHECK_IDS.map((id) => [id, of(id)])) as Record<CheckId, TestLabel>;
}

/** Each check's label today. */
export const TEST_LABELS: Record<CheckId, TestLabel> = testLabels();

/** The checks labelled Helped in our test, in registry order. */
export function helpedChecks(labels: Record<CheckId, TestLabel> = TEST_LABELS): CheckId[] {
  return CHECK_IDS.filter((id) => labels[id] === 'helped');
}

/** A check's registry title as it reads mid-sentence ("question headings"). */
const nameOf = (id: CheckId): string => {
  const title = CHECK_DEFINITIONS.find((d) => d.id === id)?.title ?? id;
  return `${title.charAt(0).toLowerCase()}${title.slice(1)}`;
};

/** "a", "a and b", "a, b and c". */
const joined = (names: string[]): string =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * The Research page's short answer for the checks labelled Helped. "Of the single checks" keeps
 * it true beside the result of every fix applied together.
 */
export function shortAnswer(helped: CheckId[]): string {
  const ids = CHECK_IDS.filter((id) => helped.includes(id));
  const has = (id: CheckId) => ids.includes(id);
  if (ids.length === 0) return 'Short answer: no single check clearly helped in our tests.';
  if (ids.length === 2 && has('reader-words') && has('question-coverage'))
    return "Short answer: of the single checks, only your reader's words near the top helped in our tests.";
  if (ids.length === 1 && has('reader-words'))
    return "Short answer: of the single checks, only your reader's words in the opening helped in our tests.";
  if (ids.length === 1 && has('question-coverage'))
    return "Short answer: of the single checks, only a section that answers the reader's question helped in our tests.";
  return `Short answer: of the single checks, ${joined(ids.map(nameOf))} helped in our tests.`;
}
