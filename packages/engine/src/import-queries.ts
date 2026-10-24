// Real queries as target questions: the Queries table of a Google Search Console Performance
// export, or the grounding queries table of a Bing AI Performance export. Pure and
// browser-safe; the workspace reads the file with the File API and nothing is sent anywhere.
//
// Search Console's export (Performance > Export > CSV, a zip with Queries.csv, Pages.csv and
// others) names its columns "Top queries", "Clicks", "Impressions", "CTR" and "Position".
// Google's help pages describe the export but not its literal headers, so these come from
// public scripts and READMEs that read it (checked 2026-10-23). Headers are matched ignoring
// case and punctuation, against aliases that also cover the API's and Sheets' "query", and an
// unknown file fails with the headers it found.

import { isBingAiHeaderRow, looksLikeBingAiExport, parseBingAiGroundingQueries } from './bing-ai';
import { readsAsQuestion, startsWithInterrogative } from './checks/question-headings';
import { countOf, csvRecords, csvRows, headersFound, isNumeric, normHeader } from './csv';
import { asQuestion, singleNounPhrase, type TargetQuestion } from './questions';

export interface ImportedQuery {
  text: string;
  source: 'search-console' | 'bing-ai';
  impressions?: number;
  clicks?: number;
  citations?: number;
}

const SC_QUERY = ['top queries', 'top query', 'queries', 'query', 'search query'];
const SC_IMPRESSIONS = ['impressions', 'impression'];
const SC_CLICKS = ['clicks', 'click'];
const SC_PAGE = ['top pages', 'page', 'pages'];

const DEFAULT_MAX = 8;
/** A keyword query of up to this many words may become "What is <q>?". */
const SHORT_WORDS = 3;
/**
 * Words that mark a navigational or task query ("road bike size chart", "grinder price"):
 * such a query is kept as the reader typed it, never turned into "What is ...?".
 */
const NAVIGATIONAL = new Set(
  (
    'chart charts calculator login price prices pricing cost costs review reviews near ' +
    'download pdf app template templates coupon coupons deal deals sale map hours menu ' +
    'number phone address login signup'
  ).split(' '),
);

/** Lowercase "i" as a word ("how much should i spend", "i'm") becomes "I". */
const capitaliseI = (text: string): string =>
  text.replace(/(?<![\p{L}\p{N}'’])i(?=$|[\s'’?.!,])/gu, 'I');

/**
 * The Queries table of a Search Console Performance export: one entry per query with its
 * impressions and (when the column is there) clicks. CTR and position are not read.
 */
export function parseSearchConsoleQueries(csv: string): ImportedQuery[] {
  const [head, ...rows] = csvRows(csv);
  const header = head?.cells ?? [];
  const names = header.map(normHeader);
  const column = (aliases: string[]) =>
    aliases.map((a) => names.indexOf(a)).find((i) => i >= 0) ?? -1;
  const queryAt = column(SC_QUERY);
  const impressionsAt = column(SC_IMPRESSIONS);
  const clicksAt = column(SC_CLICKS);
  const fail = (why: string) =>
    new Error(`Not a Search Console Queries export: ${why} ${headersFound(header)}`);
  if (queryAt < 0) {
    throw fail(
      column(SC_PAGE) >= 0
        ? 'This is the Pages table; export the Queries table (Queries.csv) instead.'
        : 'no query column (Google names it "Top queries").',
    );
  }
  if (impressionsAt < 0) throw fail('no impressions column.');

  const out: ImportedQuery[] = [];
  for (const { cells: r, line } of rows) {
    const text = (r[queryAt] ?? '').trim();
    if (text === '') continue;
    const count = (at: number, name: string) => {
      const raw = (r[at] ?? '').trim();
      if (raw !== '' && !isNumeric(raw)) {
        throw new Error(`Row ${line}: ${name} value "${raw}" is not a number.`);
      }
      return countOf(raw);
    };
    const q: ImportedQuery = { text, source: 'search-console' };
    if (clicksAt >= 0) q.clicks = count(clicksAt, 'clicks');
    q.impressions = count(impressionsAt, 'impressions');
    out.push(q);
  }
  return out;
}

/**
 * The grounding queries table of a Bing AI Performance export, with Task 16's header handling
 * (aliases, a skipped preamble, duplicates summed), most cited first.
 */
export function parseBingAiQueries(csv: string): ImportedQuery[] {
  return parseBingAiGroundingQueries(csv).map((q) => ({
    text: q.query,
    source: 'bing-ai',
    citations: q.citations,
  }));
}

