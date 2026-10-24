import { CHECK_DEFINITIONS } from '@citation-equity/engine';

/** True when at least one check's evidence is graded strong. */
export const ANY_STRONG_EVIDENCE = CHECK_DEFINITIONS.some((d) => d.evidence.grade === 'strong');

/**
 * The evidence stance, the one statement of how far the research supports the score.
 * Edit it here only, so every place that shows it says the same.
 */
export const EVIDENCE_STANCE = ANY_STRONG_EVIDENCE
  ? 'The score is a writing checklist, not a prediction of citations.'
  : 'None of the checks has strong evidence behind it, so the score is a writing checklist, not a prediction of citations.';
