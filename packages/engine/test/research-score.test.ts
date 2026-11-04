import { describe, expect, it, vi } from 'vitest';
import {
  analyze,
  CHECK_IDS,
  type CheckId,
  PRESET_WEIGHTS,
  scoreChecks,
  type Weights,
} from '../src/index';

// The research path: `scoreChecks` over the checks `analyze` returns, with a preset or custom
// weights. `analyze` itself reports no total; the app and the CLI never show one.

// Stand-in checks, so the weighting is checked on known check scores.
const { applicable } = vi.hoisted(() => ({
  applicable: (checkId: CheckId, score: number) => ({
    check: () => ({ checkId, applicable: true, score, findings: [], suggestions: [], metrics: {} }),
  }),
}));
vi.mock('../src/checks/lists', () => applicable('lists', 1));
vi.mock('../src/checks/tables', () => applicable('tables', 0));
// The real check applies to any prose paragraph; keep it out so the stand-ins carry the totals.
vi.mock('../src/checks/standalone-paragraphs', async () => {
  const { notApplicable } = await import('../src/checks/types');
  return { check: () => notApplicable('standalone-paragraphs') };
});
// reader-words applies whenever the page has a topic question; keep it out too. Its measure stays
// real: the question report reads it.
vi.mock(import('../src/checks/reader-words'), async (importOriginal) => {
  const { notApplicable } = await import('../src/checks/types');
  return { ...(await importOriginal()), check: () => notApplicable('reader-words') };
});

const DRAFT = 'A short draft with some words in it.';

describe('research score over analyze', () => {
  it('weights the applicable checks under the foundation and evidence presets', () => {
    const { checks, questions } = analyze(DRAFT);
    // With no questions given, question-coverage measures the page's own topic question, which
    // the draft's one sentence answers.
    expect(questions.rows.map((r) => [r.question, r.answer.covered])).toContainEqual([
      'What is a short draft?',
      true,
    ]);
    expect(checks.filter((c) => c.applicable).map((c) => [c.checkId, c.score])).toEqual([
      ['lists', 1],
      ['tables', 0],
      ['question-coverage', 1],
    ]);
    // Lists is weight 0 in both presets. Foundation: tables 1 at 0, question-coverage 0.5 at 1,
    // so 100 x 0.5 / 1.5. Evidence: tables (untested) 0.15 at 0, question-coverage (mixed) 0.25
    // at 1, so 100 x 0.25 / 0.4.
    expect(scoreChecks(checks, PRESET_WEIGHTS.foundation)).toBe(33);
    expect(scoreChecks(checks, PRESET_WEIGHTS.evidence)).toBe(63);
  });

  it('weights the checks by custom weights', () => {
    const weights = Object.fromEntries(CHECK_IDS.map((id) => [id, 0])) as Weights;
    weights.lists = 3;
    weights.tables = 1;
    expect(scoreChecks(analyze(DRAFT).checks, weights)).toBe(75);
  });

  it('has no score for an empty draft, where no check runs', () => {
    const { checks } = analyze('  \n');
    expect(checks.every((c) => !c.applicable)).toBe(true);
    expect(scoreChecks(checks, PRESET_WEIGHTS.foundation)).toBeNull();
    expect(scoreChecks(checks, PRESET_WEIGHTS.evidence)).toBeNull();
  });
});
