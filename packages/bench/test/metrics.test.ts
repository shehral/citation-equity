import { describe, expect, it } from 'vitest';
import {
  chanceLevel,
  meanInterval,
  minSignFlipP,
  pawcShares,
  signFlipP,
  t975,
  wilson,
} from '../src/metrics';
import { parseAnswer } from '../src/prompt';

describe('wilson', () => {
  it('wilson(0, 8) is p 0, lo 0, hi = z^2/(n+z^2)', () => {
    const r = wilson(0, 8);
    expect(r).toMatchObject({ k: 0, n: 8, p: 0, lo: 0 });
    expect(r.hi).toBeCloseTo(0.3244, 3);
  });

  it('wilson(8, 8) mirrors it', () => {
    const r = wilson(8, 8);
    expect(r.p).toBe(1);
    expect(r.hi).toBe(1);
    expect(r.lo).toBeCloseTo(0.6756, 3);
  });

  it('wilson(4, 8) is symmetric around one half', () => {
    const r = wilson(4, 8);
    expect(r.p).toBe(0.5);
    expect(r.lo + r.hi).toBeCloseTo(1, 12);
    expect(r.lo).toBeCloseTo(0.2152, 3);
  });

  it('a wider z gives a wider interval', () => {
    expect(wilson(3, 10, 2.576).hi).toBeGreaterThan(wilson(3, 10).hi);
  });

  it('reports the full [0, 1] range when there is no data', () => {
    expect(wilson(0, 0)).toEqual({ k: 0, n: 0, p: 0, lo: 0, hi: 1 });
  });
});

describe('pawcShares (port of impression_wordpos_count_simple)', () => {
  it('gives all credit to the only cited source', () => {
    const parsed = parseAnswer('Grind size matters a lot [1]. Water quality matters too [1].');
    expect(pawcShares(parsed, 2)).toEqual([1, 0]);
  });

  it('is all zeros when nothing is cited', () => {
    expect(pawcShares(parseAnswer('No sources here. None at all.'), 3)).toEqual([0, 0, 0]);
    expect(pawcShares(parseAnswer(''), 2)).toEqual([0, 0]);
  });

  it('matches the GEO formula on a hand-computed three-sentence answer', () => {
    // GEO: score(sentence i) = words(len > 2) * exp(-i / (N - 1)) / (#citations), N = 3.
    // s0 "Grind size controls extraction speed" -> 5 words, weight 1, cites [1]
    // s1 "Water temperature changes bitterness noticeably" -> 5 words, weight e^-0.5, cites [1][2]
    // s2 "Roast level matters too" -> 4 words, weight e^-1, cites [3]
    const parsed = parseAnswer(
      'Grind size controls extraction speed [1]. Water temperature changes bitterness noticeably [1][2]. Roast level matters too [3].',
    );
    const raw = [5 + (5 * Math.exp(-0.5)) / 2, (5 * Math.exp(-0.5)) / 2, 4 * Math.exp(-1), 0];
    const total = raw.reduce((a, b) => a + b, 0);
    const shares = pawcShares(parsed, 4);
    raw.forEach((x, i) => {
      expect(shares[i]).toBeCloseTo(x / total, 10);
    });
    expect(shares[0]).toBeCloseTo(0.685625, 5);
  });

  it('drops out-of-range citations but still splits the sentence score by them (as GEO does)', () => {
    // "Alpha beta gamma" = 3 words (all > 2 chars) split over [1] and the hallucinated [9].
    // s1 "Delta epsilon" = 2 words, weight e^-1, cites [2].
    const parsed = parseAnswer('Alpha beta gamma [1][9]. Delta epsilon [2].');
    const raw = [3 / 2, 2 * Math.exp(-1)];
    const total = raw[0] + raw[1];
    const shares = pawcShares(parsed, 2);
    expect(shares[0]).toBeCloseTo(raw[0] / total, 10);
    expect(shares[1]).toBeCloseTo(raw[1] / total, 10);
  });

  it('weights a single-sentence answer by 1 and ignores words of two letters or fewer', () => {
    const parsed = parseAnswer('It is an ok idea to go [1][2].');
    // only "idea" has more than two characters -> 1 word, split evenly
    expect(pawcShares(parsed, 2)).toEqual([0.5, 0.5]);
  });
});

