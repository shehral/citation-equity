import { measuredNote } from '../e1';
import { EVIDENCE } from '../evidence';
import type { Artifacts, Paragraph } from '../gather';
import { questionKey } from '../import-queries';
import { pageQuestionsOf } from '../questions';
import { suggestionId } from '../text';
import type { CheckResult, Finding, Suggestion } from '../types';
import { allTerms, keyWords } from './question-coverage';
import { readsAsQuestion } from './question-headings';
import { isProse, topOfDraft } from './structure-issues';
import { type CheckFn, notApplicable } from './types';

/** The most missing words one piece of advice names, so it never reads as a list to paste in. */
export const MAX_NAMED = 3;

/**
 * The text a reader (and an answer engine) meets first. Our own test (E1, arm 12) worked the
 * query's missing key terms into the title (the first H1), the first heading after it and the
 * first body paragraph. A question section (one whose heading reads as a question) does not push
 * those down: the top is the title, every heading down to the first one that is not a question,
 * and every body paragraph down to the first one outside a question section. So adding a
 * question section, anywhere, only ever adds to the top.
 */
function topText(a: Artifacts): string {
  const title = a.headings.find((h) => h.depth === 1);
  const headings = upTo(
    a.headings.filter((h) => h !== title),
    (h) => !readsAsQuestion(h.text),
  );
  const inQuestionSection = (p: Paragraph): boolean => {
    const index = a.sections[p.sectionIndex]?.headingIndex;
    const heading = index === null || index === undefined ? undefined : a.headings[index];
    return heading !== undefined && heading !== title && readsAsQuestion(heading.text);
  };
  const paragraphs = upTo(a.paragraphs.filter(isProse), (p) => !inQuestionSection(p));
  return [title?.text, ...headings.map((h) => h.text), ...paragraphs.map((p) => p.plain)]
    .filter((t) => t !== undefined)
    .join('\n');
}

/** `items` up to and including the first one that `stop` accepts (all of them when none does). */
function upTo<T>(items: T[], stop: (item: T) => boolean): T[] {
  const i = items.findIndex(stop);
  return i === -1 ? items : items.slice(0, i + 1);
}

/**
 * Verbs so common that naming them as missing would only invite stuffing ("work" in "How does
 * X work?", "take" in "How long does X take?"); they never count as key words here.
 */
const WEAK = new Set(
  ['work', 'use', 'take', 'make'].flatMap((w) => keyWords(w).map((k) => k.term)),
);

/** One reader question: how many of its key words are up top, and which are not. */
export interface ReaderWords {
  question: string;
  found: number;
  total: number;
  /** The missing key words as the question writes them, in its order. */
  missing: string[];
}

/**
 * Each non-blank question with key words (trimmed, in order, a repeat counted once, ignoring
 * case, spacing and a closing "?"), with its words up top.
 */
export function readerWords(a: Artifacts, questions: string[]): ReaderWords[] {
  const present = allTerms(topText(a));
  const seen = new Set<string>();
  return questions
    .map((q) => q.trim())
    .filter((q) => {
      const key = questionKey(q);
      if (key === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .flatMap((question) => {
      const words = keyWords(question).filter((k) => !WEAK.has(k.term));
      if (words.length === 0) return [];
      const missing = words.filter((k) => !present.has(k.term)).map((k) => k.word);
      return [{ question, found: words.length - missing.length, total: words.length, missing }];
    });
}

const quoted = (words: string[]) => words.map((w) => `"${w}"`).join(', ');

const { e1, grade } = EVIDENCE['reader-words'];

const RATIONALE = `Do not force in words that do not fit: a rewrite that stuffed a page with the query's keywords lowered its share of the answer in an early study (Aggarwal et al. 2024: 17.7 against 19.3 at baseline). ${measuredNote(e1)} ${e1.followUp ?? ''} Evidence grade: ${grade}.`;

/**
 * For each reader question, the share of its key words found at the top of the page (the
 * title, the first heading and the first paragraph, see `topText`); the score is the mean over questions. Advice only: it names up to 3
 * missing words per question and never writes them in. The questions are the author's own when
 * there are any, else the page's title and topic questions (never a section's, so adding a
 * section never lowers the score); without either, the check does not apply.
 */
export const check: CheckFn = (a, ctx): CheckResult => {
  const questions = ctx?.readerQuestions ?? pageQuestionsOf(a).map((q) => q.text);
  const rows = readerWords(a, questions);
  if (rows.length === 0) return notApplicable('reader-words');

  const range = topOfDraft(a);
  const before = a.markdown.slice(range.start, range.end);
  const findings: Finding[] = [];
  const suggestions: Suggestion[] = [];
  const seen = new Map<string, number>();
  let sum = 0;
  let complete = 0;
  for (const { question, found, total, missing } of rows) {
    sum += found / total;
    if (missing.length === 0) {
      complete++;
      continue;
    }
    const message = `The top of the page holds ${found} of the ${total} key words of "${question}".`;
    const shown = missing.slice(0, MAX_NAMED);
    const named = quoted(shown);
    // Every piece of advice anchors at the top, so the question keeps each id distinct and stable.
    const key = `${question}\n${before}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    findings.push({ checkId: 'reader-words', range, message });
    suggestions.push({
      id: suggestionId('reader-words', key, occurrence),
      checkId: 'reader-words',
      kind: 'advisory',
      range,
      before,
      title: `Use the words of "${question}" up top`,
      rationale: `${message} Missing: ${named}. Work ${shown.length === 1 ? 'it' : 'them'} into the title, first heading or first paragraph, if it fits naturally, in your own sentence. ${RATIONALE}`,
      grade,
    });
  }
  return {
    checkId: 'reader-words',
    applicable: true,
    score: sum / rows.length,
    findings,
    suggestions,
    metrics: { questions: rows.length, complete },
  };
};
