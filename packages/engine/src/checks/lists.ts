// Adapted from aeo-linter (https://github.com/DrowLink/aeo-audit-linter),
// core/src/audits/content-chunking/table-list-scannability.ts,
// @drowlink/aeo-linter-core v0.3.0, commit
// b10ebb89a98dd1ccd102bdb9733b2ca2630f7a42, MIT License, Copyright (c) 2026
// AEO Linter Contributors. Kept: a word-count floor below which lists are not
// expected, and a stepped score that rewards a real list. Changed: a 300-word
// floor, lists only (tables are their own check), a list must have 3 or more
// items, a middle step for prose that enumerates items a list could hold (an
// opener such as "For example," is not an item), and an advisory anchored on
// that paragraph.

import { countWords, type Sentence } from '../text';
import { isProse, issueCollector } from './structure-issues';
import { type CheckFn, notApplicable } from './types';

const MIN_WORDS = 300;
const MIN_ITEMS = 3;

const WORD = String.raw`[\p{L}\p{N}][\p{L}\p{N}'’-]*`;
/** A short list item: one to three words. */
const ITEM = String.raw`${WORD}(?:\s+${WORD}){0,2}`;
/**
 * A serial enumeration: "a fine grind, a high dose, or hot water". Items are
 * short so that clauses joined by commas ("When the grind is fine, the shot
 * runs slow, and ...") do not match. The comma run is capped so a long
 * comma-separated line without "and"/"or" fails fast instead of backtracking
 * from every start; a longer enumeration still matches on its last items.
 */
const SERIAL = new RegExp(
  String.raw`(?<![\p{L}\p{N}'’-])${ITEM}(?:\s*,\s*${ITEM}){1,12}\s*,?\s+(?:and|or)\s+${ITEM}`,
  'iu',
);

/**
 * A discourse opener set off by a comma ("For example, salt and pepper", "In 2024, cafes"). It
 * is not a list item, so it is blanked before looking for an enumeration.
 */
const OPENER =
  /(?<![\p{L}\p{N}'’-])(?:for (?:example|instance)|however|of course|in (?:\d{4}|fact|short|practice|addition|general|the end)|as a result|e\.g\.?|i\.e\.?|finally|meanwhile|indeed|instead|usually|often|sometimes|today)\s*,/giu;

/** True when `text` holds a serial enumeration once discourse openers are set aside. */
const serial = (text: string): boolean =>
  SERIAL.test(text.replace(OPENER, (m) => ' '.repeat(m.length)));

/** True when a sentence names three or more items separated by commas or semicolons. */
function enumerates(s: Sentence): boolean {
  const parts = s.plain.split(';').filter((part) => /[\p{L}\p{N}]/u.test(part));
  return parts.length >= MIN_ITEMS || serial(s.plain);
}

export const check: CheckFn = (a) => {
  if (a.wordCount < MIN_WORDS) return notApplicable('lists');

  const longestList = Math.max(0, ...a.lists.map((l) => l.itemCount));
  const prose = a.paragraphs.filter(isProse);
  const enumerating = prose.filter((p) => p.sentences.some(enumerates));
  const metrics = {
    lists: a.lists.length,
    longestList,
    enumeratingParagraphs: enumerating.length,
  };
  const out = issueCollector('lists', a.markdown);
  const result = (score: number) => ({
    checkId: 'lists' as const,
    applicable: true,
    score,
    findings: out.findings,
    suggestions: out.suggestions,
    metrics,
  });

  if (longestList >= MIN_ITEMS) return result(1);

  for (const p of enumerating) {
    out.add({
      range: p.range,
      message: 'This paragraph runs three or more items together in a sentence.',
      title: 'Turn this enumeration into a list',
      rationale:
        'Steps, options and causes written as a bulleted or numbered list are easier to scan, and each item can be quoted on its own.',
    });
  }
  if (enumerating.length > 0) return result(0.5);

  // The longest paragraph by words; the first one wins a tie.
  const sized = prose.map((p) => ({ p, n: countWords(p.plain) }));
  const longest = sized.reduce<(typeof sized)[number] | undefined>(
    (best, x) => (best && best.n >= x.n ? best : x),
    undefined,
  )?.p;
  if (longest) {
    out.add({
      range: longest.range,
      message: `The draft has ${a.wordCount} words and no list of ${MIN_ITEMS} or more items.`,
      title: 'Look for steps or options to list',
      rationale:
        'This is the longest paragraph in a draft without a list. If it walks through steps, options or causes, a bulleted or numbered list makes them easier to scan.',
    });
  }
  return result(0);
};
