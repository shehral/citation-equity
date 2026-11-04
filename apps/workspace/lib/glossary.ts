// The plain words for checks, evidence grades and our tests' labels, in one place so the draft
// view, the site rows, /cited and /research read the same. The working screens use only the check
// names and the label chips (a fixed phrase and a one-sentence tooltip with no number); grades,
// studies and our tests' numbers live on /research. The label phrases themselves are the engine's
// (TEST_LABEL_TEXT), never retyped here. The engine's registry titles stay as they are for the CLI
// and the JSON report.

import {
  type CheckId,
  E1_COMBINED,
  E1_DELTA,
  type E1Label,
  type E1Result,
  type EvidenceGrade,
  type QuestionInput,
  signed3,
  TEST_LABELS,
  type TestLabel,
} from '@citation-equity/engine';

/** Plain names of the checks. */
export const CHECK_NAMES: Record<CheckId, string> = {
  'standalone-paragraphs': 'Paragraphs make sense alone',
  'question-headings': 'Headings ask questions',
  lists: 'Lists, not long sentences',
  statistics: 'Real numbers',
  tables: 'Comparison tables',
  'expert-quotes': 'Quotes say who said them',
  'cited-sources': 'Claims link a source',
  'direct-answer-lead': 'Answer first',
  'question-coverage': 'Your questions answered',
  comparisons: 'Compares the options',
  'reader-words': "Your reader's words up top",
};

/**
 * A check's label: what our own tests found for it, for the two question checks on the reader's
 * own questions. `labels` is the engine's table unless another is given.
 */
export function labelFor(id: CheckId, labels: Record<CheckId, TestLabel> = TEST_LABELS): TestLabel {
  return labels[id];
}

/** Where a label is shown, which picks the tooltip that is true there. */
export interface LabelContext {
  /** Where a question came from, for a question line's label. */
  input?: QuestionInput;
  /** The own-test result behind the label, which says why a result is unclear. */
  e1?: E1Label | 'model-dependent';
  /** A readiness note (Your site's other page notes). */
  readiness?: boolean;
  /** The Questions covered card's own chip, which stands for the count as well as each edit. */
  card?: boolean;
}

/** Why a result is unclear, by the own-test result behind it. */
const UNCLEAR_TIPS: Partial<Record<NonNullable<LabelContext['e1']>, string>> = {
  inconclusive: 'Our test could not tell either way.',
  'insufficient-n': 'Too few pages in our test to judge.',
  descriptive: 'Our test setup cannot judge this check.',
  'not-run': "No edit passed our test's checks.",
  'model-dependent': "Our test's two judge models disagreed.",
};

/**
 * Which question our tests did not use, by where the question came from. E5 tested a local AI's
 * question for a section that answers it, so its Not tested chip is the words up top line's.
 */
const NOT_TESTED_TIPS: Partial<Record<QuestionInput, string>> = {
  page: "Our tests used the reader's own question, not one made from your page.",
  keyword: "Our tests used the reader's own question, not a guess from a keyword.",
  'local-model': "Our test did not work a local AI's question into the top.",
};

/**
 * What E5 found for a guess with no clear gain, by where the question came from. A keyword's No
 * effect is on its words up top (the missing words), which the general sentence fits.
 */
const NO_EFFECT_TIPS: Partial<Record<QuestionInput, string>> = {
  'local-model':
    'Our test found no clear gain when a local model wrote the question from a keyword.',
};

/**
 * A label chip's tooltip: one plain sentence with no number, true where the chip stands. Every
 * test used the reader's exact question, so Helped speaks of the reader's own question, May help
 * less and a local model's No effect speak of E5's guesses, and Not tested says which question
 * our tests did not use (or, for a readiness note, that they did not cover it).
 */
export function labelTooltip(label: TestLabel, context: LabelContext = {}): string {
  switch (label) {
    case 'helped':
      return context.card
        ? "Each edit raised citation a little in our test, with the reader's own question; the count was not tested."
        : "In our test this raised citation a little when the question was the reader's own.";
    case 'may-help-less':
      return 'Our test found a smaller gain when the question was a guess.';
    case 'no-effect':
      return (
        (context.input && NO_EFFECT_TIPS[context.input]) ??
        'Our test ruled out a large effect; a small one either way is possible.'
      );
    case 'unclear':
      return (context.e1 && UNCLEAR_TIPS[context.e1]) ?? 'Our test could not tell either way.';
    case 'hurt':
      return 'In our test this lowered citation a little.';
    case 'not-tested':
      return (
        (!context.readiness && context.input && NOT_TESTED_TIPS[context.input]) ||
        'Our tests did not cover this.'
      );
  }
}

/**
 * An E5 result's label in words, as e5_results.json gives it, with δ as its value, a contrast
 * whose gate did not pass as having no verdict, and a contrast with no label as not run.
 */
export function labelWords(label: string | null): string {
  if (label === null) return 'not run';
  if (label === 'descriptive (gate failed)') return 'no verdict (the gate did not pass)';
  return label.replace('δ', String(E1_DELTA));
}

/** The four grades in words (the Research page only). */
export const GRADE_WORDS: Record<EvidenceGrade, string> = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  mixed: 'Mixed evidence',
  untested: 'Untested',
};

/** What each grade means, in one line. */
export const GRADE_MEANING: Record<EvidenceGrade, string> = {
  strong: 'Several controlled studies agree, including real search.',
  moderate: 'Studies point the same way; none found harm.',
  mixed: 'At least one study found no effect or harm.',
  untested: 'No direct test yet.',
};

/**
 * Plain leads for the checks whose engine summary opens on a study's name. The studies stay
 * named in the full summary behind the expand.
 */
export const PLAIN_LEADS: Partial<Record<CheckId, string>> = {
  statistics:
    'Real, checkable numbers help, but adding figures for their own sake helped in one early test and hurt in a larger one.',
  'expert-quotes':
    'Adding quotes helped in one early test, but a larger test found no gain, so quote people only where it adds something.',
  'cited-sources':
    'Linking credible sources helped in one early test, but later tests found little gain from adding references alone.',
};

/** What our own test (E1, or E3) found for a check, in plain words. The numbers sit behind an expand. */
export const E1_WORDS: Record<E1Label, string> = {
  helps: 'Tested: helped a little, maybe through wording overlap',
  // "No effect larger than 0.03": a small effect either way is not ruled out, so never "does nothing".
  'no-effect': 'Tested: no clear effect',
  'insufficient-n': 'Tested: too few pages',
  inconclusive: 'Tested: unclear',
  'not-run': 'Tested: no edit passed our checks',
  // Measured, but the setup cannot give this check a verdict (it needs passage-level retrieval).
  descriptive: 'Tested: no verdict by design',
};

/** A check's own-test result in plain words; an unclear result says which way it leaned. */
export function ownTestWords(result: E1Result): string {
  const words = E1_WORDS[result.label];
  if (result.label !== 'inconclusive' || result.effect === null || result.effect.d === 0)
    return words;
  return `${words}, leaning ${result.effect.d > 0 ? 'positive' : 'negative'}`;
}

const all = E1_COMBINED.vsOriginal;

/** The combined result of every fix applied together (E1's ALL arm), in one sentence. */
export const E1_COMBINED_SENTENCE = `In our own test, applying every fix together raised the citation score by ${signed3(all.d)} (${all.level}% CI [${signed3(all.ci[0])}, ${signed3(all.ci[1])}], n ${all.n}) over the original page and by ${signed3(E1_COMBINED.vsPlacebo.d)} over a paraphrase of the same passages, possibly through length or query-term overlap.`;
