// collectPrompts pairs the i-th generate call with the i-th run of the report. This file replaces
// runBench with one that breaks that pairing, to check that the export refuses instead of
// writing prompts under the wrong query and seed.
import { describe, expect, it, vi } from 'vitest';
import type { BenchReport, Pack } from '../src/types';

vi.mock('../src/run', () => ({
  runBench: async (
    _pack: Pack,
    _draft: unknown,
    adapter: { generate: (p: string, o: object) => Promise<string> },
  ) => {
    await adapter.generate('only prompt', { model: 'm', seed: 1, temperature: 0 });
    const run = { queryId: 'q1', run: 0 };
    return {
      runs: [run, { ...run, run: 1 }],
      settings: { numCtx: 16384 },
    } as unknown as BenchReport;
  },
}));

const { collectPrompts } = await import('../src/node/batch');

describe('collectPrompts alignment', () => {
  it('throws when runBench records a different number of runs than it made calls', async () => {
    const pack = { packId: 'p', queries: [] } as unknown as Pack;
    await expect(collectPrompts(pack, { id: 'd', title: 't', markdown: '' })).rejects.toThrow(
      'collectPrompts: 1 generate calls for 2 runs; the export would be misaligned',
    );
  });
});
