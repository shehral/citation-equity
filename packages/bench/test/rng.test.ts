import { describe, expect, it } from 'vitest';
import { mulberry32, shuffle } from '../src/rng';

describe('mulberry32', () => {
  it('is deterministic per seed and yields values in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 100 }, () => a());
    expect(Array.from({ length: 100 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBe(100);
  });

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('shuffle', () => {
  const xs = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('returns a permutation and leaves the input untouched', () => {
    const out = shuffle(xs, 7);
    expect([...out].sort()).toEqual(xs);
    expect(xs).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('gives the same order for the same seed and varies across seeds', () => {
    expect(shuffle(xs, 7)).toEqual(shuffle(xs, 7));
    const orders = new Set(Array.from({ length: 20 }, (_, s) => shuffle(xs, s).join('')));
    expect(orders.size).toBeGreaterThan(10);
  });
});
