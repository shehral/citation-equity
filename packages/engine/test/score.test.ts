import { describe, expect, it } from 'vitest';
import {
  CHECK_DEFINITIONS,
  CHECK_IDS,
  type CheckId,
  type CheckResult,
  EVIDENCE,
  GRADE_WEIGHTS,
  PRESET_WEIGHTS,
  scoreChecks,
  UNSCORED_CHECKS,
  type Weights,
} from '../src/index';

const result = (checkId: CheckId, score: number, applicable = true): CheckResult => ({
  checkId,
  score,
  applicable,
  findings: [],
  suggestions: [],
  metrics: {},
});

const weights = (overrides: Partial<Weights>): Weights => ({
  ...(Object.fromEntries(CHECK_IDS.map((id) => [id, 0])) as Weights),
  ...overrides,
});

describe('scoreChecks', () => {
  it('takes the weighted mean of applicable checks on a 0 to 100 scale', () => {
    const w = weights({ lists: 1, tables: 1 });
    expect(scoreChecks([result('lists', 1), result('tables', 0)], w)).toBe(50);
    expect(
      scoreChecks([result('lists', 1), result('tables', 0)], weights({ lists: 3, tables: 1 })),
    ).toBe(75);
  });

  it('rounds to an integer', () => {
    const w = weights({ lists: 1, tables: 1, statistics: 1 });
    const results = [result('lists', 1), result('tables', 0), result('statistics', 0)];
    expect(scoreChecks(results, w)).toBe(33);
  });

  it('ignores non-applicable checks', () => {
    const w = weights({ lists: 1, tables: 1 });
    expect(scoreChecks([result('lists', 0.8), result('tables', 0, false)], w)).toBe(80);
  });

  it('returns null when nothing is applicable or the weights sum to zero', () => {
    const w = weights({ lists: 1, tables: 1 });
    expect(scoreChecks([result('lists', 1, false), result('tables', 1, false)], w)).toBeNull();
    expect(scoreChecks([], w)).toBeNull();
    expect(scoreChecks([result('statistics', 1)], w)).toBeNull();
  });
});

describe('presets and registry', () => {
  it('weights the foundation-design checks at 1, the added checks at 0.5, unscored notes at 0', () => {
    expect(PRESET_WEIGHTS.foundation).toEqual({
      'standalone-paragraphs': 1,
      'question-headings': 0,
      lists: 0,
      statistics: 1,
      tables: 1,
      'expert-quotes': 1,
      'cited-sources': 0,
      'direct-answer-lead': 0,
      'question-coverage': 0.5,
      comparisons: 0.5,
      'reader-words': 0.5,
    });
    expect(PRESET_WEIGHTS.foundation.tables).toBe(1);
    expect(PRESET_WEIGHTS.foundation.comparisons).toBe(0.5);
  });

  it('derives the evidence preset from each check grade, unscored checks at 0', () => {
    expect(GRADE_WEIGHTS).toEqual({ strong: 1, moderate: 0.7, mixed: 0.25, untested: 0.15 });
    for (const id of CHECK_IDS) {
      const expected = UNSCORED_CHECKS.includes(id) ? 0 : GRADE_WEIGHTS[EVIDENCE[id].grade];
      expect(PRESET_WEIGHTS.evidence[id], id).toBe(expected);
    }
  });

  it('makes every check our own tests found no effect larger than δ for an unscored note: weight 0 in both presets', () => {
    const unscored = ['question-headings', 'lists', 'cited-sources', 'direct-answer-lead'];
    expect(UNSCORED_CHECKS).toEqual(unscored);
    for (const id of unscored as CheckId[]) {
      expect(EVIDENCE[id].e1.label, id).toBe('no-effect');
      expect(PRESET_WEIGHTS.foundation[id], id).toBe(0);
      expect(PRESET_WEIGHTS.evidence[id], id).toBe(0);
    }
    for (const d of CHECK_DEFINITIONS) expect(d.scored, d.id).toBe(!unscored.includes(d.id));
  });

  it('keeps the evidence grade and weight of a check E3 left inconclusive or short of pages', () => {
    for (const id of ['tables', 'statistics', 'expert-quotes', 'comparisons'] as CheckId[]) {
      expect(EVIDENCE[id].e1.test, id).toBe('E3');
      expect(PRESET_WEIGHTS.foundation[id], id).toBeGreaterThan(0);
      expect(PRESET_WEIGHTS.evidence[id], id).toBe(GRADE_WEIGHTS[EVIDENCE[id].grade]);
    }
  });

  it('counts an unscored note once a custom weight includes it', () => {
    for (const id of ['question-headings', 'cited-sources', 'direct-answer-lead'] as CheckId[]) {
      expect(
        scoreChecks([result(id, 1), result('tables', 0)], weights({ [id]: 1, tables: 1 })),
        id,
      ).toBe(50);
    }
  });

  it('leaves an unscored check out of each preset score, renormalizing over the other weights', () => {
    const others = [result('tables', 1), result('statistics', 0.5), result('comparisons', 0)];
    for (const preset of ['foundation', 'evidence'] as const) {
      const w = PRESET_WEIGHTS[preset];
      const without = scoreChecks(others, w);
      expect(scoreChecks([...others, result('lists', 0)], w), preset).toBe(without);
      expect(scoreChecks([...others, result('lists', 1)], w), preset).toBe(without);
    }
    // Only lists applies: no weight left, so no score (as for any all-zero weighting).
    expect(scoreChecks([result('lists', 1)], PRESET_WEIGHTS.foundation)).toBeNull();
    // A custom weight on lists still counts it.
    expect(
      scoreChecks([result('lists', 1), result('tables', 0)], weights({ lists: 1, tables: 1 })),
    ).toBe(50);
  });

  it('defines every check in CHECK_IDS order with complete metadata', () => {
    expect(CHECK_DEFINITIONS.map((d) => d.id)).toEqual([...CHECK_IDS]);
    for (const d of CHECK_DEFINITIONS) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(20);
      expect(d.description).not.toMatch(/—/);
      expect(['structure', 'data-density', 'clarity', 'sourcing']).toContain(d.category);
      expect(d.evidence).toBe(EVIDENCE[d.id]);
      expect(d.defaultWeights).toEqual({
        foundation: PRESET_WEIGHTS.foundation[d.id],
        evidence: PRESET_WEIGHTS.evidence[d.id],
      });
      if (d.scored) expect(d.inFoundationDesign).toBe(PRESET_WEIGHTS.foundation[d.id] === 1);
    }
    expect(CHECK_DEFINITIONS.filter((d) => d.inFoundationDesign).map((d) => d.id)).toEqual([
      'standalone-paragraphs',
      'question-headings',
      'lists',
      'statistics',
      'tables',
      'expert-quotes',
    ]);
  });
});
