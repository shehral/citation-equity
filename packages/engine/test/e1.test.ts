import { describe, expect, it } from 'vitest';
import {
  CHECK_IDS,
  type CheckId,
  E1_COMBINED,
  E1_DELTA,
  E1_LABEL_TEXT,
  E1_MODELS,
  type E1Effect,
  type E1Label,
  EVIDENCE,
  formatE1,
  formatE1Effect,
  OWN_TEST_RESULTS,
  type OwnTest,
  unscoredNote,
} from '../src/index';

// Each check's outcome in our own test, copied here by hand so a change to the registry has to be
// made on purpose. E1's main set, primary contrast (experiments/RESULTS_E1.md), except the seven
// checks E3 asked again with more pages: for those the pooled E3 result
// (experiments/RESULTS_E3.md, 90% CI from experiments/results/e3/analysis_e3.json for a "no
// effect" verdict) replaces E1's, by E1's rule table.
const EXPECTED: Record<
  CheckId,
  { test: OwnTest; label: E1Label; effect: E1Effect | null; replication?: E1Effect }
> = {
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
  },
  comparisons: {
    test: 'E3',
    label: 'insufficient-n',
    effect: { d: 0.003, ci: [-0.02, 0.026], level: 95, n: 24 },
  },
  // Arm 12 (query wording), the candidate check that helped; its replication had too few pages.
  'reader-words': {
    test: 'E1',
    label: 'helps',
    effect: { d: 0.035, ci: [0.008, 0.066], level: 95, n: 33, holmP: 0.037 },
  },
};

describe('E1 labels in the evidence registry', () => {
  it('gives each check its E1 label and numbers, as the results file states them', () => {
    for (const id of CHECK_IDS) {
      const { e1 } = EVIDENCE[id];
      expect(e1.test, id).toBe(EXPECTED[id].test);
      expect(e1.label, id).toBe(EXPECTED[id].label);
      expect(e1.effect, id).toEqual(EXPECTED[id].effect);
      expect(e1.replication, id).toEqual(EXPECTED[id].replication);
    }
  });

  it('keeps the evidence grades as they were', () => {
    expect(CHECK_IDS.map((id) => EVIDENCE[id].grade)).toEqual([
      'untested',
      'mixed',
      'mixed',
      'mixed',
      'untested',
      'mixed',
      'mixed',
      'mixed',
      'mixed',
      'mixed',
      'mixed',
    ]);
  });

  it('words each label as the results file does', () => {
    expect(E1_LABEL_TEXT).toEqual({
      helps: 'helps, possibly through length or query-term overlap',
      'no-effect': 'no effect larger than 0.03',
      'insufficient-n': 'insufficient n',
      inconclusive: 'inconclusive',
      'not-run': 'not run (no valid edit)',
      descriptive: 'descriptive, no verdict by design',
    });
    expect(E1_DELTA).toBe(0.03);
    expect(E1_MODELS).toBe('Gemma-4-12B and Qwen3.8-27B judges, Gemma-edited');
  });

  it('formats "<test>: <label> (d, CI)" for each check', () => {
    expect(formatE1(EVIDENCE['question-headings'].e1)).toBe(
      'E3: no effect larger than 0.03 (d -0.016, 90% CI [-0.028, -0.004], n 57, Holm p 0.164)',
    );
    expect(formatE1(EVIDENCE['expert-quotes'].e1)).toBe(
      'E3: inconclusive (d +0.026, 95% CI [+0.001, +0.053], n 62, Holm p 0.179)',
    );
    expect(formatE1(EVIDENCE['direct-answer-lead'].e1)).toBe(
      'E3: no effect larger than 0.03 (d +0.012, 90% CI [+0.002, +0.022], n 66, Holm p 0.179)',
    );
    expect(formatE1(EVIDENCE.comparisons.e1)).toBe(
      'E3: insufficient n (d +0.003, 95% CI [-0.020, +0.026], n 24)',
    );
    expect(formatE1(EVIDENCE.lists.e1)).toBe(
      'E1: no effect larger than 0.03 (d -0.007, 90% CI [-0.027, +0.013], n 33)',
    );
    expect(formatE1(EVIDENCE.tables.e1)).toBe(
      'E3: insufficient n (d -0.027, 95% CI [-0.054, -0.001], n 11)',
    );
    expect(formatE1(EVIDENCE['question-coverage'].e1)).toBe(
      'E1: helps, possibly through length or query-term overlap (d +0.027, 95% CI [+0.010, +0.043], n 54, Holm p 0.006)',
    );
    expect(formatE1(EVIDENCE['standalone-paragraphs'].e1)).toBe(
      'E1: descriptive, no verdict by design (d +0.007, 95% CI [-0.008, +0.023], n 24)',
    );
    const rep = EVIDENCE['question-coverage'].e1.replication;
    expect(rep && formatE1Effect(rep)).toBe('d +0.036, 95% CI [+0.016, +0.059], n 52');
  });

  it('adds what the follow-up test (E2) found, with its numbers, where it ran', () => {
    expect(EVIDENCE['reader-words'].e1.followUp).toBe(
      'Follow-up test (E2): with a different editor (Qwen3.8-27B) and judges (Gemma-4-12B and Qwen3.5-9B), the gain kept its sign (d +0.029, 95% CI [+0.003, +0.061], n 29).',
    );
    expect(EVIDENCE['question-coverage'].e1.followUp).toBe(
      "Follow-up test (E2): the heading form adds nothing (a question heading against the same words as plain text: d +0.003 main, -0.001 replication, no effect larger than 0.03), and the question's words carry the gain (against a same-size heading without them: d +0.048 replication, helps; +0.017 main, inconclusive). Plain text with the question's words beat the untouched page by +0.023 (main) and +0.037 (replication), reported without a verdict.",
    );
    const withFollowUp = CHECK_IDS.filter((id) => EVIDENCE[id].e1.followUp !== undefined);
    expect(withFollowUp).toEqual(['question-coverage', 'reader-words']);
  });

  it('links each test to its results file', () => {
    expect(OWN_TEST_RESULTS).toEqual({
      E1: 'experiments/RESULTS_E1.md',
      E3: 'experiments/RESULTS_E3.md',
    });
  });

  it('says why an unscored note is not scored, with the test that found it', () => {
    expect(unscoredNote(EVIDENCE['question-headings'].e1)).toBe(
      'Not scored in Standard or By evidence: our own test (E3) found no effect larger than 0.03 (d -0.016, 90% CI [-0.028, -0.004], n 57, Holm p 0.164).',
    );
    expect(unscoredNote(EVIDENCE.lists.e1)).toBe(
      'Not scored in Standard or By evidence: our own test (E1) found no effect larger than 0.03 (d -0.007, 90% CI [-0.027, +0.013], n 33).',
    );
  });

  it('records the combined result of applying every fix together', () => {
    expect(E1_COMBINED).toEqual({
      vsOriginal: { d: 0.049, ci: [0.024, 0.076], level: 95, n: 78 },
      vsPlacebo: { d: 0.071, ci: [0.039, 0.109], level: 95, n: 53 },
    });
  });
});
