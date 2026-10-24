// Adapted from geo-lint (https://github.com/IJONIS/geo-lint),
// src/utils/geo-analyzer.ts (countQuestionHeadings, QUESTION_WORDS), v0.2.1,
// commit b2d79319d1d0d4d4fc5d6abbc4ce5156afc5d14b, MIT License, Copyright (c)
// 2026 IJONIS; and from aiseo-audit
// (https://github.com/agencyenterprise/aiseo-audit),
// src/modules/answerability/questions.ts (INTERROGATIVES), v2.1.2, commit
// 6c888aa54856d543409d24a1befe226fe1e0f5a9, MIT License, Copyright (c) 2026
// aiseo-audit contributors. Kept: a heading is a question when it ends with
// "?" or its first word is an interrogative or auxiliary. Changed: English
// only, the word lists merged and extended with contractions, H2/H3 only, a
// share-of-headings score, and per-heading suggestions (a "?" edit for an
// interrogative-led heading, with a rewording note when it is not inverted;
// an advisory, not counted, when a subject follows the question word, as in
// "How it works"; hyphenated compounds and "May 2024" are not auxiliaries)
// in place of a single threshold warning.

import { issueCollector } from './structure-issues';
import { type CheckFn, notApplicable } from './types';

const INTERROGATIVES = new Set([
  'what',
  'how',
  'why',
  'when',
  'where',
  'who',
  'whom',
  'whose',
  'which',
]);

// biome-ignore format: grouped by verb
const AUXILIARIES = new Set([
  'am', 'is', 'are', 'was', 'were',
  'do', 'does', 'did',
  'has', 'have', 'had',
  'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would',
  "isn't", "aren't", "wasn't", "weren't",
  "don't", "doesn't", "didn't",
  "hasn't", "haven't", "hadn't",
  "can't", "couldn't", "mustn't", "shouldn't", "won't", "wouldn't",
]);

/** Words after "how" that keep the question inverted ("How long does it take"). */
const HOW_DEGREE = new Set(['much', 'many', 'long', 'often', 'far', 'old', 'big', 'soon']);

/**
 * Lowercase words of a heading, apostrophes normalised to `'`. A hyphenated compound is one
 * word, so "Must-have tools" does not open with the auxiliary "must".
 */
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];

/**
 * Subject pronouns and possessives. After a question word they make a relative clause, not a
 * question: "What we learned", "How it works", "Who we are", "Why your shot runs fast".
 */
// biome-ignore format: one list
const SUBJECTS = new Set([
  'i', 'we', 'you', 'it', 'they', 'he', 'she', 'this', 'that', 'these', 'those',
  'my', 'our', 'your', 'its', 'their', 'his', 'her',
]);

/**
 * True when a bare question word is followed by a subject pronoun or possessive. A contraction
 * ("What's your budget", "Who's it for") carries its auxiliary, so it is a question.
 */
const isRelativeClause = (w: string[]): boolean =>
  INTERROGATIVES.has(w[0] ?? '') && SUBJECTS.has((w[1] ?? '').split("'")[0] ?? '');

/**
 * True when the first word is an auxiliary that opens a question ("Does grind size matter"),
 * not a month or a label ("May 2024 update"): a word follows, and it is not a number.
 */
const opensWithAuxiliary = (w: string[]): boolean =>
  AUXILIARIES.has(w[0] ?? '') && w[1] !== undefined && !/^\p{N}/u.test(w[1]);

/** "what's" is "what is": an interrogative with the auxiliary attached. */
const interrogativeBase = (word: string): string | undefined => {
  const base = word.endsWith("'s") ? word.slice(0, -2) : word;
  return INTERROGATIVES.has(base) ? base : undefined;
};

/**
 * True when a wh-heading reads as a direct question, so "?" alone completes it:
 * "How do I fix it", "What's crema", "How much coffee should I use", "Which
 * grinder is best". "How to fix it" and "Why espresso turns bitter" are not inverted, so
 * their "?" edit carries a note to consider rewording.
 */
