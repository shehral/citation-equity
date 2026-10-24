import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePack } from '../pack';
import type { Pack, PackQuery } from '../types';

/** C-SEO Bench's question-answering domains (Puerto et al.); each is a split of the HF dataset. */
export const CSEO_DOMAINS = ['web', 'news', 'debate'] as const;
export type CseoDomain = (typeof CSEO_DOMAINS)[number];

export const CSEO_DATASET = 'cseo/cseo-bench';
/** The Hugging Face datasets-server rows API: JSON pages of the dataset, no parquet reader needed. */
export const CSEO_ROWS_URL = 'https://datasets-server.huggingface.co/rows';
const PAGE_SIZE = 100;
/** A query needs at least this many usable documents for the draft to compete against. */
const MIN_DOCS = 2;

interface Row {
  query_id: number;
  query: string;
  document: string;
}
interface RowsPage {
  rows: { row: Row }[];
  num_rows_total: number;
}

/**
 * Builds a research pack from C-SEO Bench's QA domains, downloaded at run time (the dataset is
 * never committed). Pages of rows are cached as JSON under `cacheDir`, so a second run works
 * offline. `maxQueries` is split evenly across `domains` (the remainder to the first ones), taken
 * in dataset order. A query is kept when, after dropping documents longer than `maxDocChars`,
 * empty ones and exact duplicates, at least two remain, and its question is not a repeat of a
 * question already kept (case and punctuation ignored).
 */
export async function buildCseoPack(opts: {
  domains: CseoDomain[];
  maxQueries: number;
  maxDocChars: number;
  cacheDir: string;
  fetchImpl?: typeof fetch;
}): Promise<Pack> {
  const domains = [...new Set(opts.domains)];
  if (domains.length === 0) throw new RangeError('domains must name at least one domain');
  const unknown = domains.filter((d) => !CSEO_DOMAINS.includes(d));
  if (unknown.length > 0) {
    throw new RangeError(
      `Unknown C-SEO domain: ${unknown.join(', ')} (choose from ${CSEO_DOMAINS.join(', ')})`,
    );
  }
  if (!Number.isInteger(opts.maxQueries) || opts.maxQueries < 1) {
    throw new RangeError('maxQueries must be an integer >= 1');
  }
  if (!Number.isInteger(opts.maxDocChars) || opts.maxDocChars < 1) {
    throw new RangeError('maxDocChars must be an integer >= 1');
  }
  const fetchImpl = opts.fetchImpl ?? fetch;

  const queries: PackQuery[] = [];
  const keptQuestions = new Set<string>();
  const base = Math.floor(opts.maxQueries / domains.length);
  const extra = opts.maxQueries % domains.length;
  for (const [i, domain] of domains.entries()) {
    const quota = base + (i < extra ? 1 : 0);
    if (quota === 0) continue;
    let kept = 0;
    await forEachQueryGroup(domain, opts.cacheDir, fetchImpl, (group) => {
      const query = keepQuery(domain, group, opts.maxDocChars, keptQuestions);
      if (query) {
        queries.push(query);
        kept++;
      }
      return kept < quota;
    });
  }

  if (queries.length === 0) {
    throw new Error('No C-SEO query met the filters; raise maxDocChars or pick other domains');
  }
  return validatePack({
    schemaVersion: 1,
    packId: `cseo-${domains.join('-')}-${opts.maxQueries}`,
    title: `C-SEO Bench subset (${domains.join(', ')}; ${queries.length} queries)`,
    source: `C-SEO Bench (Puerto et al., NeurIPS 2025 Datasets and Benchmarks), https://huggingface.co/datasets/${CSEO_DATASET}, downloaded at run time`,
    license: `C-SEO Bench dataset terms (see https://huggingface.co/datasets/${CSEO_DATASET}); used locally, not redistributed`,
    synthetic: false,
    queries,
  });
}

/** Applies the query filters to one query's rows; returns the pack query or undefined. */
function keepQuery(
  domain: CseoDomain,
  rows: Row[],
  maxDocChars: number,
  keptQuestions: Set<string>,
): PackQuery | undefined {
  const question = rows[0].query.trim();
  const normalized = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (normalized === '' || keptQuestions.has(normalized)) return undefined;
  const texts: string[] = [];
  for (const { document } of rows) {
    const text = typeof document === 'string' ? document.trim() : '';
    if (text !== '' && text.length <= maxDocChars && !texts.includes(text)) texts.push(text);
  }
  if (texts.length < MIN_DOCS) return undefined;
  keptQuestions.add(normalized);
  const queryId = `${domain}-${rows[0].query_id}`;
  return {
    queryId,
    query: question,
    documents: texts.map((text, i) => ({
      docId: `${queryId}-d${i + 1}`,
      title: '',
      text,
      synthetic: false,
    })),
  };
}

/**
 * Walks a split page by page and calls `visit` with each query's rows (rows of one query are
 * contiguous in the dataset). Stops when `visit` returns false or the split ends. A query id seen
 * again later is ignored, so a pack never holds two queries with one id.
 */
async function forEachQueryGroup(
  split: CseoDomain,
  cacheDir: string,
  fetchImpl: typeof fetch,
  visit: (rows: Row[]) => boolean,
): Promise<void> {
  const done = new Set<number>();
  let group: Row[] = [];
  const close = () => {
    const id = group[0]?.query_id;
    const keepGoing = id === undefined || done.has(id) ? true : visit(group);
    if (id !== undefined) done.add(id);
    group = [];
    return keepGoing;
  };
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await rowsPage(split, offset, cacheDir, fetchImpl);
    for (const { row } of page.rows) {
      if (group.length > 0 && row.query_id !== group[0].query_id && !close()) return;
      group.push(row);
    }
    if (page.rows.length === 0 || offset + PAGE_SIZE >= page.num_rows_total) {
      close();
      return;
    }
  }
}

async function rowsPage(
  split: CseoDomain,
  offset: number,
  cacheDir: string,
  fetchImpl: typeof fetch,
): Promise<RowsPage> {
  const file = join(cacheDir, `${split}-${offset}-${PAGE_SIZE}.json`);
  const cached = await readFile(file, 'utf8').catch(() => undefined);
  // A truncated or corrupt cache file (an interrupted run) is a cache miss: fetch it again.
  if (cached !== undefined) {
    const page = parseRowsPage(cached);
    if (page) return page;
  }

  const url = new URL(CSEO_ROWS_URL);
  url.search = new URLSearchParams({
    dataset: CSEO_DATASET,
    config: 'default',
    split,
    offset: String(offset),
    length: String(PAGE_SIZE),
  }).toString();
  const res = await fetchImpl(url.toString());
  if (!res.ok) throw new Error(`C-SEO download failed: HTTP ${res.status} for ${url}`);
  const page = (await res.json()) as RowsPage;
  if (!Array.isArray(page?.rows) || typeof page.num_rows_total !== 'number') {
    throw new Error(`C-SEO download returned an unexpected shape for ${url}`);
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, JSON.stringify(page));
  return page;
}

/** A cached rows page, or undefined when the text is not one. */
function parseRowsPage(text: string): RowsPage | undefined {
  try {
    const page = JSON.parse(text) as RowsPage;
    return Array.isArray(page?.rows) && typeof page.num_rows_total === 'number' ? page : undefined;
  } catch {
    return undefined;
  }
}
