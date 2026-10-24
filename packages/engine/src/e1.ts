import type { CheckId, E1Effect, E1Label, E1Result } from './types';

// E1, the project's own pre-registered test of the checks (experiments/PREREG_E1.md, results in
// experiments/RESULTS_E1.md): each check's fix applied to real pages, judged by two local models
// in a fixed set of four sources. Main set, primary contrasts. The editor-family check did not
// run, so every label carries "Gemma-edited".

/** δ: "no effect larger than δ" means the 90% interval lies within ±δ citation-score units. */
export const E1_DELTA = 0.03;

/** The models behind every E1 number. */
export const E1_MODELS = 'Gemma-4-12B and Qwen3.8-27B judges, Gemma-edited';

/** Each label as the results file words it. */
export const E1_LABEL_TEXT: Record<E1Label, string> = {
  helps: 'helps, possibly through length or query-term overlap',
  'no-effect': `no effect larger than ${E1_DELTA}`,
  'insufficient-n': 'insufficient n',
  'not-run': 'not run (no valid edit)',
  descriptive: 'descriptive, no verdict by design',
};

/** Per check, the main set's primary contrast (replication where the results file states it). */
export const E1_RESULTS: Record<CheckId, E1Result> = {
  'standalone-paragraphs': {
    label: 'descriptive',
    effect: { d: 0.007, ci: [-0.008, 0.023], level: 95, n: 24 },
  },
  'question-headings': {
    label: 'insufficient-n',
    effect: { d: -0.015, ci: [-0.031, 0], level: 95, n: 17 },
  },
  lists: { label: 'no-effect', effect: { d: -0.007, ci: [-0.027, 0.013], level: 90, n: 33 } },
  tables: { label: 'not-run', effect: null },
  statistics: {
    label: 'insufficient-n',
    effect: { d: 0.023, ci: [-0.02, 0.062], level: 95, n: 4 },
  },
  'expert-quotes': {
    label: 'insufficient-n',
    effect: { d: 0.029, ci: [-0.008, 0.075], level: 95, n: 26 },
  },
  'cited-sources': {
    label: 'insufficient-n',
    effect: { d: -0.013, ci: [-0.038, 0.009], level: 95, n: 25 },
  },
  'direct-answer-lead': {
    label: 'insufficient-n',
    effect: { d: 0.008, ci: [-0.016, 0.03], level: 95, n: 20 },
  },
  'question-coverage': {
    label: 'helps',
    effect: { d: 0.027, ci: [0.01, 0.043], level: 95, n: 54, holmP: 0.006 },
    replication: { d: 0.036, ci: [0.016, 0.059], level: 95, n: 52 },
  },
  comparisons: {
    label: 'insufficient-n',
    effect: { d: 0.004, ci: [-0.016, 0.027], level: 95, n: 8 },
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

/** A signed number to three decimals: +0.027, -0.015, +0.000. */
export const signed3 = (x: number): string => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(3)}`;

/** "d -0.015, 95% CI [-0.031, +0.000], n 17" (and ", Holm p 0.006" when given). */
export function formatE1Effect(e: E1Effect): string {
  const holm = e.holmP === undefined ? '' : `, Holm p ${e.holmP.toFixed(3)}`;
  return `d ${signed3(e.d)}, ${e.level}% CI [${signed3(e.ci[0])}, ${signed3(e.ci[1])}], n ${e.n}${holm}`;
}

/** "E1: <label> (d, CI)", or "E1: <label>" when the arm did not run. */
export function formatE1(result: E1Result): string {
  const label = `E1: ${E1_LABEL_TEXT[result.label]}`;
  return result.effect === null ? label : `${label} (${formatE1Effect(result.effect)})`;
}

/** The sentence an unscored note's suggestions carry. */
export function unscoredNote(result: E1Result): string {
  const numbers = result.effect === null ? '' : ` (${formatE1Effect(result.effect)})`;
  return `Not scored in Standard or By evidence: our own test (E1) found no effect larger than ${E1_DELTA}${numbers}.`;
}

/** The sentence a measured ("helps") check's suggestions carry. */
export function measuredNote(result: E1Result): string {
  const numbers = result.effect === null ? '' : `${formatE1Effect(result.effect)}; `;
  return `Measured in our own test (E1): ${E1_LABEL_TEXT[result.label]} (${numbers}${E1_MODELS}).`;
}
