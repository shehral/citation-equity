import { describe, expect, it, vi } from 'vitest';
import {
  analyze,
  CHECK_IDS,
  type CheckId,
  PRESET_WEIGHTS,
  scoreChecks,
  type Weights,
} from '../src/index';

// Stand-in checks so the score wiring can be tested before the real checks land.
const { applicable } = vi.hoisted(() => ({
  applicable: (checkId: CheckId, score: number) => ({
    check: () => ({ checkId, applicable: true, score, findings: [], suggestions: [], metrics: {} }),
  }),
}));
vi.mock('../src/checks/lists', () => applicable('lists', 1));
vi.mock('../src/checks/tables', () => applicable('tables', 0));
// The real check applies to any prose paragraph; keep only the two stand-ins applicable.
vi.mock('../src/checks/standalone-paragraphs', async () => {
  const { notApplicable } = await import('../src/checks/types');
  return { check: () => notApplicable('standalone-paragraphs') };
});

const DRAFT = 'A short draft with some words in it.';

describe('analyze scores', () => {
  it('scores the foundation and evidence presets over applicable checks', () => {
    const result = analyze(DRAFT);
    expect(result.checks.filter((c) => c.applicable).map((c) => c.checkId)).toEqual([
      'lists',
      'tables',
    ]);
    expect(result.scores.foundation).toBe(50);
    expect(result.scores.evidence).toBe(scoreChecks(result.checks, PRESET_WEIGHTS.evidence));
    expect(result.scores.custom).toBeNull();
  });

  it('computes the custom score from the given weights', () => {
    const weights = Object.fromEntries(CHECK_IDS.map((id) => [id, 0])) as Weights;
    weights.lists = 3;
    weights.tables = 1;
    expect(analyze(DRAFT, { weights }).scores.custom).toBe(75);
  });

  it('does not run checks on an empty draft', () => {
    const result = analyze('  \n');
    expect(result.checks.every((c) => !c.applicable)).toBe(true);
    expect(result.scores.foundation).toBeNull();
  });
});
