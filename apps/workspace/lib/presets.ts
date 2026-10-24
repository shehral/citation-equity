import { CHECK_DEFINITIONS, type CheckDefinition, type CheckId } from '@citation-equity/engine';
import type { ActivePreset } from './use-analysis';

export const PRESET_LABELS: Record<ActivePreset, string> = {
  foundation: 'Foundation design',
  evidence: 'Evidence-weighted',
  custom: 'Custom',
};

export const DEFINITIONS_BY_ID = Object.fromEntries(
  CHECK_DEFINITIONS.map((d) => [d.id, d]),
) as Record<CheckId, CheckDefinition>;

/** True when at least one check's evidence is graded strong. */
export const ANY_STRONG_EVIDENCE = CHECK_DEFINITIONS.some((d) => d.evidence.grade === 'strong');

/**
 * The evidence stance (R14), shown on the score card, /evidence and /about.
 * Edit it here only: the copy is subject to final-review triage.
 */
export const EVIDENCE_STANCE = ANY_STRONG_EVIDENCE
  ? 'The score is a writing checklist, not a prediction of citations.'
  : 'None of the checks has strong evidence behind it, so the score is a writing checklist, not a prediction of citations.';
