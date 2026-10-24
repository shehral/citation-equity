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
  it('weights the six foundation-design checks at 1 and the four added checks at 0.5', () => {
    expect(PRESET_WEIGHTS.foundation).toEqual({
      'standalone-paragraphs': 1,
      'question-headings': 1,
      lists: 1,
      statistics: 1,
      tables: 1,
      'expert-quotes': 1,
      'cited-sources': 0.5,
      'direct-answer-lead': 0.5,
      'question-coverage': 0.5,
      comparisons: 0.5,
    });
    expect(PRESET_WEIGHTS.foundation.tables).toBe(1);
    expect(PRESET_WEIGHTS.foundation['cited-sources']).toBe(0.5);
  });

  it('derives the evidence preset from each check grade', () => {
    expect(GRADE_WEIGHTS).toEqual({ strong: 1, moderate: 0.7, mixed: 0.25, untested: 0.15 });
    for (const id of CHECK_IDS) {
      expect(PRESET_WEIGHTS.evidence[id]).toBe(GRADE_WEIGHTS[EVIDENCE[id].grade]);
    }
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
      expect(d.inFoundationDesign).toBe(PRESET_WEIGHTS.foundation[d.id] === 1);
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