function isInvertedQuestion(w: string[]): boolean {
  const [first = '', second = '', third = '', fourth = ''] = w;
  if (first.endsWith("'s")) return true;
  if (AUXILIARIES.has(second)) return true;
  if (first === 'how' && HOW_DEGREE.has(second)) {
    if (AUXILIARIES.has(third)) return true;
    return (second === 'much' || second === 'many') && AUXILIARIES.has(fourth);
  }
  return (first === 'which' || first === 'what' || first === 'whose') && AUXILIARIES.has(third);
}

/**
 * True when a heading is already a question a reader would ask: it ends with "?", opens with
 * an auxiliary ("Does grind size matter"), or is an inverted wh-question ("How long should it
 * steep"). "How to store it" and "Why it matters" are not.
 */
export function readsAsQuestion(text: string): boolean {
  if (text.trimEnd().endsWith('?')) return true;
  const w = wordsOf(text);
  if (opensWithAuxiliary(w)) return true;
  return interrogativeBase(w[0] ?? '') !== undefined && isInvertedQuestion(w);
}

/** True when the first word is a question word ("how to store it", "what's crema"). */
export const startsWithInterrogative = (text: string): boolean =>
  interrogativeBase(wordsOf(text)[0] ?? '') !== undefined;

/** True for a question word followed by a subject ("How it works"): a label, not a question. */
export const isRelativeClauseHeading = (text: string): boolean => isRelativeClause(wordsOf(text));

export const check: CheckFn = (a) => {
  // A heading with no words (a bare `##`) says nothing to judge.
  const headings = a.headings.filter(
    (h) => (h.depth === 2 || h.depth === 3) && wordsOf(h.text).length > 0,
  );
  if (headings.length < 2) return notApplicable('question-headings');

  const out = issueCollector('question-headings', a.markdown);
  let questionHeadings = 0;
  let missingQuestionMark = 0;

  for (const h of headings) {
    const w = wordsOf(h.text);
    const interrogative = interrogativeBase(w[0] ?? '') !== undefined;
    // A "?" anywhere ("Why widgets? 🚀") already marks the question; no edit is offered.
    const hasMark = h.text.includes('?');
    if (!hasMark && isRelativeClause(w)) {
      out.add({
        range: h.range,
        message: `"${h.text}" starts with a question word but reads as a statement, not a question.`,
        title: 'Reword this heading as a question',
        rationale:
          'A question word followed by "we", "it", "you" or a similar word makes a label ("How it works", "What we learned"), and a "?" alone would not turn it into a question. If the section answers a question, reword the heading as the question a reader would ask, such as "How does it work?". Rewording is left to you.',
      });
      continue;
    }
    if (hasMark || interrogative || opensWithAuxiliary(w)) {
      questionHeadings++;
      if (hasMark || !interrogative) continue;
      missingQuestionMark++;
      const raw = a.markdown.slice(h.range.start, h.range.end);
      const after = `${raw.replace(/[\s.:;,!]+$/u, '')}?`;
      if (isInvertedQuestion(w)) {
        out.add({
          range: h.range,
          message: 'This heading asks a question but does not end with "?".',
          title: 'End this question heading with "?"',
          rationale:
            'The heading is already phrased as a question. A question mark makes that explicit for readers and for tools that match headings to the questions people ask.',
          after,
        });
      } else {
        out.add({
          range: h.range,
          message: 'This heading starts with a question word but does not end with "?".',
          title: 'End this heading with "?", or reword it as a question',
          rationale:
            'The heading opens with a question word, so a question mark marks it as the question the section answers. It does not read as a full question yet ("How to fix bitter espresso" rather than "How do I fix bitter espresso"), so if "?" alone reads oddly, reword it into the question a reader would ask instead of applying this edit.',
          after,
        });
      }
      continue;
    }
    out.add({
      range: h.range,
      message: `"${h.text}" is a statement, not a question.`,
      title: 'Phrase this heading as a question',
      rationale:
        'Headings phrased as the question a reader would ask, such as "How do I fix bitter espresso?", line up the section with the queries people type. Rewording is left to you, since a template cannot know which question the section answers.',
    });
  }

  return {
    checkId: 'question-headings',
    applicable: true,
    score: questionHeadings / headings.length,
    findings: out.findings,
    suggestions: out.suggestions,
    metrics: { headings: headings.length, questionHeadings, missingQuestionMark },
  };
};
