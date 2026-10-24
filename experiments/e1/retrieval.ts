// E1 retrieval outcomes (PREREG_E1.md r2, Measurement 1; reported, no verdicts).
//
// Pool: every normalized page of the set except donors. For each valid version of a target, the
// target's original is replaced by that version and every other page stays as fetched. Ranking is
// the bench's retrieve() (BM25, MiniSearch defaults, title + text) with k = pool size; pages are
// indexed in docId (page_id) order, so retrieve()'s input-order tie-break is a tie-break by docId.
// retrieve() returns only pages that match a query term; the rest follow in docId
// order, so every page has a rank.
// Outcomes: the target's 1-based rank in the pool, its rank among the query's own 4 in-prompt pages,
// and whether it is in the top 8 (matched and rank <= 8). BM25 rewards lexical arms (12, 9, 2) by
// construction.
//
// Run from the repository root:
//   pnpm --filter @citation-equity/bench exec tsx --conditions=@citation-equity/source \
//     "$PWD/experiments/e1/retrieval.ts" [--data experiments/e1/data] [--out experiments/e1/out] [--set main]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { retrieve } from '../../packages/bench/src/retrieve';
import type { PackDocument } from '../../packages/bench/src/types';

export interface PageRow {
  page_id: string;
  query_id: string;
  set: string;
  query: string;
  title: string;
  text: string;
  role: 'target' | 'competitor' | 'donor';
}

export interface VersionRow {
  version_id: string;
  query_id: string;
  arm: string;
  title: string;
  text: string;
  valid: boolean;
}

export interface RetrievalRow {
  query_id: string;
  version_id: string;
  arm: string;
  set: string;
  pool_size: number;
  rank_pool: number;
  rank_own: number;
  top8: boolean;
  matched: boolean;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Retrieval outcomes for every valid version of the set's targets. */
export function rankVersions(
  pages: PageRow[],
  versions: VersionRow[],
  set: string,
): RetrievalRow[] {
  const pool = pages
    .filter((p) => p.set === set && p.role !== 'donor')
    .sort((a, b) => byId(a.page_id, b.page_id));
  const targets = new Map(pool.filter((p) => p.role === 'target').map((p) => [p.query_id, p]));
  const rows: RetrievalRow[] = [];
  for (const v of versions) {
    const target = targets.get(v.query_id);
    if (!v.valid || !target) continue;
    const docs: PackDocument[] = pool.map((p) =>
      p.page_id === target.page_id
        ? { docId: p.page_id, title: v.title, text: v.text, synthetic: false }
        : { docId: p.page_id, title: p.title, text: p.text, synthetic: false },
    );
    const hits = retrieve(docs, target.query, docs.length).map((d) => d.docId);
    const hit = new Set(hits);
    const order = [...hits, ...docs.map((d) => d.docId).filter((id) => !hit.has(id))];
    const own = new Set(pool.filter((p) => p.query_id === v.query_id).map((p) => p.page_id));
    const rankPool = order.indexOf(target.page_id) + 1;
    rows.push({
      query_id: v.query_id,
      version_id: v.version_id,
      arm: v.arm,
      set,
      pool_size: docs.length,
      rank_pool: rankPool,
      rank_own: order.filter((id) => own.has(id)).indexOf(target.page_id) + 1,
      top8: hit.has(target.page_id) && rankPool <= 8,
      matched: hit.has(target.page_id),
    });
  }
  return rows;
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);
}

function main(argv: string[]): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const arg = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const data = resolve(arg('--data', join(here, 'data')));
  const out = resolve(arg('--out', join(here, 'out')));
  const set = arg('--set', 'main');
  const rows = rankVersions(
    readJsonl<PageRow>(join(data, 'pages.jsonl')),
    readJsonl<VersionRow>(join(data, 'versions.jsonl')),
    set,
  );
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'retrieval.jsonl'), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
  process.stdout.write(`retrieval: ${rows.length} versions ranked in the ${set} pool\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
