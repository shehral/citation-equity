import { EVIDENCE } from './evidence';
import {
  CHECK_IDS,
  type CheckDefinition,
  type CheckId,
  type EvidenceGrade,
  type PresetId,
  type Weights,
} from './types';

type CheckMeta = Pick<CheckDefinition, 'title' | 'category' | 'inFoundationDesign' | 'description'>;

/**
 * What each check looks at. `inFoundationDesign` marks the six checks of
 * Prof. Akram Bayat's foundation design; four come from the literature and one
 * (reader-words) from the project's own test, E1.
 */
const META: Record<CheckId, CheckMeta> = {
  'standalone-paragraphs': {
    title: 'Standalone paragraphs',
    category: 'clarity',
    inFoundationDesign: true,
    description:
      'Paragraphs that still make sense when quoted on their own: they name their subject instead of opening with "This", "It" or "As mentioned", and run 40 to 150 words.',
  },
  'question-headings': {
    title: 'Question headings',
    category: 'structure',
    inFoundationDesign: true,
    description:
      'Section headings (H2 and H3) phrased as the questions readers ask, such as "How do I fix bitter espresso?".',
  },
  lists: {
    title: 'Lists for enumerations',
    category: 'structure',
    inFoundationDesign: true,
    description:
      'Steps, options and other runs of three or more items written as a bulleted or numbered list instead of a long sentence.',
  },
  statistics: {
    title: 'Statistics',
    category: 'data-density',
    inFoundationDesign: true,
    description:
      'Concrete numbers with context, such as percentages, amounts with units, prices and counts. Bare years and list numbers do not count.',
  },
  tables: {
    title: 'Tables for comparisons',
    category: 'data-density',
    inFoundationDesign: true,
    description:
      'Comparisons and lists of "Key: value" pairs laid out as a data table, so each value sits next to its label.',
  },
  'expert-quotes': {
    title: 'Attributed expert quotes',
    category: 'data-density',
    inFoundationDesign: true,
    description:
      'Quotations that name who said them, for example "says Jane Doe, head roaster at Example Coffee".',
  },
  'cited-sources': {
    title: 'Cited sources',
    category: 'sourcing',
    inFoundationDesign: false,
    description:
      'Statistics and research claims backed by a link to their source in the same sentence or paragraph.',
  },
  'direct-answer-lead': {
    title: 'Direct answer first',
    category: 'clarity',
    inFoundationDesign: false,
    description:
      'Each section opens with a short, direct answer of 8 to 40 words before the detail, without hedges like "It depends".',
  },
  'question-coverage': {
    title: 'Target questions answered',
    category: 'clarity',
    inFoundationDesign: false,
    description:
      "Each target question you enter gets a direct answer: the section whose heading matches it (or the paragraph that matches it best) opens with a plain sentence of 8 to 40 words that uses most of the question's key words. Applies only when you give target questions.",
  },
  comparisons: {
    title: 'Explicit comparisons',
    category: 'data-density',
    inFoundationDesign: false,
    description:
      'Where readers choose between options, the draft compares them in so many words, such as "X vs Y", "brighter than", "unlike" or "instead of". Applies to drafts of 300 words or more.',
  },
  'reader-words': {
    title: "Your reader's words up top",
    category: 'clarity',
    inFoundationDesign: false,
    description:
      'The key words of the page\'s questions appear in the title, the first heading or the first paragraph (a question section above them does not push them down); the score is the share found, averaged over questions. The questions are the ones you typed or imported, else the page\'s title and topic questions, never a section\'s. Common verbs such as "work" and "use" do not count. It names missing words as advice and never adds them for you.',
  },
};

/**
 * Checks that are unscored notes: our own test (E1, or E3 for the checks it asked again) found no
 * effect larger than δ, so E1's rule table makes them weight 0 in every preset. They are still analyzed and still suggest; a custom weight the
 * author sets still counts them.
 */
export const UNSCORED_CHECKS: CheckId[] = CHECK_IDS.filter(
  (id) => EVIDENCE[id].e1.label === 'no-effect',
);

const isScored = (id: CheckId) => !UNSCORED_CHECKS.includes(id);

/** Weight of a check in the `evidence` preset, by its evidence grade. */
export const GRADE_WEIGHTS: Record<EvidenceGrade, number> = {
  strong: 1,
  moderate: 0.7,
  mixed: 0.25,
  untested: 0.15,
};

const presetFrom = (weightOf: (id: CheckId) => number): Weights =>
  Object.fromEntries(CHECK_IDS.map((id) => [id, weightOf(id)])) as Weights;

/**
 * `foundation`: the foundation design's checks at equal weight, the added checks at half weight.
 * `evidence`: each check weighted by its grade.
 * An unscored check is 0 in both.
 */
export const PRESET_WEIGHTS: Record<PresetId, Weights> = {
  foundation: presetFrom((id) => (!isScored(id) ? 0 : META[id].inFoundationDesign ? 1 : 0.5)),
  evidence: presetFrom((id) => (!isScored(id) ? 0 : GRADE_WEIGHTS[EVIDENCE[id].grade])),
};

/** The check registry, in CHECK_IDS order. */
export const CHECK_DEFINITIONS: CheckDefinition[] = CHECK_IDS.map((id) => ({
  id,
  ...META[id],
  evidence: EVIDENCE[id],
  scored: isScored(id),
  defaultWeights: {
    foundation: PRESET_WEIGHTS.foundation[id],
    evidence: PRESET_WEIGHTS.evidence[id],
  },
}));
