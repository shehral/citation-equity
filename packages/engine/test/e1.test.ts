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
} from '../src/index';

// E1's per-check outcome (main set, primary contrast), from experiments/RESULTS_E1.md. Copied
// here by hand so a change to the registry has to be made on purpose.
const EXPECTED: Record<
  CheckId,
  { label: E1Label; effect: E1Effect | null; replication?: E1Effect }
> = {
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

describe('E1 labels in the evidence registry', () => {
  it('gives each check its E1 label and numbers, as the results file states them', () => {
    for (const id of CHECK_IDS) {
      const { e1 } = EVIDENCE[id];
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
    ]);
  });

  it('words each label as the results file does', () => {
    expect(E1_LABEL_TEXT).toEqual({
      helps: 'helps, possibly through length or query-term overlap',
      'no-effect': 'no effect larger than 0.03',
      'insufficient-n': 'insufficient n',
      'not-run': 'not run (no valid edit)',
      descriptive: 'descriptive, no verdict by design',
    });
    expect(E1_DELTA).toBe(0.03);
    expect(E1_MODELS).toBe('Gemma-4-12B and Qwen3.8-27B judges, Gemma-edited');
  });

  it('formats "E1: <label> (d, CI)" for each check', () => {
    expect(formatE1(EVIDENCE['question-headings'].e1)).toBe(
      'E1: insufficient n (d -0.015, 95% CI [-0.031, +0.000], n 17)',
    );
    expect(formatE1(EVIDENCE.lists.e1)).toBe(
      'E1: no effect larger than 0.03 (d -0.007, 90% CI [-0.027, +0.013], n 33)',
    );
    expect(formatE1(EVIDENCE.tables.e1)).toBe('E1: not run (no valid edit)');
    expect(formatE1(EVIDENCE['question-coverage'].e1)).toBe(
      'E1: helps, possibly through length or query-term overlap (d +0.027, 95% CI [+0.010, +0.043], n 54, Holm p 0.006)',
    );
    expect(formatE1(EVIDENCE['standalone-paragraphs'].e1)).toBe(
      'E1: descriptive, no verdict by design (d +0.007, 95% CI [-0.008, +0.023], n 24)',
    );
    const rep = EVIDENCE['question-coverage'].e1.replication;
    expect(rep && formatE1Effect(rep)).toBe('d +0.036, 95% CI [+0.016, +0.059], n 52');
  });

  it('records the combined result of applying every fix together', () => {
    expect(E1_COMBINED).toEqual({
      vsOriginal: { d: 0.049, ci: [0.024, 0.076], level: 95, n: 78 },
      vsPlacebo: { d: 0.071, ci: [0.039, 0.109], level: 95, n: 53 },
    });
  });
});
