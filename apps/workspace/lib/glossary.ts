// The plain words the working screens use for checks and evidence grades, in one place so the
// draft view, the site rows, /cited and /research read the same. The engine's registry titles stay as they are for the CLI and the JSON report.

import {
  type CheckId,
  E1_COMBINED,
  E1_DELTA,
  type E1Label,
  type EvidenceGrade,
  signed3,
} from '@citation-equity/engine';

/** Plain names of the checks. */
export const CHECK_NAMES: Record<CheckId, string> = {
  'standalone-paragraphs': 'Paragraphs make sense alone',
  'question-headings': 'Headings ask questions',
  lists: 'Lists, not long sentences',
  statistics: 'Real numbers',
  tables: 'Comparison tables',
  'expert-quotes': 'Quotes say who said them',
  'cited-sources': 'Claims link a source',
  'direct-answer-lead': 'Answer first',
  'question-coverage': 'Your questions answered',
  comparisons: 'Compares the options',
};

/** The four grades in words. */
export const GRADE_WORDS: Record<EvidenceGrade, string> = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  mixed: 'Mixed evidence',
  untested: 'Untested',
};

/** What each grade means, in one line. */
export const GRADE_MEANING: Record<EvidenceGrade, string> = {
  strong: 'Several controlled studies agree, including real search.',
  moderate: 'Studies point the same way; none found harm.',
  mixed: 'At least one study found no effect or harm.',
  untested: 'No direct test yet.',
};

/** A check whose grade needs its own line. */
export const CHECK_GRADE_MEANING: Partial<Record<CheckId, string>> = {
  lists:
    'Pages AI cites most use more lists, but formatting alone showed no effect in a controlled test. Use lists for real lists.',
};

/**
 * Plain leads for the checks whose engine summary opens on a study's name. The studies stay
 * named in the full summary behind the expand.
 */
export const PLAIN_LEADS: Partial<Record<CheckId, string>> = {
  statistics:
    'Real, checkable numbers help, but adding figures for their own sake helped in one early test and hurt in a larger one.',
  'expert-quotes':
    'Adding quotes helped in one early test, but a larger test found no gain, so quote people only where it adds something.',
  'cited-sources':
    'Linking credible sources helped in one early test, but later tests found little gain from adding references alone.',
};

/** What our own test (E1) found for a check, in plain words. The numbers sit behind an expand. */
export const E1_WORDS: Record<E1Label, string> = {
  helps: 'Tested: helped a little, maybe through wording overlap',
  'no-effect': 'Tested: no clear effect',
  'insufficient-n': 'Tested: too few pages',
  'not-run': 'Tested: no edit passed our checks',
  // Measured, but the setup cannot give this check a verdict (it needs passage-level retrieval).
  descriptive: 'Tested: no verdict by design',
};

/** Why an unscored check (weight 0 in both presets) is not scored, one plain sentence each. */
export const UNSCORED_NOTES: Partial<Record<CheckId, string>> = {
  lists: `Lists count only if you give them a weight, because a test found no effect larger than ${E1_DELTA}.`,
};

const all = E1_COMBINED.vsOriginal;

/** The combined result of every fix applied together (E1's ALL arm), in one sentence. */
export const E1_COMBINED_SENTENCE = `In our own test, applying every fix together raised the citation score by ${signed3(all.d)} (${all.level}% CI [${signed3(all.ci[0])}, ${signed3(all.ci[1])}], n ${all.n}) over the original page and by ${signed3(E1_COMBINED.vsPlacebo.d)} over a paraphrase of the same passages, possibly through length or query-term overlap.`;
