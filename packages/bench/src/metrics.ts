// pawcShares is adapted from GEO-optim/GEO (https://github.com/GEO-optim/GEO), commit
// c9e985f2bc4b539a01e8e9d226ff2a3d8d29a888, licensed Apache-2.0: `impression_wordpos_count_simple`
// and `get_num_words` in src/utils.py.
// Changes: TypeScript port; words are counted with a regex tokenizer instead of nltk.word_tokenize,
// after removing citation markers; citations outside 1..n (GEO's "hallucinated" ones, including [0],
// which GEO's Python indexing would credit to the last source) are dropped; an answer with no valid
// citation scores all zeros (GEO returns 1/n for every source).
// wilson, t975, meanInterval, minSignFlipP, signFlipP and chanceLevel are written for this project.
import { type ParsedAnswer, stripCitations } from './prompt';
import { mulberry32 } from './rng';
import type { Rate } from './types';

/** Wilson score interval for k successes in n trials; z defaults to the 95% normal quantile. */
export function wilson(k: number, n: number, z = 1.959964): Rate {
  if (n === 0) return { k, n, p: 0, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  // The bounds at k = 0 and k = n are exactly 0 and 1; set them so float error cannot move them.
  const lo = k === 0 ? 0 : clip01(center - half);
  const hi = k === n ? 1 : clip01(center + half);
  return { k, n, p, lo, hi };
}

/** Tokens longer than two characters, as GEO's `get_num_words` counts them (citation markers removed). */
function geoWordCount(sentence: string): number {
  const tokens = stripCitations(sentence).match(/[\p{L}\p{N}]+(?:[-'’.][\p{L}\p{N}]+)*/gu);
  return (tokens ?? []).filter((t) => t.length > 2).length;
}

/**
 * Position-adjusted word count per source (GEO's impression_wordpos_count_simple), normalized to
 * sum to 1. Sentence i of N earns words * exp(-i / (N - 1)) (weight 1 when N = 1), split evenly over
 * the sentence's citations. All zeros when nothing in range is cited.
 */
export function pawcShares(parsed: ParsedAnswer, nSources: number): number[] {
  const scores = new Array<number>(nSources).fill(0);
  const n = parsed.sentences.length;
  parsed.sentences.forEach((sentence, i) => {
    if (sentence.citations.length === 0) return;
    const weight = n > 1 ? Math.exp(-i / (n - 1)) : 1;
    const score = (geoWordCount(sentence.text) * weight) / sentence.citations.length;
    for (const cit of sentence.citations) {
      if (Number.isInteger(cit) && cit >= 1 && cit <= nSources) scores[cit - 1] += score;
    }
  });
  const total = scores.reduce((a, b) => a + b, 0);
  return total > 0 ? scores.map((s) => s / total) : scores;
}

/** Two-sided 95% quantiles of Student's t, t(0.975, df), for df 1..30 (standard tables). */
const T975 = [
  12.7062, 4.3027, 3.1824, 2.7764, 2.5706, 2.4469, 2.3646, 2.306, 2.2622, 2.2281, 2.201, 2.1788,
  2.1604, 2.1448, 2.1314, 2.1199, 2.1098, 2.1009, 2.093, 2.086, 2.0796, 2.0739, 2.0687, 2.0639,
  2.0595, 2.0555, 2.0518, 2.0484, 2.0452, 2.0423,
];

/**
 * t(0.975, df): the table for df <= 30, then the Cornish-Fisher expansion around the normal
 * quantile (error under 0.0005 there), which tends to 1.96 as df grows.
 */
export function t975(df: number): number {
  if (!Number.isInteger(df) || df < 1) throw new RangeError('df must be an integer >= 1');
  if (df <= T975.length) return T975[df - 1];
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
}

/**
 * 95% interval for the mean of `xs`: mean +/- t(0.975, n - 1) * sample sd / sqrt(n), clipped to
 * [0, 1]. The t quantile, not 1.96, because the bench averages over few queries (4 in the samples,
 * where t is 3.18). With fewer than two values there is no interval: [m, m] ([0, 0] when empty),
 * which the CLI prints as "no interval".
 */
export function meanInterval(xs: number[]): [number, number] {
  const n = xs.length;
  if (n === 0) return [0, 0];
  const m = mean(xs);
  if (n < 2) return [m, m];
  const sd = Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (n - 1));
  const half = (t975(n - 1) * sd) / Math.sqrt(n);
  return [clip01(m - half), clip01(m + half)];
}

/**
 * The smallest p the exact two-sided sign-flip test can give over n paired values: 2 / 2^n
 * (every sign the same), and 1 when n < 2, where no paired test is possible.
 */
export function minSignFlipP(n: number): number {
  return n < 2 ? 1 : 2 / 2 ** n;
}

/**
 * "chance level: 1 in N sources" for a report's chanceShare: the share each source would get if the
 * answer split its credit evenly. N is 1 / chanceShare, to one decimal place when it is not whole.
 * It is the draft's even-split share only in runs where the draft was retrieved; pawcAmongValid
 * counts the other valid runs as 0, so read it next to the retrieved rate.
 */
export function chanceLevel(chanceShare: number): string {
  if (!(chanceShare > 0)) return 'chance level: none (no valid answer)';
  const n = Math.round(10 / chanceShare) / 10;
  return `chance level: 1 in ${Number.isInteger(n) ? n : n.toFixed(1)} sources`;
}

const EXACT_MAX_N = 12;
const MONTE_CARLO_DRAWS = 10_000;

/**
 * Two-sided paired sign-flip (permutation) test of mean(diffs) = 0. Statistic |sum(diffs)|.
 * Exact over all 2^n sign patterns when n <= 12; otherwise 10 000 seeded random patterns with the
 * (hits + 1) / (draws + 1) correction, so the estimate is never 0.
 */
export function signFlipP(diffs: number[], seed = 1): number {
  const n = diffs.length;
  const observed = Math.abs(diffs.reduce((a, b) => a + b, 0));
  // Float slack so ties with the observed statistic count as "at least as extreme".
  const tol =
    1e-9 *
    Math.max(
      1,
      diffs.reduce((a, b) => a + Math.abs(b), 0),
    );
  const extreme = (signs: (i: number) => boolean) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += signs(i) ? -diffs[i] : diffs[i];
    return Math.abs(s) >= observed - tol;
  };
  if (n <= EXACT_MAX_N) {
    const patterns = 2 ** n;
    let hits = 0;
    for (let mask = 0; mask < patterns; mask++) {
      if (extreme((i) => ((mask >>> i) & 1) === 1)) hits++;
    }
    return hits / patterns;
  }
  const rand = mulberry32(seed);
  let hits = 0;
  for (let draw = 0; draw < MONTE_CARLO_DRAWS; draw++) {
    const flips = Array.from({ length: n }, () => rand() < 0.5);
    if (extreme((i) => flips[i])) hits++;
  }
  return (hits + 1) / (MONTE_CARLO_DRAWS + 1);
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function clip01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
