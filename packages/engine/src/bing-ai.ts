// Bing Webmaster Tools' AI Performance report, exported as CSV: how often Copilot and Bing's AI
// answers cited your pages. Pure parsing of the text the caller passes in (browser-safe; the
// `ce signals bing` command re-exports it from the bench).
//
// Microsoft documents the report's metrics (citations, grounding queries, cited pages, a
// timeline) but, as of 2026-10-23, not the export's column headers, and no public sample file
// was found. Headers are therefore matched loosely: case and punctuation ignored, against the
// aliases below, and the error for an unknown file lists the headers it did find.

import {
  countOf,
  csvRecords,
  csvRows,
  headersFound,
  isNumeric,
  likelyHeader,
  normHeader,
} from './csv';

export interface BingAiSignals {
  /** Data rows (below the header row) that are not empty. */
  rows: number;
  /** Sum of the citations column. */
  totalCitations: number;
  /** Citations per page URL (duplicates summed), most first; empty without a page column. */
  byPage: { url: string; citations: number }[];
  /** Citations per grounding query, most first; empty without a query column. */
  byQuery: { query: string; citations: number }[];
  /** First and last date (YYYY-MM-DD) when the file has a date column, else null. */
  dateRange: [string, string] | null;
}

const CITATIONS = [
  'citations',
  'citation',
  'total citations',
  'citation count',
  'number of citations',
  'times cited',
];
// "cited pages" is also the name of a per-day count, so a page alias is taken only when its
// first value is not a number.
const PAGE = ['page', 'pages', 'url', 'urls', 'page url', 'cited page', 'cited pages', 'cited url'];
const QUERY = ['grounding query', 'grounding queries', 'query', 'queries', 'search query'];
const DATE = ['date', 'day'];

/** Rows above the header (a title or the sampling disclaimer) are skipped, up to this many. */
const MAX_PREAMBLE = 10;

interface BingTable {
  header: string[];
  body: string[][];
  /** The file line (1-based) each body row starts on, parallel to `body`. */
  lines: number[];
  citationsAt: number;
  pageAt: number;
  queryAt: number;
  dateAt: number;
}

/**
 * True when a record reads as a Bing AI Performance header: a citations column and, on the same
 * row, a page, grounding query or date column. A data row that merely holds the word "citation"
 * (a Search Console query, say) has no such neighbour.
 */
export const isBingAiHeaderRow = (record: string[]): boolean => {
  const names = record.map(normHeader);
  const has = (aliases: string[]) => names.some((n) => aliases.includes(n));
  return has(CITATIONS) && (has(PAGE) || has(QUERY) || has(DATE));
};

/** True when such a header row is within the rows a Bing export may start with. */
export const looksLikeBingAiExport = (text: string): boolean =>
  csvRecords(text)
    .slice(0, MAX_PREAMBLE + 1)
    .some(isBingAiHeaderRow);

const citationsHeaderAt = (records: string[][]) =>
  records
    .slice(0, MAX_PREAMBLE + 1)
    .findIndex((r) => r.some((c) => CITATIONS.includes(normHeader(c))));

/** The header row and the columns found in it; throws when the file is not the export. */
function readBingTable(text: string): BingTable {
  const rows = csvRows(text);
  const records = rows.map((r) => r.cells);
  const headerAt = citationsHeaderAt(records);
  if (headerAt < 0) {
    throw new Error(
      `Not a Bing AI Performance export: no citations column. ${headersFound(likelyHeader(records, MAX_PREAMBLE + 1))}`,
    );
  }
  const header = records[headerAt];
  const body = records.slice(headerAt + 1);
  const names = header.map(normHeader);
  const column = (aliases: string[], accept: (i: number) => boolean = () => true) =>
    aliases.map((a) => names.indexOf(a)).find((i) => i >= 0 && accept(i)) ?? -1;
  const firstValue = (i: number) => body.find((r) => (r[i] ?? '').trim() !== '')?.[i] ?? '';
  const table = {
    header,
    body,
    lines: rows.slice(headerAt + 1).map((r) => r.line),
    citationsAt: column(CITATIONS),
    pageAt: column(PAGE, (i) => !isNumeric(firstValue(i))),
    queryAt: column(QUERY),
    dateAt: column(DATE),
  };
  if (table.pageAt < 0 && table.queryAt < 0 && table.dateAt < 0) {
    throw new Error(
      `Not a Bing AI Performance export: expected a page, grounding query or date column next to the citations column. ${headersFound(header)}`,
    );
  }
  return table;
}

export function parseBingAiPerformanceCsv(text: string): BingAiSignals {
  const { body, lines, citationsAt, pageAt, queryAt, dateAt } = readBingTable(text);
  const byPage = new Map<string, number>();
  const byQuery = new Map<string, number>();
  const dates: string[] = [];
  let totalCitations = 0;
  body.forEach((r, i) => {
    // The file's line, so the number matches what a spreadsheet or editor shows.
    const rowNumber = lines[i] ?? i + 1;
    const cell = (at: number) => (at < 0 ? '' : (r[at] ?? '').trim());
    const raw = cell(citationsAt);
    if (!isNumeric(raw) && raw !== '') {
      throw new Error(`Row ${rowNumber}: citations value "${raw}" is not a number.`);
    }
    const citations = countOf(raw);
    totalCitations += citations;
    const page = cell(pageAt);
    if (page !== '') byPage.set(page, (byPage.get(page) ?? 0) + citations);
    const query = cell(queryAt);
    if (query !== '') byQuery.set(query, (byQuery.get(query) ?? 0) + citations);
    const date = cell(dateAt);
    if (date !== '') {
      const iso = isoDate(date);
      if (!iso) {
        throw new Error(
          `Row ${rowNumber}: cannot read date "${date}"; expected YYYY-MM-DD or M/D/YYYY.`,
        );
      }
      dates.push(iso);
    }
  });
  dates.sort();

  return {
    rows: body.length,
    totalCitations,
    byPage: ranked(byPage).map(([url, citations]) => ({ url, citations })),
    byQuery: ranked(byQuery).map(([query, citations]) => ({ query, citations })),
    dateRange: dates.length > 0 ? [dates[0], dates[dates.length - 1]] : null,
  };
}

/**
 * The grounding queries of a Bing AI Performance export (duplicates summed, most cited first).
 * Throws, listing the headers found, for the pages or daily table, which has no query column.
 */
export function parseBingAiGroundingQueries(text: string): { query: string; citations: number }[] {
  const { header, queryAt } = readBingTable(text);
  if (queryAt < 0) {
    throw new Error(
      `Not the grounding queries table of a Bing AI Performance export: no query column. ${headersFound(header)}`,
    );
  }
  return parseBingAiPerformanceCsv(text).byQuery;
}

/** YYYY-MM-DD (a time may follow), YYYY/MM/DD, or the US M/D/YYYY that Bing's UI uses. */
function isoDate(s: string): string | undefined {
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(s);
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: .*)?$/.exec(s);
  const [y, m, d] = ymd ? [ymd[1], ymd[2], ymd[3]] : mdy ? [mdy[3], mdy[1], mdy[2]] : [];
  if (!y || !m || !d) return undefined;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  // Rejects 2026-13-01 and 2026-02-30, which Date would roll over or not read at all.
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().startsWith(iso) ? iso : undefined;
}

const ranked = (m: Map<string, number>) =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
