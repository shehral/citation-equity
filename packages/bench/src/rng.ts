/**
 * Seeded randomness for the bench, so a run is reproducible from its seed.
 * mulberry32 is Tommy Ettinger's public-domain 32-bit generator, written here from its description.
 */

/** A generator of floats in [0, 1) fully determined by `seed` (taken as a 32-bit integer). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle into a new array; the same `seed` always gives the same order. */
export function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
