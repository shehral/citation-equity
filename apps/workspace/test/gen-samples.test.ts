// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateSamples } from '../scripts/gen-samples.mjs';

interface GeneratedSample {
  slug: string;
  results?: Record<string, { runs?: Record<string, unknown>[]; summary?: unknown }>;
}

describe('gen-samples', () => {
  const samples = generateSamples() as GeneratedSample[];

  it('ships no recording and no answer text to the browser', () => {
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(Object.keys(sample.results ?? {}), sample.slug).not.toContain('recording');
      for (const [name, result] of Object.entries(sample.results ?? {})) {
        for (const run of result.runs ?? []) {
          expect(Object.hasOwn(run, 'answer'), `${sample.slug}/${name}`).toBe(false);
        }
      }
    }
  });

  it('keeps the reports the bench panel renders: summaries, cited pages, comparison', () => {
    for (const sample of samples) {
      const results = sample.results ?? {};
      expect(Object.keys(results).sort(), sample.slug).toEqual(['after', 'before', 'comparison']);
      for (const name of ['before', 'after']) {
        expect(results[name]?.summary, `${sample.slug}/${name}`).toBeTypeOf('object');
        const runs = results[name]?.runs ?? [];
        expect(runs.length).toBeGreaterThan(0);
        expect(runs.every((r) => Array.isArray(r.citedDocIds))).toBe(true);
      }
    }
  });
});
