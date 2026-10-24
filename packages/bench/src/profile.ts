import { gather, parseDraft } from '@citation-equity/engine';
import type { BenchDraft, BenchReport, Pack, PackDocument, RunRecord } from './types';
import { DRAFT_DOC_ID } from './types';

/** Structure counts of one document, read the same way the engine reads a draft. */
export interface DocProfile {
  docId: string;
  words: number;
  headings: number;
  lists: number;
  tables: number;
  statistics: number;
  links: number;
}

type Counts = Omit<DocProfile, 'docId'>;
const COUNT_KEYS = ['words', 'headings', 'lists', 'tables', 'statistics', 'links'] as const;

/**
 * A number in prose: digits with optional thousands separators and decimals, an optional currency
 * sign before and percent sign after. The lookarounds keep digits inside words ("qwen2.5") out.
 */
const NUMBER =
  /(?<![\p{L}\p{N}.,])([$€£]\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s?%| percent\b)?(?![\p{L}\p{N}])/gu;

/**
 * Counts statistics in plain prose: every number except a bare year (1900 to 2099 with no
 * currency, decimals or percent). A simpler reading than the engine's `statistics` check, kept
 * here so the profile does not depend on that check's internals; it is only used to compare
 * cited pages with the draft, both counted the same way.
 */
export function countStatistics(text: string): number {
  let n = 0;
  for (const m of text.matchAll(NUMBER)) {
    const [, currency, int, decimals, percent] = m;
    const bareYear = !currency && !decimals && !percent && /^(19|20)\d\d$/.test(int);
    if (!bareYear) n++;
  }
  return n;
}

/** Profiles Markdown (or plain text): code, front matter and HTML are ignored, as in the engine. */
export function profileDocument(docId: string, markdown: string): DocProfile {
  const a = gather(parseDraft(markdown));
  return {
    docId,
    words: a.wordCount,
    headings: a.headings.length,
    lists: a.lists.length,
    tables: a.tables.length,
    statistics: a.paragraphs.reduce((sum, p) => sum + countStatistics(p.plain), 0),
    links: a.links.length,
  };
}

/**
 * Profiles the competitor pages the model cited: every pack document cited at least once in any
 * run of `report`, in the order first cited, once per (query, document). `medians` are taken over
 * those pages (all zero when none was cited). Pass the draft to get its profile alongside.
 * Throws if the report was run on another pack.
 */
export function competitorProfile(
  report: Pick<BenchReport, 'packId'> & { runs: Pick<RunRecord, 'queryId' | 'citedDocIds'>[] },
  pack: Pack,
  draft?: BenchDraft,
): { cited: DocProfile[]; draft?: DocProfile; medians: Counts } {
  if (report.packId !== pack.packId) {
    throw new Error(`The report was run on pack "${report.packId}", not on pack "${pack.packId}"`);
  }
  const docsByQuery = new Map(
    pack.queries.map((q) => [q.queryId, new Map(q.documents.map((d) => [d.docId, d]))]),
  );
  const seen = new Set<string>();
  const citedDocs: PackDocument[] = [];
  for (const run of report.runs) {
    for (const docId of run.citedDocIds) {
      if (docId === DRAFT_DOC_ID) continue;
      const key = JSON.stringify([run.queryId, docId]);
      const doc = docsByQuery.get(run.queryId)?.get(docId);
      if (seen.has(key) || !doc) continue;
      seen.add(key);
      citedDocs.push(doc);
    }
  }
  const cited = citedDocs.map((d) => profileDocument(d.docId, d.text));
  const medians = Object.fromEntries(
    COUNT_KEYS.map((key) => [key, median(cited.map((p) => p[key]))]),
  ) as Counts;
  const result: { cited: DocProfile[]; draft?: DocProfile; medians: Counts } = { cited, medians };
  if (draft) result.draft = profileDocument(DRAFT_DOC_ID, draft.markdown);
  return result;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
