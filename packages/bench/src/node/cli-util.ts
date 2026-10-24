// Helpers shared by the `ce` commands (cli.ts, live.ts, questions.ts, signals/): reading input
// files, writing JSON results, printing rates, and printing untrusted text.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Rate } from '../types';

/** Reads a UTF-8 file; a failure names the path and the error code, not a stack. */
export async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read ${path} (${(err as NodeJS.ErrnoException).code ?? 'error'})`, {
      cause: err,
    });
  }
}

/** Writes `value` as indented JSON, creating the directory first. */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** A share as a whole percentage, for example "38%". */
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A rate with its count and 95% interval, for example " 38%  (3 of 8; 95% CI 14% to 69%)". */
export const rate = (r: Rate) =>
  `${pct(r.p).padStart(4)}  (${r.k} of ${r.n}; 95% CI ${pct(r.lo)} to ${pct(r.hi)})`;

/**
 * Untrusted text (a fetched page, robots.txt, a CSV or a log) made safe for a terminal: control
 * characters, ANSI escapes and newlines among them, print as "?".
 */
export const printable = (s: string) => s.replace(/\p{Cc}/gu, '?');