describe('meanInterval', () => {
  it('is mean +/- t(0.975, n - 1) sd / sqrt(n), not 1.96, for few values', () => {
    const [lo, hi] = meanInterval([0.4, 0.5, 0.6]);
    const half = (4.3027 * 0.1) / Math.sqrt(3);
    expect(lo).toBeCloseTo(0.5 - half, 12);
    expect(hi).toBeCloseTo(0.5 + half, 12);
    // Four questions, as in the samples: t = 3.1824.
    const four = [0.1, 0.2, 0.3, 0.4];
    const sd = Math.sqrt(((0.15 ** 2 + 0.05 ** 2) * 2) / 3);
    expect(meanInterval(four)[1]).toBeCloseTo(0.25 + (3.1824 * sd) / 2, 12);
  });

  it('clips to [0, 1]', () => {
    expect(meanInterval([0, 0, 1])[0]).toBe(0);
    expect(meanInterval([1, 1, 0])[1]).toBe(1);
  });

  it('collapses to [m, m] below two values', () => {
    expect(meanInterval([0.3])).toEqual([0.3, 0.3]);
    expect(meanInterval([])).toEqual([0, 0]);
  });
});

describe('t975', () => {
  it('matches the t table for small df and tends to 1.96', () => {
    expect(t975(1)).toBe(12.7062);
    expect(t975(3)).toBe(3.1824);
    expect(t975(30)).toBe(2.0423);
    // Table values: t(0.975, 40) = 2.0211, t(0.975, 60) = 2.0003, t(0.975, 120) = 1.9799.
    expect(t975(40)).toBeCloseTo(2.0211, 3);
    expect(t975(60)).toBeCloseTo(2.0003, 3);
    expect(t975(120)).toBeCloseTo(1.9799, 3);
    expect(t975(100000)).toBeCloseTo(1.96, 3);
    expect(() => t975(0)).toThrow(RangeError);
  });
});

describe('minSignFlipP', () => {
  it('is 2 / 2^n, and 1 when no paired test is possible', () => {
    expect(minSignFlipP(4)).toBe(0.125);
    expect(minSignFlipP(8)).toBe(0.0078125);
    expect(minSignFlipP(1)).toBe(1);
    expect(minSignFlipP(0)).toBe(1);
    expect(signFlipP([1, 1, 1, 1])).toBe(minSignFlipP(4));
  });
});

describe('signFlipP', () => {
  it('is exact for small n: four equal positive diffs give 2/16', () => {
    expect(signFlipP([1, 1, 1, 1])).toBe(0.125);
  });

  it('is 1 when every diff is zero', () => {
    expect(signFlipP([0, 0, 0])).toBe(1);
    expect(signFlipP([])).toBe(1);
  });

  it('is two-sided', () => {
    expect(signFlipP([-1, -1, -1, -1])).toBe(0.125);
  });

  it('enumerates every sign pattern exactly at n = 12', () => {
    expect(signFlipP(Array(12).fill(0.1))).toBeCloseTo(2 / 4096, 12);
  });

  it('uses a seeded Monte Carlo above 12 values', () => {
    const diffs = Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? -0.05 : 0.1));
    const p = signFlipP(diffs, 5);
    expect(signFlipP(diffs, 5)).toBe(p);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.05);
    expect(signFlipP(Array(20).fill(0))).toBe(1);
  });
});

describe('chanceLevel', () => {
  it('names the even-split share as 1 in N sources', () => {
    expect(chanceLevel(0.125)).toBe('chance level: 1 in 8 sources');
    expect(chanceLevel(0.1875)).toBe('chance level: 1 in 5.3 sources');
  });

  it('says there is none when no answer was valid', () => {
    expect(chanceLevel(0)).toBe('chance level: none (no valid answer)');
  });
});
