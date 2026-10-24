// A small CSV reader and the header helpers shared by the export parsers (Bing AI Performance,
// Search Console). Pure and browser-safe: the caller passes the file's text.

/** A record and the 1-based line of the file it starts on. */
export interface CsvRow {
  cells: string[];
  line: number;
}

/** The file's records with their line numbers, without a leading byte order mark or blank rows. */
export const csvRows = (text: string): CsvRow[] =>
  parseCsv(text.replace(/^﻿/, '')).filter((r) => r.cells.some((c) => c.trim() !== ''));

/** The file's records, without a leading byte order mark and without blank rows. */
export const csvRecords = (text: string): string[][] => csvRows(text).map((r) => r.cells);

/**
 * The record that most likely heads the table among the first `within` records: the first one
 * as wide as most rows are. A title or disclaimer above the table ("Exported 2026-10-23, data
 * sampled") is narrower, so it is passed over. Used to list the headers in an error message.
 */
export function likelyHeader(records: string[][], within: number): string[] | undefined {
  const widths = new Map<number, number>();
  for (const r of records) widths.set(r.length, (widths.get(r.length) ?? 0) + 1);
  let width = 0;
  let most = 0;
  for (const [w, n] of widths) if (n > most || (n === most && w > width)) [width, most] = [w, n];
  return records.slice(0, within).find((r) => r.length === width) ?? records[0];
}

/** A header compared to an alias: case and punctuation ignored ("Top Queries" -> "top queries"). */
export const normHeader = (header: string) =>
  header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** "Headers found: A, B." for an error message, or "(none)". */
export const headersFound = (header: string[] | undefined) => {
  const names = (header ?? []).map((h) => h.trim()).filter((h) => h !== '');
  return `Headers found: ${names.length > 0 ? names.join(', ') : '(none)'}.`;
};

/** A count, allowing thousands separators ("1,204") and decimals. */
export const isNumeric = (s: string) => /^\d[\d,\s]*(\.\d+)?$/.test(s.trim());

/** The count in a cell ("1,204" -> 1204); an empty cell is 0. Check `isNumeric` first. */
export const countOf = (s: string) => (s.trim() === '' ? 0 : Number(s.replace(/[,\s]/g, '')));

/** Fields in one line split by `delimiter`, ignoring delimiters inside double quotes. */
function fieldCount(line: string, delimiter: string): number {
  let n = 1;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) n++;
  }
  return n;
}

/**
 * The delimiter: a comma, semicolon or tab, whichever splits the most of the first 20 lines into
 * the same number of fields (two or more). A comma in a title line above a semicolon table
 * ("Report, sampled") does not decide it. A comma wins a tie.
 */
function sniffDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 20);
  let best = ',';
  let bestScore = 0;
  for (const delimiter of [',', ';', '\t']) {
    const runs = new Map<number, number>();
    for (const line of lines) {
      const n = fieldCount(line, delimiter);
      if (n > 1) runs.set(n, (runs.get(n) ?? 0) + 1);
    }
    const score = Math.max(0, ...runs.values());
    if (score > bestScore) [best, bestScore] = [delimiter, score];
  }
  return best;
}

/**
 * RFC 4180 CSV: quoted fields may hold commas, newlines and doubled quotes; CRLF or LF. The
 * delimiter is a comma, or a semicolon or tab for spreadsheet exports in some locales (see
 * sniffDelimiter). Each record carries the line it starts on.
 */
function parseCsv(text: string): CsvRow[] {
  const delimiter = sniffDelimiter(text);
  const records: CsvRow[] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push({ cells: record, line: recordLine });
      record = [];
      field = '';
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push({ cells: record, line: recordLine });
  }
  return records;
}
