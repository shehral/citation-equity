import { describe, expect, it } from 'vitest';
import { LOSES_AT_SHARE, losesAtText, stageFunnel } from '../src/index';

type Run = { draftRetrieved: boolean; draftCited: boolean; formatFailure: boolean };
const run = (found: boolean, cited: boolean, failure = false): Run => ({
  draftRetrieved: found,
  draftCited: cited,
  formatFailure: failure,
});
const times = (n: number, r: Run) => Array.from({ length: n }, () => r);

describe('stageFunnel', () => {
  it('splits cited into found x cited when found, exactly', () => {
    const runs = [
      ...times(2, run(true, true)),
      ...times(2, run(true, false)),
      ...times(4, run(false, false)),
    ];
    const f = stageFunnel({ runs });
    expect(f.validRuns).toBe(8);
    expect(f.found).toMatchObject({ k: 4, n: 8, p: 0.5 });
    expect(f.citedWhenFound).toMatchObject({ k: 2, n: 4, p: 0.5 });
    expect(f.cited).toMatchObject({ k: 2, n: 8, p: 0.25 });
    expect(f.found.p * f.citedWhenFound.p).toBeCloseTo(f.cited.p, 12);
    // Equal losses at each step.
    expect(f.share?.search).toBeCloseTo(0.5, 12);
    expect(f.losesAt).toBe('both');
  });

  it('leaves format failures out of every rate', () => {
    const runs = [run(true, true), run(true, false), ...times(6, run(true, false, true))];
    const f = stageFunnel({ runs });
    expect(f.validRuns).toBe(2);
    expect(f.found).toMatchObject({ k: 2, n: 2 });
    expect(f.citedWhenFound).toMatchObject({ k: 1, n: 2 });
  });

  it('says the draft loses at search when that step holds most of the loss', () => {
    // Found in 1 of 8, cited every time it was found: all the loss is at search.
    const all = stageFunnel({ runs: [run(true, true), ...times(7, run(false, false))] });
    expect(all.share).toEqual({ search: 1, citation: 0 });
    expect(all.losesAt).toBe('search');
    // Found in 4 of 16 (loss 1.39), cited in 3 of 4 when found (loss 0.29): 83% at search.
    const most = stageFunnel({
      runs: [...times(3, run(true, true)), run(true, false), ...times(12, run(false, false))],
    });
    expect(most.share?.search).toBeGreaterThan(LOSES_AT_SHARE);
    expect(most.losesAt).toBe('search');
  });

  it('says the draft loses at the answer when it is found but passed over', () => {
    const f = stageFunnel({
      runs: [...times(7, run(true, false)), run(true, true), run(false, false)],
    });
    expect(f.share?.citation).toBeGreaterThan(LOSES_AT_SHARE);
    expect(f.losesAt).toBe('citation');
  });

  it('handles the edges: never found, never cited, never lost, no valid run', () => {
    expect(stageFunnel({ runs: times(4, run(false, false)) })).toMatchObject({
      losesAt: 'search',
      share: null,
    });
    const neverCited = stageFunnel({ runs: times(4, run(true, false)) });
    expect(neverCited).toMatchObject({ losesAt: 'citation', share: null });
    expect(neverCited.citedWhenFound).toMatchObject({ k: 0, n: 4 });
    expect(stageFunnel({ runs: times(4, run(true, true)) })).toMatchObject({
      losesAt: 'neither',
      share: null,
    });
    const none = stageFunnel({ runs: times(3, run(true, true, true)) });
    expect(none).toMatchObject({ losesAt: 'unknown', share: null, validRuns: 0 });
    expect(stageFunnel({ runs: [] }).losesAt).toBe('unknown');
  });

  it('has one plain sentence for every outcome', () => {
    for (const at of ['search', 'citation', 'both', 'neither', 'unknown'] as const) {
      expect(losesAtText(at)).toMatch(/^[A-Z].+\.$/);
    }
  });
});
