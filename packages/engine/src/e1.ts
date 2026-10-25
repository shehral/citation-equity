import type { CheckId, E1Effect, E1Label, E1Result, OwnTest } from './types';

// E1, the project's own pre-registered test of the checks (experiments/PREREG_E1.md, results in
// experiments/RESULTS_E1.md): each check's fix applied to real pages, judged by two local models
// in a fixed set of four sources. Main set, primary contrasts. The editor-family check did not
// run, so every label carries "Gemma-edited". E3 (experiments/PLAN_E3.md, results in
// experiments/RESULTS_E3.md) asked E1's question again, with E1's editor, judges and statistics,
// for the seven checks E1 had too few pages for; its pooled result replaces E1's for those
// checks, by E1's rule table. E1's own numbers for them stay in docs/evidence.md.

/** The results file of each test, relative to the repository root. */
export const OWN_TEST_RESULTS: Record<OwnTest, string> = {
  E1: 'experiments/RESULTS_E1.md',
  E3: 'experiments/RESULTS_E3.md',
};

/** δ: "no effect larger than δ" means the 90% interval lies within ±δ citation-score units. */
export const E1_DELTA = 0.03;

/** The models behind every E1 and E3 number. */
export const E1_MODELS = 'Gemma-4-12B and Qwen3.8-27B judges, Gemma-edited';

/** Each label as the results file words it. */
export const E1_LABEL_TEXT: Record<E1Label, string> = {
  helps: 'helps, possibly through length or query-term overlap',
  'no-effect': `no effect larger than ${E1_DELTA}`,
  'insufficient-n': 'insufficient n',
  inconclusive: 'inconclusive',
  'not-run': 'not run (no valid edit)',
  descriptive: 'descriptive, no verdict by design',
};

/** A signed number to three decimals: +0.027, -0.015, +0.000. */
export const signed3 = (x: number): string => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(3)}`;

/** "d -0.015, 95% CI [-0.031, +0.000], n 17" (and ", Holm p 0.006" when given). */
export function formatE1Effect(e: E1Effect): string {
  const holm = e.holmP === undefined ? '' : `, Holm p ${e.holmP.toFixed(3)}`;
  return `d ${signed3(e.d)}, ${e.level}% CI [${signed3(e.ci[0])}, ${signed3(e.ci[1])}], n ${e.n}${holm}`;
}

/** "d +0.029, 95% CI [+0.003, +0.061], n 29" for a contrast of the follow-up test (E2). */
const e2 = (d: number, ci: [number, number], n: number): string =>
  formatE1Effect({ d, ci, level: 95, n });

/**
 * Per check, the primary contrast and its label: E1's main set (replication where the results file
 * states it, and what the follow-up test, E2 in experiments/RESULTS_E2.md, found where it ran), or
 * for the seven checks E3 asked again, E3's pooled result over 260 queries. A "no effect" verdict
 * rests on the 90% interval (within ±δ), so that interval is the one shown; Holm p is given for
 * the checks in the test's corrected family. `reader-words` is E1's candidate check for query
 * wording (arm 12), proposed as a check because it helped.
 */
export const E1_RESULTS: Record<CheckId, E1Result> = {
  'standalone-paragraphs': {
    test: 'E1',
    label: 'descriptive',
    effect: { d: 0.007, ci: [-0.008, 0.023], level: 95, n: 24 },
  },
  'question-headings': {
    test: 'E3',
    label: 'no-effect',
    effect: { d: -0.016, ci: [-0.028, -0.004], level: 90, n: 57, holmP: 0.164 },
  },
  lists: {
    test: 'E1',
    label: 'no-effect',
    effect: { d: -0.007, ci: [-0.027, 0.013], level: 90, n: 33 },
  },
  tables: {
    test: 'E3',
    label: 'insufficient-n',
    effect: { d: -0.027, ci: [-0.054, -0.001], level: 95, n: 11 },
  },
  statistics: {
    test: 'E3',
    label: 'insufficient-n',
    effect: { d: -0.007, ci: [-0.045, 0.026], level: 95, n: 11 },
  },
  'expert-quotes': {
    test: 'E3',
    label: 'inconclusive',
    effect: { d: 0.026, ci: [0.001, 0.053], level: 95, n: 62, holmP: 0.179 },
  },
  'cited-sources': {
    test: 'E3',
    label: 'no-effect',
    effect: { d: -0.01, ci: [-0.023, 0.002], level: 90, n: 49, holmP: 0.228 },
  },
  'direct-answer-lead': {
    test: 'E3',
    label: 'no-effect',
    effect: { d: 0.012, ci: [0.002, 0.022], level: 90, n: 66, holmP: 0.179 },
  },
  'question-coverage': {
    test: 'E1',
    label: 'helps',
    effect: { d: 0.027, ci: [0.01, 0.043], level: 95, n: 54, holmP: 0.006 },
    replication: { d: 0.036, ci: [0.016, 0.059], level: 95, n: 52 },
    followUp:
      "Follow-up test (E2): the heading form adds nothing (a question heading against the same words as plain text: d +0.003 main, -0.001 replication, no effect larger than 0.03), and the question's words carry the gain (against a same-size heading without them: d +0.048 replication, helps; +0.017 main, inconclusive). Plain text with the question's words beat the untouched page by +0.023 (main) and +0.037 (replication), reported without a verdict.",
  },
  comparisons: {
    test: 'E3',
    label: 'insufficient-n',
    effect: { d: 0.003, ci: [-0.02, 0.026], level: 95, n: 24 },
  },
  // The replication set had too few valid edits for arm 12 (n 12, insufficient n), so none is shown.
  'reader-words': {
    test: 'E1',
    label: 'helps',
    effect: { d: 0.035, ci: [0.008, 0.066], level: 95, n: 33, holmP: 0.037 },
    followUp: `Follow-up test (E2): with a different editor (Qwen3.8-27B) and judges (Gemma-4-12B and Qwen3.5-9B), the gain kept its sign (${e2(0.029, [0.003, 0.061], 29)}).`,
  },
};

/**
 * Every applicable fix applied together (ALL), against the original page and against a
 * paraphrase placebo of the same spans. Possibly through length or query-term overlap.
 */
export const E1_COMBINED: { vsOriginal: E1Effect; vsPlacebo: E1Effect } = {
  vsOriginal: { d: 0.049, ci: [0.024, 0.076], level: 95, n: 78 },
  vsPlacebo: { d: 0.071, ci: [0.039, 0.109], level: 95, n: 53 },
};

/** "<test>: <label> (d, CI)", such as "E3: inconclusive (d +0.026, ...)", or "<test>: <label>" when the arm did not run. */
export function formatE1(result: E1Result): string {
  const label = `${result.test}: ${E1_LABEL_TEXT[result.label]}`;
  return result.effect === null ? label : `${label} (${formatE1Effect(result.effect)})`;
}

/** The sentence an unscored note's suggestions carry. */
export function unscoredNote(result: E1Result): string {
  const numbers = result.effect === null ? '' : ` (${formatE1Effect(result.effect)})`;
  return `Not scored in Standard or By evidence: our own test (${result.test}) found no effect larger than ${E1_DELTA}${numbers}.`;
}

/** The sentence a measured ("helps") check's suggestions carry. */
export function measuredNote(result: E1Result): string {
  const numbers = result.effect === null ? '' : `${formatE1Effect(result.effect)}; `;
  return `Measured in our own test (${result.test}): ${E1_LABEL_TEXT[result.label]} (${numbers}${E1_MODELS}).`;
}
