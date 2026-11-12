// Reads a Tranco list (https://tranco-list.eu) that the author downloaded: the CSV with one
// `rank,domain` line per site, a million lines for the full list. No list ships with the tool, and
// nothing here makes a request: the file is read where it was chosen.
import type { RankList } from './site-size';

export class TrancoListError extends Error {
  override name = 'TrancoListError';
}

/** Where to get a list, for messages and help text. */
export const TRANCO_URL = 'https://tranco-list.eu';

/**
 * A Tranco list from its CSV text. Each line is `rank,domain`, ranks run 1, 2, 3, ... with none
 * skipped; a header line, a byte order mark, Windows line ends, blank lines and spaces around a
 * field are tolerated. `id` names the list (say "6GWVX") and is '' when not given. Throws a
 * TrancoListError with a readable message for anything else, so a wrong file never passes as an
 * empty or partial list. A domain listed twice keeps its first (best) rank.
 */
export function parseTrancoList(text: string, id = ''): RankList {
  const ranks = new Map<string, number>();
  let expected = 1;
  let lineNo = 0;
  for (const raw of text.replace(/^\uFEFF/, '').split('\n')) {
    lineNo++;
    const line = raw.trim();
    if (line === '') continue;
    const comma = line.indexOf(',');
    const rankText = comma < 0 ? '' : line.slice(0, comma).trim();
    const domain =
      comma < 0
        ? ''
        : line
            .slice(comma + 1)
            .trim()
            .toLowerCase();
    if (lineNo === 1 && !/^\d+$/.test(rankText)) continue; // a header such as "rank,domain"
    if (
      !/^\d+$/.test(rankText) ||
      domain === '' ||
      /[\s,/]/.test(domain) ||
      !domain.includes('.')
    ) {
      throw new TrancoListError(
        `Line ${lineNo} is not "rank,domain". Download the list's CSV from ${TRANCO_URL}.`,
      );
    }
    const rank = Number(rankText);
    if (rank !== expected) {
      throw new TrancoListError(
        `Line ${lineNo} has rank ${rank} where ${expected} was expected. Load the whole list, unchanged.`,
      );
    }
    expected++;
    if (!ranks.has(domain)) ranks.set(domain, rank);
  }
  if (ranks.size === 0) {
    throw new TrancoListError(
      `This file has no sites. Download the list's CSV from ${TRANCO_URL}.`,
    );
  }
  const depth = expected - 1;
  return { id, depth, rankOf: (domain) => ranks.get(domain.toLowerCase()) };
}

/**
 * The list ID in a Tranco file name ("tranco_6GWVX.csv" or "tranco_6GWVX-1m.csv.zip" -> "6GWVX"),
 * else ''.
 */
export function trancoIdFromFileName(name: string): string {
  return /tranco[_-]([A-Z0-9]{4,6})\b/i.exec(name)?.[1]?.toUpperCase() ?? '';
}
