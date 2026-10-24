// E1 replication set: raw records from C-SEO Bench's `web` split (experiments/PREREG_E1.md,
// Replication set). Rows come from the Hugging Face datasets-server API through the same cache
// files as `ce pack cseo` (.cache/cseo/web-<offset>-100.json), so a cached split works offline.
// Each query's documents (plain text, no title or URL) are written in dataset order to
// data/raw/cseo.jsonl; normalize.py applies rules 5(a), 5(b) and the cap, and draw.py takes the
// first 60 queries whose 5 documents are all usable. Nothing here is committed.
//
//   pnpm --filter @citation-equity/bench exec tsx "$PWD/experiments/e1/cseo_replication.ts" [--max-queries 300]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CSEO_DATASET, CSEO_ROWS_URL } from '../../packages/bench/src/node/cseo';

const PAGE_SIZE = 100;
const SPLIT = 'web';
const here = import.meta.dirname;
const repo = resolve(here, '../..');
const { values } = parseArgs({
  options: {
    data: { type: 'string', default: join(here, 'data') },
    cache: { type: 'string', default: join(repo, '.cache/cseo') },
    'max-queries': { type: 'string', default: '300' },
  },
});

interface Row {
  query_id: number;
  query: string;
  document: string;
}

async function rowsPage(offset: number): Promise<{ rows: { row: Row }[]; num_rows_total: number }> {
  const file = join(values.cache as string, `${SPLIT}-${offset}-${PAGE_SIZE}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const url = new URL(CSEO_ROWS_URL);
  url.search = new URLSearchParams({
    dataset: CSEO_DATASET,
    config: 'default',
    split: SPLIT,
    offset: String(offset),
    length: String(PAGE_SIZE),
  }).toString();
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`C-SEO download failed: HTTP ${res.status} for ${url}`);
  const page = await res.json();
  mkdirSync(values.cache as string, { recursive: true });
  writeFileSync(file, JSON.stringify(page));
  return page;
}

const max = Number(values['max-queries']);
// A query's rows are contiguous; reading on until the next query id appears keeps the last one whole.
const groups = new Map<number, Row[]>();
let complete = false;
for (let offset = 0; !complete; offset += PAGE_SIZE) {
  const page = await rowsPage(offset);
  for (const { row } of page.rows) {
    if (!groups.has(row.query_id)) {
      if (groups.size === max) {
        complete = true;
        break;
      }
      groups.set(row.query_id, []);
    }
    groups.get(row.query_id)?.push(row);
  }
  if (page.rows.length === 0 || offset + PAGE_SIZE >= page.num_rows_total) complete = true;
}

const records = [...groups.values()].flatMap((rows) =>
  rows.map((r, i) => ({
    query_id: `cseo-web-${r.query_id}`,
    set: 'replication',
    split: SPLIT,
    row_idx: r.query_id,
    order: r.query_id,
    query: rows[0]?.query.trim() ?? '',
    url_index: i + 1,
    url: null,
    source: 'cseo',
    ok: typeof r.document === 'string' && r.document.trim() !== '',
    status: null,
    reason: null,
    title: '',
    text: r.document ?? '',
    fetched_at: null,
  })),
);
const out = join(resolve(values.data as string), 'raw', 'cseo.jsonl');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
console.log(JSON.stringify({ queries: groups.size, documents: records.length, out }));
