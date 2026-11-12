// Stage by stage: would the draft be found, and once found, would it be cited? The Small-Site
// Funnel Study (Northeastern, Fall 2026) splits a page's chance of citation into stages,
// P(cited) = P(found) x P(cited | found), because each stage needs a different fix: a page the
// search step never hands to the model needs the reader's words where search can match them; a
// page that is found but passed over needs a clearer answer. The bench already records both
// stages per run; this reads them out of a report. Written for this project.
import { wilson } from './metrics';
import type { Rate, RunRecord } from './types';

export type LosesAt = 'search' | 'citation' | 'both' | 'neither' | 'unknown';

export interface StageFunnel {
  /** Valid runs (answers with a valid citation): the base of every rate below. */
  validRuns: number;
  /** Valid runs whose sources included the draft. */
  found: Rate;
  /** Among valid runs that found the draft: the ones that cited it. */
  citedWhenFound: Rate;
  /** Valid runs that cited the draft: found.p x citedWhenFound.p, exactly. */
  cited: Rate;
  /**
   * The share of the draft's loss at each step, on the log scale where the two steps add up:
   * -log(found) and -log(cited when found), each over their sum. Null when nothing is lost, when
   * a step was never reached, or with no valid run.
   */
  share: { search: number; citation: number } | null;
  /**
   * Where the draft loses most: 'search' or 'citation' when that step holds 60% or more of the
   * loss, 'both' in between, 'neither' when it was found and cited in every valid run, and
   * 'unknown' with no valid run. A draft never found loses at 'search'; one found but never
   * cited loses at 'citation'.
   */
  losesAt: LosesAt;
}

/** Above this share of the loss, one step is said to be where the draft loses. */
export const LOSES_AT_SHARE = 0.6;

/**
 * The stage funnel of a bench report, over its valid runs, so that found x cited when found is
 * exactly the report's cited-among-valid rate. Takes only the fields a recorded sample keeps.
 */
export function stageFunnel(report: {
  runs: readonly Pick<RunRecord, 'draftRetrieved' | 'draftCited' | 'formatFailure'>[];
}): StageFunnel {
  const valid = report.runs.filter((r) => !r.formatFailure);
  const found = valid.filter((r) => r.draftRetrieved);
  // A run can only cite a source it was given; count the cited ones among the found to be safe.
  const cited = found.filter((r) => r.draftCited);
  const f = wilson(found.length, valid.length);
  const c = wilson(cited.length, found.length);
  const base = {
    validRuns: valid.length,
    found: f,
    citedWhenFound: c,
    cited: wilson(cited.length, valid.length),
  };
  if (valid.length === 0) return { ...base, share: null, losesAt: 'unknown' };
  if (found.length === 0) return { ...base, share: null, losesAt: 'search' };
  if (cited.length === 0) return { ...base, share: null, losesAt: 'citation' };
  // A step passed every time loses nothing (+0, never -0).
  const loss = (p: number) => (p >= 1 ? 0 : -Math.log(p));
  const lossSearch = loss(f.p);
  const lossCitation = loss(c.p);
  const total = lossSearch + lossCitation;
  if (total === 0) return { ...base, share: null, losesAt: 'neither' };
  const share = { search: lossSearch / total, citation: lossCitation / total };
  const losesAt: LosesAt =
    share.search >= LOSES_AT_SHARE
      ? 'search'
      : share.citation >= LOSES_AT_SHARE
        ? 'citation'
        : 'both';
  return { ...base, share, losesAt };
}

/** One plain sentence on where the draft loses, for the workspace and the CLI. */
export function losesAtText(losesAt: LosesAt): string {
  switch (losesAt) {
    case 'search':
      return 'Mostly at the search step: the model often never sees your draft.';
    case 'citation':
      return 'Mostly at the answer: the model sees your draft but cites others.';
    case 'both':
      return 'At both steps, about equally.';
    case 'neither':
      return 'Nowhere: found and cited in every answer.';
    case 'unknown':
      return 'Not known: no answer had a valid citation.';
  }
}
