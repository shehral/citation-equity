import { measuredNote } from '../e1';
import { EVIDENCE } from '../evidence';
import type { Artifacts, Heading } from '../gather';
import { countWords, type Sentence, suggestionId } from '../text';
import type { CheckResult, Finding, Range, Suggestion } from '../types';
import { isProse, topOfDraft, words } from './structure-issues';
import { type CheckFn, notApplicable } from './types';

const MIN_WORDS = 8;
const MAX_WORDS = 40;
/** Share of the question's content terms a heading needs to count as its section. */
const HEADING_MATCH = 0.5;
/** Share of the question's content terms the answering sentence must contain. */
const ANSWER_MATCH = 0.6;

/** Function words, question words and auxiliaries that say nothing about the topic. */
const STOPWORDS = new Set(
  (
    'a an the and or but if then so of to in on at by for from with about into over under ' +
    'as than that this these those there here it its is are was were be been being am ' +
    'do does did done doing have has had having can could should would will shall may might ' +
    'must i me my we our us you your he him his she her they them their what which who whom ' +
    'whose when where why how not no yes s t d ll re ve m don doesn didn isn aren wasn weren ' +
    'any some all each every much many more most very just also too get got'
  ).split(' '),
);

/** True when a stem keeps a vowel, so "bring" and "shed" are not cut to "br" and "sh". */
const hasVowel = (w: string): boolean => /[aeiouy]/.test(w);

/**
 * A light suffix stemmer: plural and verb endings ("-ies", "-es", "-s", "-ing", "-ed") are
 * cut when a vowel is left, then a doubled final consonant ("stopp") and a final "e", so
 * "takes", "taking" and "take" meet at "tak". "-eed" ("need") keeps its "ed".
 */
