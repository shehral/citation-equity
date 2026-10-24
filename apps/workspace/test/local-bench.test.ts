import {
  CAVEAT,
  DEFAULT_SETTINGS,
  type EngineAdapter,
  type Pack,
  REMOTE_CAVEAT,
} from '@citation-equity/bench';
import { describe, expect, it } from 'vitest';
import { runLocalBench } from '@/lib/bench';

const pack: Pack = {
  schemaVersion: 1,
  packId: 'tiny',
  title: 'Tiny',
  source: 'test',
  license: 'CC0',
  synthetic: true,
  queries: [
    {
      queryId: 'q1',
      query: 'Why does espresso taste bitter?',
      documents: [
        {
          docId: 'd1',
          title: 'Other',
          text: 'Espresso tastes bitter when over-extracted.',
          synthetic: true,
        },
      ],
    },
  ],
};
const draft = (id: string) => ({
  id,
  title: id,
  markdown: '# Espresso\n\nBitter espresso is over-extracted espresso.\n',
});

async function run(adapter: EngineAdapter) {
  return runLocalBench({
    pack,
    before: draft('before'),
    current: draft('current'),
    adapter,
    settings: { ...DEFAULT_SETTINGS, runs: 1 },
    signal: new AbortController().signal,
    onProgress: () => {},
  });
}

describe('runLocalBench', () => {
  it("carries the adapter's own caveat and context-window capability into the reports", async () => {
    const calls: { numCtx?: number }[] = [];
    const remote: EngineAdapter = {
      name: 'remote',
      caveat: REMOTE_CAVEAT,
      sendsNumCtx: false,
      generate: async (_prompt, opts) => {
        calls.push(opts);
        return 'Espresso turns bitter when over-extracted [1].';
      },
    };
    const { before, current, comparison } = await run(remote);
    expect(before.caveat).toBe(REMOTE_CAVEAT);
    expect(current.caveat).toBe(REMOTE_CAVEAT);
    expect(comparison.caveat).toBe(REMOTE_CAVEAT);
    expect(before.settings.numCtx).toBeNull();
    expect(calls.every((o) => o.numCtx === undefined)).toBe(true);
  });

  it('keeps the local caveat and the context window for a local adapter', async () => {
    const local: EngineAdapter = {
      name: 'local',
      generate: async () => 'Espresso turns bitter when over-extracted [1].',
    };
    const { before } = await run(local);
    expect(before.caveat).toBe(CAVEAT);
    expect(before.settings.numCtx).toBe(DEFAULT_SETTINGS.numCtx);
  });
});
