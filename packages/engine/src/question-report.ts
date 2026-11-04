import { judgeQuestion, type QuestionCoverage, type Target } from './checks/question-coverage';
import { wordsUpTop } from './checks/reader-words';
import { topOfDraft } from './checks/structure-issues';
import type { Artifacts } from './gather';
import { uniqueQuestions } from './import-queries';
import type { AnalysisResult, Range, Suggestion } from './types';

/**
 * One reader question and the two tested edits it needs: (a) its key words up top
 * (`readerWords`) and (b) a section that answers it directly (`questionCoverage`). Both are the
 * checks' own measures, unchanged; this only says how they combine.
 */
export interface QuestionRow {
  /** The question, trimmed, as written. */
  question: string;
  /** Line (a): its key words found up top, and the missing ones in its order; null when it has none to look for. */
  words: { found: number; total: number; missing: string[] } | null;
  /** Where line (a) points: the top of the draft. */
  wordsRange: Range;
  /** Line (b), as the question-coverage check judges it. */
  answer: QuestionCoverage;
  /**
   * The passage a direct answer goes in: the matching section's first prose sentence (for a
   * paragraph match, that sentence), or an empty range right after the matching heading when its
   * section has no prose, or right after the top of the draft when nothing matches.
   */
  answerRange: Range;
  /** Nothing is left to do for it: line (a) is met (or has no key words) and line (b) is answered. */
  covered: boolean;
}

/** The questions a draft is measured on, where they came from, and how many it covers. */
export interface QuestionReport {
  /** `yours`: the questions given with the draft; `page`: the page's own title and topic questions. */
  from: 'yours' | 'page';
  rows: QuestionRow[];
  covered: number;
}

/**
 * See `QuestionRow.answerRange`: read from the target the question was judged on, so the target
 * is found once per question; `top` is `topOfDraft(a)`.
 */
function answerRangeOf(target: Target, top: Range): Range {
  if (target === null) return { start: top.end, end: top.end };
  if (target.kind === 'paragraph') return target.sentence.range;
  if (target.sentence) return target.sentence.range;
  // A matching heading whose section has no prose sentence.
  const { end } = target.heading.range;
  return { start: end, end };
}

/** One row per question (see `uniqueQuestions`, the dedupe the reader-words check uses), in order. */
export function questionReport(a: Artifacts, questions: string[]): QuestionRow[] {
  const top = topOfDraft(a);
  // Each row is measured from its own question by the checks' own per-question measures, so no
  // row is joined to a check's list by wording or position. The top of the page is read once.
  const upTop = wordsUpTop(a);
  return uniqueQuestions(questions).map((question) => {
    const found = upTop(question);
    const words =
      found === null ? null : { found: found.found, total: found.total, missing: found.missing };
    const { coverage: answer, target } = judgeQuestion(a, question);
    return {
      question,
      words,
      wordsRange: { ...top },
      answer,
      answerRange: answerRangeOf(target, top),
      covered: (words === null || words.missing.length === 0) && answer.covered,
    };
  });
}

/** The suggestion titles of the two question checks, as each check writes them. */
const TITLES: Record<'reader-words' | 'question-coverage', (question: string) => string> = {
  'reader-words': (q) => `Use the words of "${q}" up top`,
  'question-coverage': (q) => `Answer "${q}" directly`,
};

/**
 * The suggestion `checkId` made for `question` in `result`, found by the check's fixed title;
 * undefined when that line is met or the result did not measure the question.
 */
export function suggestionFor(
  result: AnalysisResult,
  checkId: 'reader-words' | 'question-coverage',
  question: string,
): Suggestion | undefined {
  const title = TITLES[checkId](question.trim());
  return result.checks
    .find((c) => c.checkId === checkId)
    ?.suggestions.find((s) => s.title === title);
}
