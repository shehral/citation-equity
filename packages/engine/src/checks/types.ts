import type { Artifacts } from '../gather';
import type { CheckId, CheckResult } from '../types';

/** What a check may read besides the draft: the author's target questions. */
export interface CheckContext {
  questions: string[];
}

/** A check is a pure function of the gathered artifacts (and, for some checks, the context). */
export type CheckFn = (a: Artifacts, ctx?: CheckContext) => CheckResult;

/** The result of a check that does not apply to the draft. */
export function notApplicable(checkId: CheckId): CheckResult {
  return { checkId, applicable: false, score: 0, findings: [], suggestions: [], metrics: {} };
}