function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ing') && hasVowel(w.slice(0, -3))) w = w.slice(0, -3);
  else if (w.endsWith('ed') && !w.endsWith('eed') && hasVowel(w.slice(0, -2))) w = w.slice(0, -2);
  else if (/(?:ch|sh|x|z|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(?:ll|ss|zz)$/.test(w))
    w = w.slice(0, -1);
  if (w.length > 2 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

const tokens = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** All stemmed words of a text, stopwords included. */
const allTerms = (text: string): Set<string> => new Set(tokens(text).map(stem));

/**
 * The content terms of a question: lowercased, stopwords removed, stemmed. A question made
 * only of stopwords ("What is it?") keeps all its words, so it can still be matched.
 */
export function contentTerms(text: string): Set<string> {
  const words = tokens(text);
  const content = words.filter((w) => !STOPWORDS.has(w));
  return new Set((content.length > 0 ? content : words).map(stem));
}

/** How many of `terms` occur in `text`. */
function hits(terms: Set<string>, text: string): number {
  const present = allTerms(text);
  let n = 0;
  for (const t of terms) if (present.has(t)) n++;
  return n;
}

/** Share of `terms` that occur in `text` (0 when `terms` is empty). */
const share = (terms: Set<string>, text: string): number =>
  terms.size === 0 ? 0 : hits(terms, text) / terms.size;

type Target =
  | { kind: 'section'; heading: Heading; sentence: Sentence | undefined }
  | { kind: 'paragraph'; sentence: Sentence }
  | null;

/** The H2/H3 section that best matches the question, else the best-matching paragraph. */
function findTarget(a: Artifacts, terms: Set<string>): Target {
  let best: { score: number; index: number; heading: Heading } | undefined;
  for (const [index, section] of a.sections.entries()) {
    const heading = section.headingIndex === null ? undefined : a.headings[section.headingIndex];
    if (!heading) continue;
    const score = share(terms, heading.text);
    if (score >= HEADING_MATCH && (best === undefined || score > best.score))
      best = { score, index, heading };
  }
  if (best) {
    const first = a.sections[best.index]?.paragraphIndices
      .map((i) => a.paragraphs[i])
      .find((p) => p !== undefined && isProse(p));
    return { kind: 'section', heading: best.heading, sentence: first?.sentences[0] };
  }

  let bestSentence: { score: number; sentence: Sentence } | undefined;
  for (const p of a.paragraphs) {
    const sentence = p.sentences[0];
    if (!sentence || !isProse(p)) continue;
    const score = share(terms, sentence.plain);
    if (score > 0 && (bestSentence === undefined || score > bestSentence.score))
      bestSentence = { score, sentence };
  }
  return bestSentence ? { kind: 'paragraph', sentence: bestSentence.sentence } : null;
}

/** Why the target does not answer the question, or null when it does. */
function problem(target: Target, terms: Set<string>): string | null {
  if (target === null)
    return 'No heading or paragraph in the draft uses the key words of this question.';
  const where = target.kind === 'section' ? 'section' : 'paragraph';
  const sentence = target.sentence;
  if (!sentence) return 'The matching section has no sentence that answers this question.';
  const plain = sentence.plain.trim();
  if (plain.endsWith('?'))
    return `The matching ${where} opens with a question instead of an answer.`;
  const n = countWords(plain);
  if (n < MIN_WORDS || n > MAX_WORDS)
    return `The first sentence of the matching ${where} has ${words(n)}; a direct answer runs ${MIN_WORDS} to ${MAX_WORDS}.`;
  const found = hits(terms, plain);
  if (found < ANSWER_MATCH * terms.size)
    return `The first sentence of the matching ${where} uses ${found} of the question's ${terms.size} key words.`;
  return null;
}

const RATIONALE = `Answer engines lean on pages that address the question directly: in controlled tests, edits that made a page more relevant to the question raised how often models used it (ConflictingQA, SAGEO Arena), but pages missing the question's terms lost the first citation reliably in only four of six models (What Gets Cited). Open the section that covers this question, or add one, with one plain sentence of ${MIN_WORDS} to ${MAX_WORDS} words that answers it in the question's own words, and state only what is true. ${measuredNote(EVIDENCE['question-coverage'].e1)} Evidence grade: ${EVIDENCE['question-coverage'].grade}.`;

/** One target question: whether the draft answers it, and the text to show for it. */
export interface QuestionCoverage {
  question: string;
  covered: boolean;
  /**
   * Covered: the heading (or sentence) of the section that answers it. Not covered: where the
   * advisory points, the matching heading or sentence, else the top of the draft.
   */
  range: Range;
  /** Why the draft does not answer it; null when covered. */
  message: string | null;
}

/** Each non-blank question (trimmed, in order) with its coverage, as the check judges it. */
export function questionCoverage(a: Artifacts, questions: string[]): QuestionCoverage[] {
  return questions
    .map((q) => q.trim())
    .filter((q) => q !== '')
    .map((question) => {
      const terms = contentTerms(question);
      const target = findTarget(a, terms);
      const message = problem(target, terms);
      const range: Range =
        target === null
          ? topOfDraft(a)
          : target.kind === 'section'
            ? target.heading.range
            : target.sentence.range;
      return { question, covered: message === null, range, message };
    });
}

/**
 * For each target question, finds the section (or paragraph) that matches it and checks that
 * its first sentence answers it: 8 to 40 words, not a question, with at least 60% of the
 * question's content terms. Applies only when target questions are given.
 */
export const check: CheckFn = (a, ctx): CheckResult => {
  const rows = questionCoverage(a, ctx?.questions ?? []);
  if (rows.length === 0) return notApplicable('question-coverage');

  const findings: Finding[] = [];
  const suggestions: Suggestion[] = [];
  const seen = new Map<string, number>();
  let covered = 0;
  for (const { question, range, message } of rows) {
    if (message === null) {
      covered++;
      continue;
    }
    const before = a.markdown.slice(range.start, range.end);
    // The question is part of the id, so reordering questions keeps each advisory's status.
    const key = `${question}\n${before}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    findings.push({ checkId: 'question-coverage', range, message });
    suggestions.push({
      id: suggestionId('question-coverage', key, occurrence),
      checkId: 'question-coverage',
      kind: 'advisory',
      range,
      before,
      title: `Answer "${question}" directly`,
      rationale: `${message} ${RATIONALE}`,
      grade: EVIDENCE['question-coverage'].grade,
    });
  }
  return {
    checkId: 'question-coverage',
    applicable: true,
    score: covered / rows.length,
    findings,
    suggestions,
    metrics: { questions: rows.length, covered },
  };
};
