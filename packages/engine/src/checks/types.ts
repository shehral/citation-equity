import type { Artifacts } from '../gather';
import type { CheckId, CheckResult } from '../types';

/** What a check may read besides the draft: the target questions. */
export interface CheckContext {
  /** Every target question (question-coverage). */
  questions: string[];
  /**
   * The questions reader-words measures: the author's own when there are any, else the page's
   * title and topic questions. When absent, the check works out the page's questions itself.
   */
  readerQuestions?: string[];
}

/** A check is a pure function of the gathered artifacts (and, for some checks, the context). */
export type CheckFn = (a: Artifacts, ctx?: CheckContext) => CheckResult;

/** The result of a check that does not apply to the draft. */
export function notApplicable(checkId: CheckId): CheckResult {
  return { checkId, applicable: false, score: 0, findings: [], suggestions: [], metrics: {} };
}
