import { describe, expect, it } from 'vitest';
import { CAVEAT, DEFAULT_SETTINGS } from '../src/index';
import { competitorProfile, countStatistics, profileDocument } from '../src/profile';
import type { BenchReport, Pack, RunRecord } from '../src/types';

const KNOWN_DOC = `# Espresso guide

## Why is it bitter?

Over-extraction makes espresso bitter. About 30% of shots fail. See [the study](https://example.com/study).

- Grind finer
- Use 18 g of coffee

| Grind | Time |
|---|---|
| fine | 28 s |

Founded in 1998.

\`\`\`
42% inside code
\`\`\`
`;

describe('profileDocument', () => {
  it('counts words, headings, lists, tables, statistics and links on a known doc', () => {
    expect(profileDocument('a', KNOWN_DOC)).toEqual({
      docId: 'a',
      // 6 heading + 16 prose + 7 list + 5 table-cell words; the code block is not counted.
      words: 34,
      headings: 2,
      lists: 1,
      tables: 1,
      // "30%" and "18 g"; the bare year 1998, the table cell and the code block do not count.
      statistics: 2,
      links: 1,
    });
  });

  it('profiles an empty document as all zeros', () => {
    expect(profileDocument('e', '')).toEqual({
      docId: 'e',
      words: 0,
      headings: 0,
      lists: 0,
      tables: 0,
      statistics: 0,
      links: 0,
    });
  });
});

describe('countStatistics', () => {
  it('counts numbers with units, currency and percentages but not bare years', () => {
    expect(countStatistics('Founded in 1998.')).toBe(0);
    expect(countStatistics('Extraction takes 25 to 30 seconds and 18 g of coffee.')).toBe(3);
    expect(countStatistics('Prices rose 2.5% to $1,200 in 2024.')).toBe(2);
    expect(countStatistics('Use qwen2.5 or llama3.')).toBe(0);
  });
});

const doc = (docId: string, text: string) => ({ docId, title: '', text, synthetic: true });

const PACK: Pack = {
  schemaVersion: 1,
  packId: 'p',
  title: 'P',
  source: 'test',
  license: 'test',
  synthetic: true,
  queries: [
    {
      queryId: 'q1',
      query: 'why is espresso bitter',
      documents: [
        doc('a', 'One two three.'),
        doc('b', 'One two three four five.\n\n- x\n- y'),
        doc('c', 'Never cited at all.'),
      ],
    },
    {
      queryId: 'q2',
      query: 'how fine should I grind',
      documents: [
        doc('a', 'A different page with the same id.'),
        doc('d', 'Seven words in this page right here.'),
      ],
    },
  ],
};

function record(queryId: string, run: number, citedDocIds: string[]): RunRecord {
  return {
    queryId,
    run,
    seed: run,
    order: [],
    retrievedDocIds: [],
    draftRetrieved: true,
    answer: '',
    citedDocIds,
    draftCited: citedDocIds.includes('draft'),
    draftPawc: 0,
    validCitations: citedDocIds.length,
    formatFailure: citedDocIds.length === 0,
  };
}

function report(runs: RunRecord[], packId = 'p'): BenchReport {
  const rate = { k: 0, n: 0, p: 0, lo: 0, hi: 1 };
  return {
    schemaVersion: 2,
    packId,
    draftId: 'before',
    adapter: 'recorded',
    createdAt: '2026-10-23T00:00:00.000Z',
    settings: DEFAULT_SETTINGS,
    runs,
    summary: {
      retrieved: rate,
      validRuns: 0,
      formatFailures: rate,
      citedAmongValid: rate,
      pawcAmongValid: { mean: 0, interval: [0, 0] },
      chanceShare: 0,
      cited: rate,
      meanPawc: 0,
      pawcInterval: [0, 0],
    },
    caveat: CAVEAT,
  };
}

describe('competitorProfile', () => {
  const runs = [
    record('q1', 0, ['a', 'draft']),
    record('q1', 1, ['b', 'a']),
    record('q2', 0, []),
    record('q2', 1, ['d']),
  ];

  it('profiles each competitor cited at least once, per query, in first-cited order', () => {
    const { cited } = competitorProfile(report(runs), PACK);
    expect(cited.map((p) => [p.docId, p.words])).toEqual([
      ['a', 3],
      ['b', 7],
      ['d', 7],
    ]);
  });

  it('takes medians over the cited documents', () => {
    expect(competitorProfile(report(runs), PACK).medians).toEqual({
      words: 7,
      headings: 0,
      lists: 0,
      tables: 0,
      statistics: 0,
      links: 0,
    });
  });

  it('profiles the draft only when it is given', () => {
    expect(competitorProfile(report(runs), PACK).draft).toBeUndefined();
    const withDraft = competitorProfile(report(runs), PACK, {
      id: 'before',
      title: 'Draft',
      markdown: '## A heading\n\nTwo words.',
    });
    expect(withDraft.draft).toMatchObject({ docId: 'draft', headings: 1, words: 4 });
  });

  it('returns zero medians when no competitor was cited', () => {
    const none = competitorProfile(report([record('q1', 0, ['draft'])]), PACK);
    expect(none.cited).toEqual([]);
    expect(none.medians.words).toBe(0);
  });

  it('averages the two middle values for an even count', () => {
    const two = competitorProfile(report([record('q1', 0, ['a', 'b'])]), PACK);
    expect(two.medians.words).toBe(5);
  });

  it('refuses a report from another pack', () => {
    expect(() => competitorProfile(report(runs, 'other'), PACK)).toThrow(/pack/);
  });
});
