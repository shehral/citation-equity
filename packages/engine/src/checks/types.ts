import type { Artifacts } from '../gather';
import type { CheckId, CheckResult } from '../types';

/**
 * What a check may read besides the draft: the questions readers ask. `analyze` passes the same
 * set as both fields (the given questions, else the page's own title and topic questions).
 */
export interface CheckContext {
  /** The questions question-coverage measures. */
  questions: string[];
  /**
   * The questions reader-words measures. When absent, the check works out the page's own title
   * and topic questions itself.
   */
  readerQuestions?: string[];
}

/** A check is a pure function of the gathered artifacts (and, for some checks, the context). */
export type CheckFn = (a: Artifacts, ctx?: CheckContext) => CheckResult;

/** The result of a check that does not apply to the draft. */
export function notApplicable(checkId: CheckId): CheckResult {
  return { checkId, applicable: false, score: 0, findings: [], suggestions: [], metrics: {} };
}
