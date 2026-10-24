// Fixture bench results for the panel tests, shaped like packages/bench/src/types.ts
// (schemaVersion 2), so the panel tests do not depend on the recorded samples.
import { type BenchReport, CAVEAT, type Comparison, type Pack, wilson } from '@citation-equity/bench';
import type { Sample } from '@/lib/samples';

export const BEFORE_MD = '# Espresso\n\n## Why espresso turns bitter\n\nBitter shots run long.\n';
export const AFTER_MD =
  '# Espresso\n\n## Why does espresso turn bitter?\n\nA shot that runs past 35 seconds tastes bitter.\n';

export const PACK: Pack = {
  schemaVersion: 1,
  packId: 'fixture-pack',
  title: 'Fixture pack',
  source: 'Citation Equity sample pack',
  license: 'MIT (written for this project)',
  synthetic: true,
  queries: [
    {
      queryId: 'q1',
      query: 'Why is my espresso bitter?',
      documents: [
        {
          docId: 'd1',
          title: 'Bitter espresso',
          text: '## Why is it bitter?\n\nOver-extraction: 40 seconds is too long.\n\n- Grind coarser\n- Use 93 C water\n- Weigh 18 g\n',
          synthetic: true,
        },
        {
          docId: 'd2',
          title: 'Thin page',
          text: 'Espresso can be bitter.',
          synthetic: true,
        },
      ],
    },
    {
      queryId: 'q2',
      query: 'How long should an espresso shot take?',
      documents: [
        {
          docId: 'd3',
          title: 'Shot timing',
          text: 'A shot takes 25 to 30 seconds for 36 g out.\n\n| Dose | Time |\n| --- | --- |\n| 18 g | 28 s |\n',
          synthetic: true,
        },
      ],
    },
  ],
};

const SETTINGS = {
  k: 5,
  runs: 2,
  model: 'qwen2.5:3b',
  temperature: 0.5,
  baseSeed: 1,
  numCtx: 16384,
};

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Four runs (q1 twice, q2 twice). `cited[i]` says whether run i cited the draft; a run listed in
 * `failures` answered with no valid citation at all (a format failure).
 */
function report(
  draftId: string,
  cited: boolean[],
  failures: number[],
  pawcAmongValid: BenchReport['summary']['pawcAmongValid'],
): BenchReport {
  const keys = [
    ['q1', 0, 1],
    ['q1', 1, 2],
    ['q2', 0, 1001],
    ['q2', 1, 1002],
  ] as const;
  const runs = keys.map(([queryId, run, seed], i) => {
    const failed = failures.includes(i);
    const citedDocIds = failed ? [] : cited[i] ? ['draft'] : [queryId === 'q1' ? 'd1' : 'd3'];
    return {
      queryId,
      run,
      seed,
      order: queryId === 'q1' ? ['draft', 'd1', 'd2'] : ['d3', 'draft'],
      retrievedDocIds: queryId === 'q1' ? ['d1', 'd2', 'draft'] : ['d3', 'draft'],
      draftRetrieved: true,
      answer: failed ? 'An answer with no citation.' : 'An answer [1].',
      citedDocIds,
      draftCited: citedDocIds.includes('draft'),
      draftPawc: citedDocIds.includes('draft') ? 0.5 : 0,
      validCitations: failed ? 0 : 1,
      formatFailure: failed,
    };
  });
  const valid = runs.filter((r) => !r.formatFailure);
  return {
    schemaVersion: 2,
    packId: PACK.packId,
    draftId,
    adapter: 'ollama',
    createdAt: '2026-10-23T18:30:00.000Z',
    settings: SETTINGS,
    runs,
    summary: {
      retrieved: wilson(4, 4),
      validRuns: valid.length,
      formatFailures: wilson(4 - valid.length, 4),
      citedAmongValid: wilson(valid.filter((r) => r.draftCited).length, valid.length),
      pawcAmongValid,
      chanceShare: mean(valid.map((r) => 1 / r.retrievedDocIds.length)),
      cited: wilson(runs.filter((r) => r.draftCited).length, 4),
      meanPawc: 0,
      pawcInterval: [0, 0],
    },
    caveat: CAVEAT,
  };
}

/**
 * Before: run 3 is a format failure, so 3 valid answers, 1 of them citing the draft (33%);
 * chance level (1/3 + 1/3 + 1/2) / 3 = 0.389, "1 in 2.6 sources". After: 4 valid, 3 cite (75%);
 * chance level (1/3 + 1/3 + 1/2 + 1/2) / 4 = 0.417, "1 in 2.4 sources".
 */
export const BEFORE_REPORT = report('before', [true, false, false, false], [3], {
  mean: 0.125,
  interval: [0, 0.37],
});
export const AFTER_REPORT = report('after', [true, true, true, false], [], {
  mean: 0.375,
  interval: [0.12, 0.63],
});

export const COMPARISON: Comparison = {
  schemaVersion: 2,
  packId: PACK.packId,
  beforeId: 'before',
  afterId: 'after',
  delta: { retrieved: 0, citedAmongValid: 0.75 - 1 / 3, pawcAmongValid: 0.25, formatFailures: -0.25 },
  pValue: { citedAmongValid: 0.5, pawcAmongValid: 0.5 },
  nQueries: 2,
  excludedQueries: [],
  caveat: CAVEAT,
};

/** A sample with its pack and recorded results, as gen-samples.mjs writes it. */
export const RECORDED_SAMPLE: Sample = {
  slug: 'fixture',
  title: 'Fixture draft',
  topic: 'coffee',
  packId: PACK.packId,
  before: BEFORE_MD,
  after: AFTER_MD,
  pack: PACK,
  results: { before: BEFORE_REPORT, after: AFTER_REPORT, comparison: COMPARISON },
};
