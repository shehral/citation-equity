import { describe, expect, it } from 'vitest';
import { RecordedAdapter, RecordingAdapter, recordingKey } from '../src/adapters/recorded';
import { CAVEAT, caveatFor, isLocalUrl, REMOTE_CAVEAT } from '../src/caveat';
import { compareReports, runBench } from '../src/run';
import type { BenchDraft, BenchReport, EngineAdapter, GenerateOptions, Pack } from '../src/types';
import { DEFAULT_SETTINGS, DRAFT_DOC_ID } from '../src/types';

const pack: Pack = {
  schemaVersion: 1,
  packId: 'coffee',
  title: 'Coffee test pack',
  source: 'unit test',
  license: 'MIT (written for this project)',
  synthetic: true,
  queries: [
    {
      queryId: 'q-crema',
      query: 'how does espresso crema form',
      documents: [
        {
          docId: 'c1',
          title: 'Crema',
          text: 'Crema forms when espresso oils emulsify.',
          synthetic: true,
        },
        {
          docId: 'c2',
          title: 'Pressure',
          text: 'Espresso machines brew at nine bar.',
          synthetic: true,
        },
        { docId: 'c3', title: 'Beans', text: 'Fresh beans hold carbon dioxide.', synthetic: true },
      ],
    },
    {
      queryId: 'q-grind',
      query: 'what grind size suits espresso',
      documents: [
        { docId: 'g1', title: 'Grind', text: 'A fine grind suits espresso.', synthetic: true },
        {
          docId: 'g2',
          title: 'Burrs',
          text: 'Burr grinders give an even grind size.',
          synthetic: true,
        },
        {
          docId: 'g3',
          title: 'Coarse',
          text: 'Coarse grounds suit a French press.',
          synthetic: true,
        },
      ],
    },
  ],
};

const unrelated: BenchDraft = {
  id: 'unrelated',
  title: 'Gardening notes',
  markdown: 'Tomatoes need full sun and steady watering.',
};
const onTopic: BenchDraft = {
  id: 'on-topic',
  title: 'Espresso guide',
  markdown:
    'How does espresso crema form? From emulsified oils. What grind size suits espresso? A fine grind.',
};

/** Always cites source 1, and records every call. */
class CiteFirst implements EngineAdapter {
  readonly name = 'cite-first';
  readonly calls: { prompt: string; opts: GenerateOptions }[] = [];
  async generate(prompt: string, opts: GenerateOptions): Promise<string> {
    this.calls.push({ prompt, opts });
    return 'The answer is grounded in the first source [1].';
  }
}

async function recordedCiteFirst(draft: BenchDraft, settings = { runs: 2 }) {
  const recorder = new RecordingAdapter(new CiteFirst());
  await runBench(pack, draft, recorder, settings);
  return new RecordedAdapter(recorder.recording);
}

