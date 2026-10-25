import { CHECK_IDS } from '@citation-equity/engine';
import { describe, expect, it } from 'vitest';
import { CAVEAT, DEFAULT_SETTINGS, DRAFT_DOC_ID } from '../src/index';

describe('bench contracts', () => {
  it('carries the exact caveat sentence', () => {
    expect(CAVEAT).toBe(
      'Content check on a local model over a fixed page set. It does not predict live AI engines.',
    );
  });

  it('defaults to k=8, 8 runs, llama3.2:3b at temperature 0.5, base seed 1, a 16k window', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      k: 8,
      runs: 8,
      model: 'llama3.2:3b',
      temperature: 0.5,
      baseSeed: 1,
      numCtx: 16384,
    });
  });

  it('names the inserted draft document "draft"', () => {
    expect(DRAFT_DOC_ID).toBe('draft');
  });
});

describe('workspace source resolution', () => {
  it('imports @citation-equity/engine from source without a build', () => {
    expect(CHECK_IDS.length).toBe(11);
  });

  it('resolves the @citation-equity/bench/node subpath', async () => {
    const nodeEntry = await import('@citation-equity/bench/node');
    expect(nodeEntry).toBeTypeOf('object');
  });
});