/**
 * Either export. A first row with a query and an impressions column (that is not also a Bing
 * header) is Search Console's header, which is always row 1, so a query such as "citation" in its data
 * rows cannot make the file read as Bing's. Otherwise a Bing header row (citations next to a
 * page, query or date column, after an optional preamble) means Bing AI Performance. An unknown
 * file fails with the Search Console message, which names the headers found.
 */
export function parseQueriesCsv(csv: string): ImportedQuery[] {
  const first = csvRecords(csv)[0] ?? [];
  if (isSearchConsoleHeader(first) && !isBingAiHeaderRow(first)) {
    return parseSearchConsoleQueries(csv);
  }
  return looksLikeBingAiExport(csv) ? parseBingAiQueries(csv) : parseSearchConsoleQueries(csv);
}

const isSearchConsoleHeader = (record: string[]) => {
  const names = record.map(normHeader);
  const has = (aliases: string[]) => names.some((n) => aliases.includes(n));
  return has(SC_QUERY) && has(SC_IMPRESSIONS);
};

/**
 * The key two questions are compared by: case, runs of spaces and closing punctuation ("?",
 * ".", "!") ignored. Ranking dedupes by it; the CLI and the workspace use it to tell whether a
 * question is just its query with a capital and "?".
 */
export const questionKey = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\s.?!]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The target question a query becomes. A question-like query (ending in "?", or opening with
 * a question word or an auxiliary) keeps its words, with a capital and one "?". A keyword
 * query of up to 3 words that is a single noun phrase becomes "What is <q>?" ("What are" for
 * a plural noun), unless it is navigational ("road bike size chart", "grinder price"). Any
 * other query is kept verbatim, still labelled with its source. A lowercase "i" becomes "I".
 */
function questionOf(q: ImportedQuery): TargetQuestion {
  const text = capitaliseI(q.text.replace(/\s+/g, ' ').trim());
  if (readsAsQuestion(text) || startsWithInterrogative(text)) {
    return { text: asQuestion(text), source: q.source };
  }
  const words = text.split(' ');
  const navigational = words.some((w) => NAVIGATIONAL.has(w.toLowerCase()));
  const phrase = words.length <= SHORT_WORDS && !navigational ? singleNounPhrase(text) : null;
  if (phrase)
    return { text: `${phrase.plural ? 'What are' : 'What is'} ${text}?`, source: q.source };
  return { text, source: q.source };
}

/**
 * Every query, ranked by citations, then impressions (input order on a tie), each with the
 * question it becomes. Queries that give the same question (ignoring case, spacing and the
 * closing "?") are kept once, at the higher rank. The workspace lists these with their numbers.
 */
export function rankImportedQueries(
  queries: ImportedQuery[],
): { query: ImportedQuery; question: TargetQuestion }[] {
  const ranked = [...queries].sort(
    (a, b) =>
      (b.citations ?? 0) - (a.citations ?? 0) || (b.impressions ?? 0) - (a.impressions ?? 0),
  );
  const seen = new Set<string>();
  const out: { query: ImportedQuery; question: TargetQuestion }[] = [];
  for (const query of ranked) {
    const question = questionOf(query);
    const key = questionKey(question.text);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push({ query, question });
  }
  return out;
}

/**
 * How a list of imported queries is ranked, in words, by the numbers the file has: "ranked by
 * impressions" for a Search Console file, "ranked by citations" for a Bing file, and "ranked by
 * citations, then impressions" when both are mixed.
 */
export function rankingNote(queries: ImportedQuery[]): string {
  const citations = queries.some((q) => q.citations !== undefined);
  const impressions = queries.some((q) => q.impressions !== undefined);
  if (citations && impressions) return 'ranked by citations, then impressions';
  if (citations) return 'ranked by citations';
  return impressions ? 'ranked by impressions' : 'in file order';
}

const count = (n: number, one: string) =>
  `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;

/** A query's numbers for display: "52 citations", "2,310 impressions, 12 clicks". */
export function queryNumbers(q: ImportedQuery): string {
  const parts: string[] = [];
  if (q.citations !== undefined) parts.push(count(q.citations, 'citation'));
  if (q.impressions !== undefined) parts.push(count(q.impressions, 'impression'));
  if (q.clicks !== undefined) parts.push(count(q.clicks, 'click'));
  return parts.join(', ');
}

/** The top `max` (default 8) of `rankImportedQueries`, as target questions. */
export function toTargetQuestions(
  queries: ImportedQuery[],
  opts: { max?: number } = {},
): TargetQuestion[] {
  const max = Math.max(0, opts.max ?? DEFAULT_MAX);
  return rankImportedQueries(queries)
    .slice(0, max)
    .map((r) => r.question);
}