describe('runBench', () => {
  it('runs every query `runs` times with seeds baseSeed + 1000*query + run', async () => {
    const adapter = await recordedCiteFirst(unrelated);
    const report = await runBench(pack, unrelated, adapter, { runs: 2 });
    expect(report.runs).toHaveLength(4);
    expect(report.runs.map((r) => r.seed)).toEqual([1, 2, 1001, 1002]);
    expect(report.runs.map((r) => [r.queryId, r.run])).toEqual([
      ['q-crema', 0],
      ['q-crema', 1],
      ['q-grind', 0],
      ['q-grind', 1],
    ]);
    expect(report.caveat).toBe(CAVEAT);
    expect(report).toMatchObject({
      schemaVersion: 2,
      packId: 'coffee',
      draftId: 'unrelated',
      adapter: 'recorded',
      settings: { ...DEFAULT_SETTINGS, runs: 2 },
    });
  });

  it('a draft that is never retrieved is never cited and has zero PAWC', async () => {
    const adapter = await recordedCiteFirst(unrelated);
    const report = await runBench(pack, unrelated, adapter, { runs: 2 });
    expect(report.runs.every((r) => !r.draftRetrieved && !r.draftCited)).toBe(true);
    expect(report.runs.every((r) => r.draftPawc === 0)).toBe(true);
    expect(report.summary.retrieved).toMatchObject({ k: 0, n: 4 });
    expect(report.summary.cited.k).toBe(0);
    expect(report.summary.citedAmongValid).toMatchObject({ k: 0, n: 4 });
    expect(report.summary.pawcAmongValid).toEqual({ mean: 0, interval: [0, 0] });
    expect(report.summary.meanPawc).toBe(0);
    expect(report.summary.pawcInterval).toEqual([0, 0]);
    // the cited doc is whichever pack doc the shuffle put first
    expect(report.runs.every((r) => r.citedDocIds.length === 1)).toBe(true);
    expect(report.runs.every((r) => r.citedDocIds[0] === r.order[0])).toBe(true);
  });

  it('a draft that is the only retrieved source takes every citation', async () => {
    const adapter = new CiteFirst();
    const report = await runBench(pack, onTopic, adapter, { runs: 2, k: 1 });
    expect(report.runs.every((r) => r.order.length === 1 && r.order[0] === DRAFT_DOC_ID)).toBe(
      true,
    );
    expect(report.summary.retrieved).toMatchObject({ k: 4, n: 4, p: 1 });
    expect(report.summary.cited).toMatchObject({ k: 4, n: 4 });
    expect(report.summary.citedAmongValid).toMatchObject({ k: 4, n: 4 });
    expect(report.summary.pawcAmongValid).toEqual({ mean: 1, interval: [1, 1] });
    expect(report.summary.chanceShare).toBe(1);
    expect(report.summary.meanPawc).toBe(1);
    expect(report.summary.pawcInterval).toEqual([1, 1]);
  });

  it('passes model, seed, temperature and numCtx to the adapter and prompts with the shuffled order', async () => {
    const adapter = new CiteFirst();
    const report = await runBench(pack, onTopic, adapter, {
      runs: 2,
      model: 'llama3.2:3b',
      temperature: 0.2,
      baseSeed: 10,
      numCtx: 8192,
    });
    expect(adapter.calls.map((c) => c.opts)).toEqual([
      { model: 'llama3.2:3b', seed: 10, temperature: 0.2, numCtx: 8192 },
      { model: 'llama3.2:3b', seed: 11, temperature: 0.2, numCtx: 8192 },
      { model: 'llama3.2:3b', seed: 1010, temperature: 0.2, numCtx: 8192 },
      { model: 'llama3.2:3b', seed: 1011, temperature: 0.2, numCtx: 8192 },
    ]);
    const first = report.runs[0];
    expect([...first.order].sort()).toEqual([...first.retrievedDocIds].sort());
    expect(first.draftRetrieved).toBe(true);
    const draftPos = first.order.indexOf(DRAFT_DOC_ID) + 1;
    expect(adapter.calls[0].prompt).toContain(`[${draftPos}]`);
    expect(adapter.calls[0].prompt).toContain(onTopic.markdown);
  });

  it('ignores out-of-range citation numbers', async () => {
    const adapter: EngineAdapter = {
      name: 'wild',
      generate: async () => 'Made up [7]. Also zero [0].',
    };
    const report = await runBench(pack, onTopic, adapter, { runs: 1 });
    expect(report.runs.every((r) => r.citedDocIds.length === 0)).toBe(true);
    expect(report.summary.cited.k).toBe(0);
    // Only out-of-range numbers: no valid citation, so each answer is a format failure.
    expect(report.runs.every((r) => r.validCitations === 0 && r.formatFailure)).toBe(true);
  });

  it('marks an answer with no [n] as a format failure and leaves it out of citedAmongValid', async () => {
    // Odd seeds answer without any citation; even seeds cite source 1 twice and source 2 once.
    const adapter: EngineAdapter = {
      name: 'half',
      generate: async (_prompt, opts) =>
        opts.seed % 2 === 1 ? 'No citation in this answer.' : 'One [1][2]. Two [1]. Three [9].',
    };
    const report = await runBench(pack, onTopic, adapter, { runs: 2, k: 3 });
    const failed = report.runs.filter((r) => r.seed % 2 === 1);
    const valid = report.runs.filter((r) => r.seed % 2 === 0);
    expect(failed.map((r) => [r.formatFailure, r.validCitations])).toEqual([
      [true, 0],
      [true, 0],
    ]);
    // [9] is out of range for 3 sources, so it does not count.
    expect(valid.map((r) => [r.formatFailure, r.validCitations])).toEqual([
      [false, 3],
      [false, 3],
    ]);
    expect(report.summary.validRuns).toBe(2);
    expect(report.summary.formatFailures).toMatchObject({ k: 2, n: 4, p: 0.5 });
    expect(report.summary.citedAmongValid.n).toBe(2);
    expect(report.summary.citedAmongValid.k).toBe(valid.filter((r) => r.draftCited).length);
    // `cited` stays over all runs, the failures counting as not cited.
    expect(report.summary.cited.n).toBe(4);
  });

  it('sets chanceShare to the mean of 1 / sources over valid runs (sizes 4 and 8 give 0.1875)', async () => {
    const page = (docId: string, text: string) => ({ docId, title: docId, text, synthetic: true });
    const sized: Pack = {
      ...pack,
      queries: [
        {
          queryId: 'four',
          query: 'espresso crema',
          documents: ['a', 'b', 'c'].map((id) => page(id, `Espresso crema note ${id}.`)),
        },
        {
          queryId: 'eight',
          query: 'espresso grind',
          documents: ['d', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) =>
            page(id, `Espresso grind note ${id}.`),
          ),
        },
        {
          // A format failure here (one source) must not pull the chance level up.
          queryId: 'failed',
          query: 'espresso tamping',
          documents: [page('t', 'Espresso tamping note.')],
        },
      ],
    };
    const draft: BenchDraft = { id: 'd', title: 'Espresso', markdown: 'Espresso crema and grind.' };
    const adapter: EngineAdapter = {
      name: 'cite',
      generate: async (prompt) => (prompt.includes('tamping') ? 'No citation.' : 'Yes [1].'),
    };
    const report = await runBench(sized, draft, adapter, { runs: 1, k: 8 });
    expect(report.runs.map((r) => r.retrievedDocIds.length)).toEqual([4, 8, 2]);
    expect(report.summary.validRuns).toBe(2);
    expect(report.summary.chanceShare).toBeCloseTo(0.1875, 12);
  });

  it('reports progress and takes createdAt from the injected clock', async () => {
    const progress: [number, number][] = [];
    const report = await runBench(
      pack,
      unrelated,
      new CiteFirst(),
      { runs: 2 },
      (done, total) => progress.push([done, total]),
      () => '2026-10-23T00:00:00.000Z',
    );
    expect(progress).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
    expect(report.createdAt).toBe('2026-10-23T00:00:00.000Z');
  });

  it('stamps createdAt with the current time by default', async () => {
    const report = await runBench(pack, unrelated, new CiteFirst(), { runs: 1 });
    expect(Number.isNaN(Date.parse(report.createdAt))).toBe(false);
  });

  it('rejects settings that cannot produce a run', async () => {
    await expect(runBench(pack, unrelated, new CiteFirst(), { runs: 0 })).rejects.toThrow(
      /^runs must/,
    );
    await expect(runBench(pack, unrelated, new CiteFirst(), { k: 1.5 })).rejects.toThrow(/^k must/);
  });

  it('rejects a bad baseSeed, temperature or model', async () => {
    const run = (settings: Record<string, unknown>) =>
      runBench(pack, unrelated, new CiteFirst(), settings as never);
    await expect(run({ baseSeed: Number.NaN })).rejects.toThrow(/^baseSeed must/);
    await expect(run({ baseSeed: 1.5 })).rejects.toThrow(/^baseSeed must/);
    await expect(run({ temperature: Number.NaN })).rejects.toThrow(/^temperature must/);
    await expect(run({ temperature: -0.1 })).rejects.toThrow(/^temperature must/);
    await expect(run({ temperature: '0.5' })).rejects.toThrow(/^temperature must/);
    await expect(run({ model: '' })).rejects.toThrow(/^model must/);
    await expect(run({ model: 42 })).rejects.toThrow(/^model must/);
  });

  it('treats explicitly undefined settings as omitted, keeping the defaults', async () => {
    const seen: GenerateOptions[] = [];
    const adapter: EngineAdapter = {
      name: 'spy',
      async generate(_prompt, opts) {
        seen.push(opts);
        return 'An answer [1].';
      },
    };
    const report = await runBench(pack, unrelated, adapter, {
      model: undefined,
      baseSeed: undefined,
      temperature: undefined,
      runs: undefined,
      k: undefined,
    });
    expect(report.settings).toEqual(DEFAULT_SETTINGS);
    expect(seen.length).toBe(pack.queries.length * DEFAULT_SETTINGS.runs);
    for (const opts of seen) {
      expect(opts.model).toBe(DEFAULT_SETTINGS.model);
      expect(opts.temperature).toBe(DEFAULT_SETTINGS.temperature);
      expect(Number.isInteger(opts.seed)).toBe(true);
    }
    expect(report.runs[0].seed).toBe(DEFAULT_SETTINGS.baseSeed);
    expect(JSON.parse(JSON.stringify(report)).settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('RecordedAdapter', () => {
  it('rejects a miss with a message naming the key', async () => {
    const adapter = new RecordedAdapter({});
    const opts = { model: 'qwen2.5:3b', seed: 3, temperature: 0.5 };
    const key = recordingKey('some prompt', opts);
    await expect(adapter.generate('some prompt', opts)).rejects.toThrow(
      `No recorded answer for key ${key}`,
    );
  });

  it('replays exactly what the RecordingAdapter saw', async () => {
    const recorder = new RecordingAdapter(new CiteFirst());
    const live = await runBench(pack, onTopic, recorder, { runs: 2 });
    expect(recorder.name).toBe('cite-first');
    expect(Object.keys(recorder.recording)).toHaveLength(4);
    const replay = await runBench(pack, onTopic, new RecordedAdapter(recorder.recording, 'demo'), {
      runs: 2,
    });
    expect(replay.adapter).toBe('demo');
    expect(replay.runs).toEqual(live.runs);
  });
});

describe('runBench with a reasoning model', () => {
  it('scores the answer after a <think> trace, not the citations inside the trace', async () => {
    const thinker: EngineAdapter = {
      name: 'thinker',
      generate: async () => '<think>Maybe [1] or [2] or [3].</think>\nNo citation here.',
    };
    const report = await runBench(pack, onTopic, thinker, { runs: 1 });
    expect(report.runs.every((r) => r.formatFailure && r.validCitations === 0)).toBe(true);
    expect(report.runs.every((r) => !r.draftCited && r.draftPawc === 0)).toBe(true);
    // The stored answer keeps the model's full text.
    expect(report.runs[0].answer).toContain('<think>');
  });
});

describe('recordingKey', () => {
  const opts = { model: 'qwen2.5:3b', seed: 1, temperature: 0.5 };
  it('is a stable 8-hex-digit FNV-1a hash', () => {
    expect(recordingKey('p', opts)).toMatch(/^[0-9a-f]{8}$/);
    expect(recordingKey('p', opts)).toBe(recordingKey('p', { ...opts }));
  });

  it('changes with model, seed, temperature and prompt', () => {
    const base = recordingKey('p', opts);
    expect(recordingKey('q', opts)).not.toBe(base);
    expect(recordingKey('p', { ...opts, model: 'llama3.2:3b' })).not.toBe(base);
    expect(recordingKey('p', { ...opts, seed: 2 })).not.toBe(base);
    expect(recordingKey('p', { ...opts, temperature: 0.7 })).not.toBe(base);
  });

  it('includes a context window other than the default, and leaves default-window keys unchanged', () => {
    const base = recordingKey('p', opts);
    expect(recordingKey('p', { ...opts, numCtx: 16384 })).toBe(base);
    expect(recordingKey('p', { ...opts, numCtx: 8192 })).not.toBe(base);
    expect(recordingKey('p', { ...opts, numCtx: 8192 })).not.toBe(
      recordingKey('p', { ...opts, numCtx: 4096 }),
    );
  });
});

describe('bench caveat', () => {
  it('calls a server local only when it is this machine', () => {
    for (const url of [
      'http://127.0.0.1:11434',
      'http://localhost:8000/v1',
      'http://[::1]:8000',
      'localhost:11434',
      'http://box.localhost',
      'http://127.1.2.3',
    ]) {
      expect(isLocalUrl(url), url).toBe(true);
      expect(caveatFor(url)).toBe(CAVEAT);
    }
    for (const url of [
      'https://api.openai.com',
      'http://192.168.1.20:8000',
      'http://localhost.example.com',
      'https://ollama.com',
      'not a url',
    ]) {
      expect(isLocalUrl(url), url).toBe(false);
      expect(caveatFor(url)).toBe(REMOTE_CAVEAT);
    }
  });

  it("carries the adapter's caveat, and records numCtx null for an adapter that cannot send it", async () => {
    const seen: GenerateOptions[] = [];
    const hosted: EngineAdapter = {
      name: 'hosted',
      caveat: REMOTE_CAVEAT,
      sendsNumCtx: false,
      generate: async (_p, o) => {
        seen.push(o);
        return 'Cited [1].';
      },
    };
    const before = await runBench(pack, unrelated, hosted, { runs: 1, numCtx: 8192 });
    expect(before.caveat).toBe(REMOTE_CAVEAT);
    expect(before.settings.numCtx).toBeNull();
    expect(seen.every((o) => o.numCtx === undefined)).toBe(true);
    // Two such reports still pair, and a report's settings can be fed back in for a replay.
    const after = await runBench(pack, onTopic, hosted, before.settings);
    expect(after.settings.numCtx).toBeNull();
    expect(compareReports(before, after).caveat).toBe(REMOTE_CAVEAT);
    // Reports whose caveats differ: the comparison carries the one that claims less.
    expect(compareReports(before, { ...after, caveat: CAVEAT }).caveat).toBe(REMOTE_CAVEAT);
    // A hosted report does not pair with a local one: their context windows differ.
    const local = await runBench(pack, onTopic, new CiteFirst(), { runs: 1 });
    expect(local.caveat).toBe(CAVEAT);
    expect(() => compareReports(before, local)).toThrow(/settings: numCtx/);
  });

  it('RecordingAdapter keeps the inner caveat and numCtx capability; RecordedAdapter takes one', async () => {
    const inner: EngineAdapter = {
      name: 'inner',
      caveat: REMOTE_CAVEAT,
      sendsNumCtx: false,
      generate: async () => 'Cited [1].',
    };
    const recorder = new RecordingAdapter(inner);
    expect(recorder.caveat).toBe(REMOTE_CAVEAT);
    expect(recorder.sendsNumCtx).toBe(false);
    const report = await runBench(pack, unrelated, recorder, { runs: 1 });
    expect(report.caveat).toBe(REMOTE_CAVEAT);
    expect(new RecordedAdapter(recorder.recording).caveat).toBeUndefined();
    const replay = await runBench(
      pack,
      unrelated,
      new RecordedAdapter(recorder.recording, 'r', { caveat: REMOTE_CAVEAT }),
      { runs: 1 },
    );
    expect(replay.caveat).toBe(REMOTE_CAVEAT);
    expect(replay.runs).toEqual(report.runs);
  });
});

describe('compareReports', () => {
  it('pairs before and after on identical seeds and reports deltas', async () => {
    const adapter = new CiteFirst();
    const before = await runBench(pack, unrelated, adapter, { runs: 2, k: 1 });
    const after = await runBench(pack, onTopic, adapter, { runs: 2, k: 1 });
    expect(after.runs.map((r) => r.seed)).toEqual(before.runs.map((r) => r.seed));
    const cmp = compareReports(before, after);
    expect(cmp).toMatchObject({
      schemaVersion: 2,
      packId: 'coffee',
      beforeId: 'unrelated',
      afterId: 'on-topic',
      nQueries: 2,
      excludedQueries: [],
      caveat: CAVEAT,
    });
    expect(cmp.delta).toEqual({
      retrieved: 1,
      citedAmongValid: 1,
      pawcAmongValid: 1,
      formatFailures: 0,
    });
    // two queries, both +1: exact sign-flip p = 2/4
    expect(cmp.pValue).toEqual({ citedAmongValid: 0.5, pawcAmongValid: 0.5 });
  });

  it('pairs valid runs only and drops a query with no valid run on one side', async () => {
    const before = await runBench(pack, onTopic, new CiteFirst(), { runs: 2, k: 1 });
    // The after run fails the format on every q-grind answer, and on one of the two q-crema runs.
    const flaky: EngineAdapter = {
      name: 'flaky',
      generate: async (_prompt, opts) =>
        opts.seed >= 1000 || opts.seed === 2 ? 'No citation.' : 'Cited [1].',
    };
    const after = await runBench(pack, onTopic, flaky, { runs: 2, k: 1 });
    const cmp = compareReports(before, after);
    expect(cmp.nQueries).toBe(1);
    expect(cmp.excludedQueries).toEqual(['q-grind']);
    expect(cmp.delta.formatFailures).toBeCloseTo(0.75, 12);
    // Among valid answers the draft (the only source) is always cited, before and after.
    expect(cmp.delta.citedAmongValid).toBe(0);
    expect(cmp.pValue).toEqual({ citedAmongValid: 1, pawcAmongValid: 1 });
  });

  it('refuses schemaVersion 1 reports with a message that says to re-run', async () => {
    const report = await runBench(pack, onTopic, new CiteFirst(), { runs: 1 });
    const old = { ...report, schemaVersion: 1 } as unknown as BenchReport;
    expect(() => compareReports(old, old)).toThrow(
      'Cannot compare schemaVersion 1 reports: they predate the format-failure split. Re-run the bench to get schemaVersion 2 reports.',
    );
    expect(() => compareReports(report, old)).toThrow(/schemaVersion 1/);
  });

  it('throws on mismatched packIds', async () => {
    const before = await runBench(pack, unrelated, new CiteFirst(), { runs: 1 });
    const after = { ...before, packId: 'other' };
    expect(() => compareReports(before, after)).toThrow(/packId/);
  });

  it('throws on mismatched settings or query ids', async () => {
    const before = await runBench(pack, unrelated, new CiteFirst(), { runs: 1 });
    const other = await runBench(pack, unrelated, new CiteFirst(), { runs: 1, baseSeed: 2 });
    expect(() => compareReports(before, other)).toThrow(/settings/);
    const fewer = { ...before, runs: before.runs.filter((r) => r.queryId === 'q-crema') };
    expect(() => compareReports(before, fewer)).toThrow(/quer/);
  });
});
