/*
 * Statistic detection adapted from:
 * - geo-lint (https://github.com/IJONIS/geo-lint), src/utils/geo-analyzer.ts
 *   `countStatistics`, npm @ijonis/geo-lint 0.2.1, MIT License, Copyright (c) 2026 IJONIS.
 * - aiseo-audit (https://github.com/agencyenterprise/aiseo-audit),
 *   src/modules/grounding-signals/patterns.ts `NUMERIC_CLAIM_PATTERNS`, npm aiseo-audit 2.1.2,
 *   MIT License, Copyright (c) 2026 aiseo-audit contributors.
 * - aeo-linter (https://github.com/DrowLink/aeo-audit-linter),
 *   src/gather/gatherers/direct-answers-gatherer.ts percentage and numerical-metric patterns,
 *   npm @drowlink/aeo-linter-core 0.3.0, MIT License, Copyright (c) AEO Linter Contributors.
 * Changes: the percent, currency, multiplier, scale and unit patterns are merged into one
 * matcher over the prose mask (so code, HTML and front matter never count); number ranges
 * count once; four-digit numbers no longer count on their own (a year-like number from 1900
 * to 2099 needs a percent, currency, scale or unit, and a decade like "1990s" never counts);
 * a bare count counts only when a noun follows it (compromise part-of-speech tags) and no
 * label precedes it ("Section 4"); clock times and ratios are skipped; the density is per
 * 300 words and the advice points at the longest section without a statistic.
 */
import nlp from 'compromise/two';
import { EVIDENCE } from '../evidence';
import type { Artifacts } from '../gather';
import { countWords } from '../text';
import type { CheckResult, Range } from '../types';
import { suggester } from './data-support';
import { topOfDraft } from './structure-issues';
import { type CheckFn, notApplicable } from './types';

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const CURRENCY = '[$€£¥]';
/**
 * A number, an optional currency sign before it and an optional range (`25 to 30`,
 * `$400-$700`). It must not continue a word or another number (`H2`, `OCR-3`, `1.2.3`), and
 * clock times and ratios (`7:30`, `1:2`) are not statistics.
 */
const CANDIDATE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.,:$€£¥])(?<!\p{L}-)(${CURRENCY}\s?)?(${NUMBER})(?:\s*(?:-|–|to)\s*${CURRENCY}?(?:${NUMBER}))?(?!\p{N}|[:.,]\p{N})`,
  'gu',
);
/** A label before a number ("Section 4", "step 3"): the number names a part, it counts nothing. */
const LABEL =
  /\b(?:step|section|chapter|figure|fig\.|table|page|part|version|level|rule|item|no\.|number|line|phase|stage|round)\s*$/i;
const UNITS = [
  // mass, volume, length
  'µg|mg|g|kg|lbs?|oz|ml|mL|cl|dl|l|L|mm|cm|m|km|ft|yd|mi',
  // time
  'ms|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?',
  // temperature, pressure, energy, data, speed
  '°\\s?[CF]|°|bar|psi|kPa|W|kW|kWh|V|mAh|Hz|kHz|MHz|GHz|KB|kB|MB|GB|TB|mph|km/h|kph|kcal|cal|calories',
  // money words
  'USD|EUR|GBP|dollars?|euros?',
].join('|');
/**
 * Percent, multiplier or scale after a number: these count even after a year-like number. A
 * capital K, M or B right after the number is a scale ("1.5M downloads", "$5M", "2B parameters").
 */
const RATIO_OR_SCALE =
  /^(?:\s?(?:%|‰)|[KMB](?![\p{L}\p{N}])|\s*(?:percent|per\s?cent|percentage\s+points?|x|×|times|thousand|million|billion|trillion|k|bn)(?![\p{L}\p{N}]))/u;
const SCALE_LETTER = /^[KMB]$/;
const UNIT = new RegExp(String.raw`^\s*(?:${UNITS})(?![\p{L}\p{N}])`, 'u');
const NEXT_WORD = /^\s+(?=\p{L})/u;
const YEAR = /^(?:19|20)\d\d$/;

interface Term {
  start: number;
  end: number;
  tags: string[];
}
interface CompromiseTerm {
  tags: string[];
  offset: { start: number; length: number };
}

function tagTerms(text: string): Term[] {
  const sentences = nlp(text).json({ offset: true }) as { terms: CompromiseTerm[] }[];
  return sentences.flatMap((s) =>
    s.terms.map((t) => ({
      start: t.offset.start,
      end: t.offset.start + t.offset.length,
      tags: t.tags,
    })),
  );
}

const isNoun = (t: Term) => t.tags.includes('Noun') && !t.tags.includes('Pronoun');

/**
 * Statistics in a prose string: numbers with a percent sign, a unit, a currency or a scale,
 * and counts followed by a noun ("40 home baristas"). Bare years, ordinals ("2nd") and
 * numbers inside identifiers do not count. Ranges index into `text`.
 */
export function findStatistics(text: string): Range[] {
  const found: Range[] = [];
  let terms: Term[] | undefined;
  for (const m of text.matchAll(CANDIDATE)) {
    const start = m.index;
    const end = start + m[0].length;
    const rest = text.slice(end);
    const ratio = RATIO_OR_SCALE.exec(rest);
    // "Figure 3B" names a part; "3B parameters" is a scale.
    const label = () => LABEL.test(text.slice(Math.max(0, start - 12), start));
    if (ratio && SCALE_LETTER.test(ratio[0]) && label()) continue;
    if (ratio) {
      found.push({ start, end: end + ratio[0].length });
      continue;
    }
    if (m[1] !== undefined) {
      found.push({ start, end });
      continue;
    }
    // A year-like number counts only with a unit, and never as a decade ("1990s").
    const year = YEAR.test(m[2] ?? '');
    const unit = UNIT.exec(rest);
    if (unit && !(year && unit[0] === 's')) {
      found.push({ start, end: end + unit[0].length });
      continue;
    }
    if (year) continue;
    // A bare count: it needs a noun after it, possibly behind adjectives or noun modifiers.
    const gap = NEXT_WORD.exec(rest);
    if (!gap || label()) continue;
    terms ??= tagTerms(text);
    let i = terms.findIndex((t) => t.start === end + gap[0].length);
    if (i < 0) continue;
    let nounEnd = -1;
    for (let n = 0; n < 3 && i < terms.length; n++, i++) {
      const t = terms[i];
      if (!t || !(isNoun(t) || t.tags.includes('Adjective'))) break;
      if (isNoun(t)) nounEnd = t.end;
    }
    if (nounEnd > 0) found.push({ start, end: nounEnd });
  }
  return found;
}

/**
 * A table's cell text with the same length as its source: pipes, the delimiter row and
 * inline code become spaces, so statistic offsets still index into the source.
 */
function tableProse(source: string): string {
  const lines = source
    .split('\n')
    .map((line, i) => (i === 1 && /^[\s|:-]+$/.test(line) ? ' '.repeat(line.length) : line));
  return lines
    .join(' ')
    .replace(/`[^`]*`/g, (code) => ' '.repeat(code.length))
    .replace(/\|/g, ' ');
}

