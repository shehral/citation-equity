// The plain words for checks and evidence grades, in one place so the draft view, the site rows,
// /cited and /research read the same. The working screens use only the check names and the two
// chips; grades, studies and our tests' numbers live on /research. The engine's registry titles
// stay as they are for the CLI and the JSON report.

import {
  type CheckId,
  E1_COMBINED,
  E1_DELTA,
  type E1Label,
  type E1Result,
  EVIDENCE,
  type EvidenceGrade,
  signed3,
  UNSCORED_CHECKS,
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
  'reader-words': "Your reader's words up top",
};

/** The one chip a check may carry on the working screens. */
export type CheckChip = 'helps' | 'not-scored';

/** Each chip's word, and its one-sentence tooltip. */
export const CHIP_TEXT: Record<CheckChip, { label: string; title: string }> = {
  helps: { label: 'Helps', title: 'Our tests found this helps a little.' },
  'not-scored': { label: 'Not scored', title: 'Our tests found no clear effect on AI citation.' },
};

/**
 * A check's chip: "Not scored" while it carries no weight (an unscored note, unless a custom
 * weight includes it), "Helps" for a check our tests found to help, else none.
 */
export function chipFor(id: CheckId, weight: number): CheckChip | null {
  if (UNSCORED_CHECKS.includes(id) && !(weight > 0)) return 'not-scored';
  return EVIDENCE[id].e1.label === 'helps' ? 'helps' : null;
}

/** The four grades in words (the Research page only). */
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

/** What our own test (E1, or E3) found for a check, in plain words. The numbers sit behind an expand. */
export const E1_WORDS: Record<E1Label, string> = {
  helps: 'Tested: helped a little, maybe through wording overlap',
  // "No effect larger than 0.03": a small effect either way is not ruled out, so never "does nothing".
  'no-effect': 'Tested: no clear effect',
  'insufficient-n': 'Tested: too few pages',
  inconclusive: 'Tested: unclear',
  'not-run': 'Tested: no edit passed our checks',
  // Measured, but the setup cannot give this check a verdict (it needs passage-level retrieval).
  descriptive: 'Tested: no verdict by design',
};

/** A check's own-test result in plain words; an unclear result says which way it leaned. */
export function ownTestWords(result: E1Result): string {
  const words = E1_WORDS[result.label];
  if (result.label !== 'inconclusive' || result.effect === null || result.effect.d === 0)
    return words;
  return `${words}, leaning ${result.effect.d > 0 ? 'positive' : 'negative'}`;
}

/**
 * Why an unscored check (weight 0 in both presets) is not scored, one plain sentence each:
 * "Not scored: <check>. A test on 57 pages found no effect larger than 0.03, ...".
 */
export const UNSCORED_NOTES: Partial<Record<CheckId, string>> = Object.fromEntries(
  UNSCORED_CHECKS.map((id) => {
    const n = EVIDENCE[id].e1.effect?.n;
    const test = n === undefined ? 'a test' : `a test on ${n} pages`;
    return [
      id,
      `Not scored: ${CHECK_NAMES[id]}. ${test[0]?.toUpperCase()}${test.slice(1)} found no effect larger than ${E1_DELTA}, so it counts only if you give it a weight.`,
    ];
  }),
);

const all = E1_COMBINED.vsOriginal;

/** The combined result of every fix applied together (E1's ALL arm), in one sentence. */
export const E1_COMBINED_SENTENCE = `In our own test, applying every fix together raised the citation score by ${signed3(all.d)} (${all.level}% CI [${signed3(all.ci[0])}, ${signed3(all.ci[1])}], n ${all.n}) over the original page and by ${signed3(E1_COMBINED.vsPlacebo.d)} over a paraphrase of the same passages, possibly through length or query-term overlap.`;
