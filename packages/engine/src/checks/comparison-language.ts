/*
 * Comparison patterns adapted from:
 * - geo-lint (https://github.com/IJONIS/geo-lint), src/rules/geo-freshness-rules.ts
 *   `COMPARISON_PATTERNS` and rule `geo-comparison-table`, npm @ijonis/geo-lint 0.2.1,
 *   MIT License, Copyright (c) 2026 IJONIS.
 * - aiseo-audit (https://github.com/agencyenterprise/aiseo-audit),
 *   src/modules/product-fit/index.ts `COMPARISON_LANGUAGE`, npm aiseo-audit 2.1.2,
 *   MIT License, Copyright (c) 2026 aiseo-audit contributors.
 * Changes: English patterns only; headings and prose use separate patterns. Shared by the
 * tables check (which sections compare options) and the comparisons check (whether the draft
 * compares anything at all), which adds wider phrases ("than", "unlike", "instead of",
 * "alternatives", "which is better") and "X or Y" question headings.
 */

/** Comparison words in a heading ("Moka pot vs espresso machine", "Comparing grinders"). */
export const COMPARISON_HEADING =
  /\b(?:vs\b\.?|versus\b|compar(?:e|es|ed|ing|ison|isons)\b|differences? between\b|pros and cons\b)/i;
/** Comparison phrases in prose; narrower, since "compare" alone is common in prose. */
export const COMPARISON_PROSE =
  /\b(?:vs\b\.?|versus\b|compared (?:to|with)\b|differences? between\b)/i;

/** Phrases that set options side by side, on top of COMPARISON_PROSE. */
const WIDER =
  /\b(?:unlike|instead of|rather than|alternatives?|pros and cons|which (?:one )?is better)\b/i;
/**
 * "than" between two things ("brighter than dark roasts"), but not a quantity bound
 * ("more than 25 seconds") or an exception ("other than the barista").
 */
const THAN = /(?<!\bother\s+)\bthan\b(?!\s+\d)/gi;
/** Idioms that compare nothing whatever comes before: "less than ideal", "more than enough". */
const THAN_IDIOM =
  /\b(?:more|less|fewer|no)\s+than\s+(?:ideal|enough|ever|usual|once|twice|half)\b/iy;
/** "more than a ...", which compares ("costs more than a latte") unless it follows a copula. */
const THAN_ARTICLE = /\b(?:more|less|fewer|no)\s+than\s+(?:a|an)\b/iy;
/**
 * A copula, or "like", with an optional degree word, just before "more than a": "is more than a
 * hobby", "is much more than a drink", "felt like no more than a guess". That names what
 * something is; it does not set two things side by side.
 */
const COPULA_BEFORE =
  /(?:\b(?:is|are|was|were|be|been|being|am|become|becomes|became|seems?|seemed|feels?|felt|like)|'s|'re|’s|’re)\s+(?:(?:much|far|so|really|truly|even|way|little|no|nothing|something)\s+)?$/i;

/** True when some "than" in `text` sets two things side by side. */
function comparesWithThan(text: string): boolean {
  for (const m of text.matchAll(THAN)) {
    const before = /\b(?:more|less|fewer|no)\s+$/i.exec(text.slice(0, m.index));
    if (!before) return true;
    THAN_IDIOM.lastIndex = before.index;
    if (THAN_IDIOM.test(text)) continue;
    THAN_ARTICLE.lastIndex = before.index;
    if (THAN_ARTICLE.test(text) && COPULA_BEFORE.test(text.slice(0, before.index))) continue;
    return true;
  }
  return false;
}

/** True when a sentence or table row compares options in so many words. */
export function hasComparisonLanguage(text: string): boolean {
  return COMPARISON_PROSE.test(text) || WIDER.test(text) || comparesWithThan(text);
}

/**
 * True for a comparison heading, including an "X or Y" question that ends with "?" ("Burr or
 * blade grinder?"); "How to clean or descale the boiler" asks no choice.
 */
export function isComparisonHeading(text: string): boolean {
  return (
    COMPARISON_HEADING.test(text) ||
    hasComparisonLanguage(text) ||
    (/\bor\b/i.test(text) && /\?\s*$/.test(text))
  );
}
