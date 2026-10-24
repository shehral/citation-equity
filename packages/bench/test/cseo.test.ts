import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { validatePack } from '../src/index';
import { buildCseoPack, CSEO_ROWS_URL } from '../src/node/cseo';

interface Row {
  query_id: number;
  query: string;
  document: string;
}

const short = (s: string) => `${s} is a short page about the topic.`;

/** web: 2 special queries, then 40 filler queries of 3 docs (126+ rows, so more than one page). */
function webRows(): Row[] {
  const rows: Row[] = [
    // q0: one doc too long, one duplicate -> 2 docs survive.
    { query_id: 0, query: 'why is the sky blue', document: short('Sky one') },
    { query_id: 0, query: 'why is the sky blue', document: 'x'.repeat(500) },
    { query_id: 0, query: 'why is the sky blue', document: short('Sky two') },
    { query_id: 0, query: 'why is the sky blue', document: short('Sky one') },
    // q1: only one doc -> skipped.
    { query_id: 1, query: 'who wrote hamlet', document: short('Hamlet') },
    // q2: same question as q0 -> skipped as a duplicate.
    { query_id: 2, query: 'Why is the sky blue?', document: short('Dup one') },
    { query_id: 2, query: 'Why is the sky blue?', document: short('Dup two') },
  ];
  for (let q = 3; q < 43; q++) {
    for (let d = 0; d < 3; d++) {
      rows.push({
        query_id: q,
        query: `filler question ${q}`,
        document: short(`Filler ${q}.${d}`),
      });
    }
  }
  return rows;
}

const newsRows = (): Row[] => [
  { query_id: 0, query: 'what happened in the match', document: short('Match one') },
  { query_id: 0, query: 'what happened in the match', document: short('Match two') },
  { query_id: 5, query: 'what did the court decide', document: short('Court one') },
  { query_id: 5, query: 'what did the court decide', document: short('Court two') },
];

/** A fetch stand-in for the datasets-server /rows endpoint. */
function datasetServer(splits: Record<string, Row[]>) {
  const requested: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    const rows = splits[url.searchParams.get('split') ?? ''];
    if (!rows || url.searchParams.get('dataset') !== 'cseo/cseo-bench') {
      return new Response('{"error":"not found"}', { status: 404 });
    }
    const offset = Number(url.searchParams.get('offset'));
    const length = Number(url.searchParams.get('length'));
    const page = rows
      .slice(offset, offset + length)
      .map((row, i) => ({ row_idx: offset + i, row }));
    return Response.json({ rows: page, num_rows_total: rows.length, partial: false });
  }) as typeof fetch;
  return { fetchImpl, requested };
}

const dirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'ce-cseo-'));
  dirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe('buildCseoPack', () => {
  it('builds a valid pack from QA rows: short docs, no duplicates, quota split across domains', async () => {
    const { fetchImpl, requested } = datasetServer({ web: webRows(), news: newsRows() });
    const pack = await buildCseoPack({
      domains: ['web', 'news'],
      maxQueries: 5,
      maxDocChars: 200,
      cacheDir: await tempDir(),
      fetchImpl,
    });

    expect(validatePack(pack)).toEqual(pack);
    expect(pack).toMatchObject({ schemaVersion: 1, packId: 'cseo-web-news-5', synthetic: false });
    expect(pack.source).toContain('huggingface.co/datasets/cseo/cseo-bench');
    // web gets 3 of the 5 slots, news 2.
    expect(pack.queries.map((q) => q.queryId)).toEqual([
      'web-0',
      'web-3',
      'web-4',
      'news-0',
      'news-5',
    ]);
    expect(pack.queries[0].documents.map((d) => d.text)).toEqual([
      short('Sky one'),
      short('Sky two'),
    ]);
    const docIds = pack.queries.flatMap((q) => q.documents.map((d) => d.docId));
    expect(new Set(docIds).size).toBe(docIds.length);
    expect(pack.queries.flatMap((q) => q.documents).every((d) => d.synthetic === false)).toBe(true);
    expect(requested.every((u) => u.startsWith(CSEO_ROWS_URL))).toBe(true);
  });

  it('pages through a split until the quota is met', async () => {
    const { fetchImpl, requested } = datasetServer({ web: webRows() });
    const pack = await buildCseoPack({
      domains: ['web'],
      maxQueries: 38,
      maxDocChars: 200,
      cacheDir: await tempDir(),
      fetchImpl,
    });
    expect(pack.queries).toHaveLength(38);
    expect(requested.length).toBeGreaterThan(1);
  });

  it('reads pages from the cache on a second run', async () => {
    const cacheDir = await tempDir();
    const { fetchImpl } = datasetServer({ web: webRows(), news: newsRows() });
    const opts = { domains: ['web', 'news'] as const, maxQueries: 4, maxDocChars: 200, cacheDir };
    const first = await buildCseoPack({ ...opts, domains: [...opts.domains], fetchImpl });
    expect((await readdir(cacheDir)).length).toBeGreaterThan(0);

    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const second = await buildCseoPack({ ...opts, domains: [...opts.domains], fetchImpl: offline });
    expect(second).toEqual(first);
  });

  it('treats a truncated cache file as a miss and downloads that page again', async () => {
    const cacheDir = await tempDir();
    const { fetchImpl } = datasetServer({ web: webRows(), news: newsRows() });
    const opts = { domains: ['web', 'news'] as const, maxQueries: 4, maxDocChars: 200, cacheDir };
    const first = await buildCseoPack({ ...opts, domains: [...opts.domains], fetchImpl });
    const [name] = await readdir(cacheDir);
    const file = join(cacheDir, name);
    const whole = await readFile(file, 'utf8');
    await writeFile(file, whole.slice(0, Math.floor(whole.length / 2)));

    const again = await buildCseoPack({ ...opts, domains: [...opts.domains], fetchImpl });
    expect(again).toEqual(first);
    expect(await readFile(file, 'utf8')).toBe(whole);
  });

  it('rejects a bad maxQueries and an HTTP error from the dataset server', async () => {
    const { fetchImpl } = datasetServer({});
    const base = { domains: ['web' as const], maxDocChars: 200, fetchImpl };
    await expect(
      buildCseoPack({ ...base, maxQueries: 0, cacheDir: await tempDir() }),
    ).rejects.toThrow(RangeError);
    await expect(
      buildCseoPack({ ...base, maxQueries: 2, cacheDir: await tempDir() }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
