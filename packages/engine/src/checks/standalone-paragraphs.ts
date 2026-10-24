// Adapted from aiseo-audit (https://github.com/agencyenterprise/aiseo-audit),
// src/modules/entity-clarity/pronouns.ts, v2.1.2, commit
// 6c888aa54856d543409d24a1befe226fe1e0f5a9, MIT License, Copyright (c) 2026
// aiseo-audit contributors. Kept: the "paragraph opens with a pronoun subject"
// test. Changed: the opener list (adds "such", "the above", "as mentioned";
// drops "he" and "she"), a 40 to 150 word window in place of the 25-word
// floor, a per-paragraph score and a per-paragraph advisory, Markdown
// paragraphs from the gathered artifacts instead of HTML <p> elements, "this",
// "that", "these" and "those" used as a determiner ("This grinder works") not
// flagged, and a list lead-in ("Check these:" before a list) not judged.

import nlp from 'compromise/two';
import type { Artifacts, Paragraph } from '../gather';
import { countWords } from '../text';
import { isProse, issueCollector, words } from './structure-issues';
import { type CheckFn, notApplicable } from './types';

const MIN_WORDS = 40;
const MAX_WORDS = 150;

/** A paragraph opening that points back to text the reader of a lifted quote never saw. */
const UNRESOLVED_OPENER =
  /^(?:this|that|these|those|it|they|such|the above|as mentioned)(?![\p{L}\p{N}])/iu;

/** Quote marks and brackets that may precede the first word. */
const LEADING_PUNCTUATION = /^[\s"'“‘(]+/u;

const DEMONSTRATIVES = new Set(['this', 'that', 'these', 'those']);

/**
 * True when a demonstrative opener is a determiner ("This grinder", "These new burrs"): a noun
 * or adjective follows it (compromise part-of-speech tags), so the paragraph names its subject.
 */
function isDeterminer(opener: string, text: string): boolean {
  if (!DEMONSTRATIVES.has(opener.toLowerCase())) return false;
  const first = (nlp(text.slice(0, 200)).json() as { terms: { tags: string[] }[] }[])[0];
  const tags = first?.terms[1]?.tags ?? [];
  if (tags.includes('Verb') || tags.includes('Pronoun')) return false;
  return tags.includes('Noun') || tags.includes('Adjective');
}

/**
 * True for a list lead-in: a paragraph that ends in ":" with a list or table right after it
 * ("There are a few things worth checking:"). It introduces the list, so it is not judged alone.
 */
function isLeadIn(a: Artifacts, p: Paragraph): boolean {
  if (!p.text.trimEnd().endsWith(':')) return false;
  return [...a.lists, ...a.tables].some(
    (b) =>
      b.range.start >= p.range.end && a.markdown.slice(p.range.end, b.range.start).trim() === '',
  );
}

export const check: CheckFn = (a) => {
  const paragraphs = a.paragraphs.filter((p) => isProse(p) && !isLeadIn(a, p));
  if (paragraphs.length === 0) return notApplicable('standalone-paragraphs');

  const out = issueCollector('standalone-paragraphs', a.markdown);
  let standalone = 0;
  let unresolvedOpeners = 0;
  let tooShort = 0;
  let tooLong = 0;

  for (const p of paragraphs) {
    const lead = p.plain.replace(LEADING_PUNCTUATION, '');
    const match = UNRESOLVED_OPENER.exec(lead)?.[0];
    const opener = match && !isDeterminer(match, lead) ? match : undefined;
    const n = countWords(p.plain);
    const problems: string[] = [];
    if (opener) {
      unresolvedOpeners++;
      problems.push(
        `It opens with "${opener}", which points back to earlier text, so a reader who sees only this paragraph cannot tell what it refers to.`,
      );
    }
    if (n < MIN_WORDS) {
      tooShort++;
      problems.push(
        `It has ${words(n)}, too short to carry its point alone (aim for ${MIN_WORDS} to ${MAX_WORDS}).`,
      );
    } else if (n > MAX_WORDS) {
      tooLong++;
      problems.push(
        `It has ${words(n)}, long enough to hold several points (aim for ${MIN_WORDS} to ${MAX_WORDS}).`,
      );
    }
    if (problems.length === 0) {
      standalone++;
      continue;
    }
    out.add({
      range: p.range,
      message: problems.join(' '),
      title: 'Make this paragraph stand on its own',
      rationale:
        'Answer engines often quote a single paragraph without the text around it. A paragraph that names its subject and makes one complete point in 40 to 150 words still reads clearly when lifted out.',
    });
  }

  return {
    checkId: 'standalone-paragraphs',
    applicable: true,
    score: standalone / paragraphs.length,
    findings: out.findings,
    suggestions: out.suggestions,
    metrics: { paragraphs: paragraphs.length, standalone, unresolvedOpeners, tooShort, tooLong },
  };
};
