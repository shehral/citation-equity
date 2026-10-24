// E1 main set: GEO-bench rows and their source pages (experiments/PREREG_E1.md, Data 1-3 and 8).
//
// Rows come from the Hugging Face datasets-server API (GEO-Optim/geo-bench), cached under
// .cache/geobench, in dataset order: test, then val, then train. Kept queries (keepQuery) get each
// of their URLs fetched live through the bench's packFromUrls (robots.txt respected, Defuddle to
// Markdown). `--source wayback` instead fetches the 2023 Wayback snapshot (web/2023id_/<url>)
// through the same code path, for the pages normalize.py lists in wayback_needed.jsonl.
// Raw records are appended to data/raw/<source>.jsonl; a rerun skips pages already fetched, so a
// long fetch can resume. Nothing here is committed (experiments/e1/data/ is gitignored).
// Rows are normalized once by readGeoRow; a row without usable sources is skipped and counted as
// bad_row in the final log line. The val and train splits (config `train`) carry neither tags nor
// sources, so all their rows are bad rows and only `test` yields kept queries.
//
//   pnpm --filter @citation-equity/bench exec tsx "$PWD/experiments/e1/fetch_geobench.ts" \
//     [--splits test,val] [--max-queries 10] [--hours 6]
//   pnpm --filter @citation-equity/bench exec tsx "$PWD/experiments/e1/fetch_geobench.ts" --source wayback
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { packFromUrls } from '../../packages/bench/src/node/from-urls';
import { keepQuery, readGeoRow, statusOf, waybackUrl } from './e1_lib';

export const GEOBENCH_DATASET = 'GEO-Optim/geo-bench';
const ROWS_URL = 'https://datasets-server.huggingface.co/rows';
const PAGE_SIZE = 100;
/** Split -> datasets-server config, in the order the queries are taken. */
const SPLITS: Record<string, string> = { test: 'test', val: 'train', train: 'train' };
const SPLIT_RANK: Record<string, number> = { test: 0, val: 1, train: 2 };
/** Queries about named private individuals, dropped by hand after review (Data 2). */
const PRIVATE_INDIVIDUAL_QUERY_IDS = new Set<string>([]);
const FETCH_TIMEOUT_MS = 20_000;

const here = import.meta.dirname;
const repo = resolve(here, '../..');
const { values } = parseArgs({
  options: {
    data: { type: 'string', default: join(here, 'data') },
    cache: { type: 'string', default: join(repo, '.cache/geobench') },
    source: { type: 'string', default: 'live' },
    splits: { type: 'string', default: 'test,val' },
    'max-queries': { type: 'string' },
    hours: { type: 'string', default: '6' },
    concurrency: { type: 'string', default: '4' },
    'delay-ms': { type: 'string', default: '1500' },
  },
});
const data = resolve(values.data as string);
const out = join(data, 'raw', `${values.source}.jsonl`);
mkdirSync(dirname(out), { recursive: true });

interface Query {
  query_id: string;
  split: string;
  row_idx: number;
  order: number;
  query: string;
  urls: string[];
}

const timedFetch: typeof fetch = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

