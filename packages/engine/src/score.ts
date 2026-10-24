import type { CheckResult, Weights } from './types';

/**
 * Weighted mean of the applicable checks' scores on a 0 to 100 integer scale:
 * `round(100 * Σ w·s / Σ w)`. Null when no check applies or the weights of the
 * applicable checks sum to 0.
 */
export function scoreChecks(results: CheckResult[], weights: Weights): number | null {
  let weighted = 0;
  let total = 0;
  for (const r of results) {
    if (!r.applicable) continue;
    const w = weights[r.checkId] ?? 0;
    weighted += w * r.score;
    total += w;
  }
  return total === 0 ? null : Math.round((100 * weighted) / total);
}