export const check: CheckFn = (a: Artifacts): CheckResult => {
  if (a.wordCount < 150) return notApplicable('statistics');

  const statsBySection = new Map<number, number>();
  const wordsBySection = new Map<number, number>();
  const add = (map: Map<number, number>, key: number, n: number) =>
    map.set(key, (map.get(key) ?? 0) + n);
  let statistics = 0;
  for (const p of a.paragraphs) {
    // Footnote definitions hold sources ("Example Lab report, 2024"), not the page's figures.
    if (p.inFootnote) continue;
    const n = findStatistics(p.plain).length;
    statistics += n;
    add(statsBySection, p.sectionIndex, n);
    add(wordsBySection, p.sectionIndex, countWords(p.plain));
  }
  for (const t of a.tables) {
    const n = findStatistics(tableProse(a.markdown.slice(t.range.start, t.range.end))).length;
    statistics += n;
    add(statsBySection, t.sectionIndex, n);
  }

  const score = Math.min(1, (statistics * 300) / a.wordCount);
  const prose = a.sections
    .map((section, index) => ({ section, words: wordsBySection.get(index) ?? 0, index }))
    .filter((s) => s.words > 0);
  const without = prose.filter((s) => (statsBySection.get(s.index) ?? 0) === 0);
  const result: CheckResult = {
    checkId: 'statistics',
    applicable: true,
    score,
    findings: [],
    suggestions: [],
    metrics: { statistics, words: a.wordCount, sectionsWithoutStatistics: without.length },
  };
  if (score >= 1) return result;

  // The longest section without a statistic, or the longest section if all have one.
  const pool = without.length > 0 ? without : prose;
  const target = pool.reduce<(typeof pool)[number] | undefined>(
    (best, s) => (best === undefined || s.words > best.words ? s : best),
    undefined,
  );
  if (!target) return result;
  // Anchored on the section's heading (or the top of the draft for the lead section), so the
  // advisory keeps its id, and the author's ignore or done, while the section's text is edited.
  const { headingIndex } = target.section;
  const range =
    headingIndex === null ? topOfDraft(a) : (a.headings[headingIndex]?.range ?? topOfDraft(a));
  const before = a.markdown.slice(range.start, range.end);
  const message =
    without.length > 0
      ? `This section has ${target.words} words and no statistic.`
      : `The draft has ${statistics} statistics in ${a.wordCount} words, under 1 per 300 words.`;
  result.findings.push({ checkId: 'statistics', range, message });
  result.suggestions.push(
    suggester('statistics')({
      kind: 'advisory',
      range,
      before,
      title: 'Add a concrete number to this section',
      rationale: `${message} A specific figure with its unit, such as a percentage, an amount, a duration or a count of things, gives a reader something exact to check and quote. Bare years and list numbers do not count. Add only real figures from a source you can name or link. In the larger studies, adding statistics for their own sake did not help and often lowered a page's citation rank (C-SEO Bench). Evidence grade: ${EVIDENCE.statistics.grade}.`,
    }),
  );
  return result;
};