async function rowsPage(
  split: string,
  offset: number,
): Promise<{ rows: { row_idx: number; row: unknown }[]; num_rows_total: number }> {
  const file = join(values.cache as string, `${split}-${offset}-${PAGE_SIZE}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const url = new URL(ROWS_URL);
  url.search = new URLSearchParams({
    dataset: GEOBENCH_DATASET,
    config: SPLITS[split] ?? split,
    split,
    offset: String(offset),
    length: String(PAGE_SIZE),
  }).toString();
  const res = await timedFetch(url.toString());
  if (!res.ok) throw new Error(`GEO-bench download failed: HTTP ${res.status} for ${url}`);
  const page = await res.json();
  mkdirSync(values.cache as string, { recursive: true });
  writeFileSync(file, JSON.stringify(page));
  return page;
}

/** Rows read, bad rows (no string query or unusable sources, skipped) and kept queries. */
const rowCounts = { rows_read: 0, bad_row: 0, kept: 0 };

/** Kept queries of a split, in dataset order. */
async function* keptQueries(split: string): AsyncGenerator<Query> {
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await rowsPage(split, offset);
    for (const { row_idx, row: raw } of page.rows) {
      rowCounts.rows_read++;
      const row = readGeoRow(raw);
      if (!row) {
        rowCounts.bad_row++;
        continue;
      }
      const query_id = `geo-${split}-${row_idx}`;
      if (!keepQuery(row.query, row.tags) || PRIVATE_INDIVIDUAL_QUERY_IDS.has(query_id)) continue;
      rowCounts.kept++;
      yield {
        query_id,
        split,
        row_idx,
        order: (SPLIT_RANK[split] ?? 9) * 1_000_000 + row_idx,
        query: row.query,
        urls: row.urls,
      };
    }
    if (page.rows.length === 0 || offset + PAGE_SIZE >= page.num_rows_total) return;
  }
}

function readRecords(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

/** Fetches `urls` through packFromUrls; returns, per URL, the page or the skip reason. */
async function fetchPages(question: string, urls: string[]) {
  const skips = new Map<string, string>();
  let documents: { url?: string; title: string; text: string }[] = [];
  try {
    const pack = await packFromUrls({
      question,
      urls,
      packId: 'e1',
      fetchImpl: timedFetch,
      onSkip: (u, r) => skips.set(u, r),
    });
    documents = pack.queries[0]?.documents ?? [];
  } catch {
    // packFromUrls throws when every URL was skipped; the reasons are in `skips`.
  }
  return urls.map((u) => {
    const doc = documents.find((d) => d.url === u);
    const reason = doc ? null : (skips.get(u) ?? 'no readable text');
    return { url: u, ok: Boolean(doc), reason, title: doc?.title ?? '', text: doc?.text ?? '' };
  });
}

function record(
  q: Omit<Query, 'urls'>,
  urlIndex: number,
  url: string,
  page: Awaited<ReturnType<typeof fetchPages>>[number],
  fetchUrl: string,
) {
  return {
    query_id: q.query_id,
    set: 'main',
    split: q.split,
    row_idx: q.row_idx,
    order: q.order,
    query: q.query,
    url_index: urlIndex,
    url,
    fetch_url: fetchUrl,
    source: values.source,
    ok: page.ok,
    status: statusOf(page.reason),
    reason: page.reason,
    title: page.title,
    text: page.text,
    fetched_at: new Date().toISOString(),
  };
}

async function live() {
  const done = new Set(readRecords(out).map((r) => r.query_id as string));
  const max = values['max-queries'] ? Number(values['max-queries']) : Number.POSITIVE_INFINITY;
  const first = readRecords(out)[0]?.fetched_at as string | undefined;
  const deadline = (first ? Date.parse(first) : Date.now()) + Number(values.hours) * 3_600_000;
  const queue: Query[] = [];
  for (const split of (values.splits as string).split(',')) {
    for await (const q of keptQueries(split)) {
      if (!done.has(q.query_id)) queue.push(q);
      if (queue.length >= max) break;
    }
    if (queue.length >= max) break;
  }
  let fetched = 0;
  const worker = async () => {
    for (let q = queue.shift(); q; q = queue.shift()) {
      if (Date.now() > deadline) return;
      const pages = await fetchPages(q.query, q.urls);
      const lines = pages.map((p, i) => JSON.stringify(record(q, i + 1, p.url, p, p.url)));
      appendFileSync(out, `${lines.join('\n')}\n`);
      fetched++;
    }
  };
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  console.log(
    JSON.stringify({
      source: 'live',
      ...rowCounts,
      queries_fetched: fetched,
      out,
      stopped_at_deadline: Date.now() > deadline,
    }),
  );
}

async function wayback() {
  const need = readRecords(join(data, 'wayback_needed.jsonl')) as unknown as (Omit<
    Query,
    'urls'
  > & { url: string; url_index: number })[];
  const done = new Set(readRecords(out).map((r) => `${r.query_id}|${r.url_index}`));
  let fetched = 0;
  for (const n of need) {
    if (done.has(`${n.query_id}|${n.url_index}`)) continue;
    const snapshot = waybackUrl(n.url);
    const [page] = await fetchPages(n.query, [snapshot]);
    if (!page) continue;
    appendFileSync(out, `${JSON.stringify(record(n, n.url_index, n.url, page, snapshot))}\n`);
    fetched++;
    await new Promise((r) => setTimeout(r, Number(values['delay-ms'])));
  }
  console.log(JSON.stringify({ source: 'wayback', pages_fetched: fetched, out }));
}

if (values.source === 'live') await live();
else if (values.source === 'wayback') await wayback();
else throw new Error('--source must be live or wayback');
