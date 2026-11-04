import type { QuestionReport } from './question-report';

export type EvidenceGrade = 'strong' | 'moderate' | 'mixed' | 'untested';
export const CHECK_IDS = [
  'standalone-paragraphs',
  'question-headings',
  'lists',
  'statistics',
  'tables',
  'expert-quotes',
  'cited-sources',
  'direct-answer-lead',
  'question-coverage',
  'comparisons',
  'reader-words',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];
export interface SourceRef {
  id: string;
  citation: string;
  url: string;
  claim: string;
}
/**
 * A check's outcome in E1, the project's pre-registered test (experiments/RESULTS_E1.md):
 * `helps`, `no-effect` (no effect larger than δ), `insufficient-n`, `not-run`, or `descriptive`
 * (reported, no verdict by design).
 */
export type E1Label =
  | 'helps'
  | 'no-effect'
  | 'insufficient-n'
  | 'inconclusive'
  | 'not-run'
  | 'descriptive';
/**
 * Which of our own tests a check's result comes from: E1 (experiments/RESULTS_E1.md), or E3
 * (experiments/RESULTS_E3.md), which asked E1's question again with more pages for the seven checks
 * E1 could not judge; its pooled result replaces E1's for those checks.
 */
export type OwnTest = 'E1' | 'E3';
/** One E1 contrast: mean change d in citation-score units, its interval, and the query count. */
export interface E1Effect {
  d: number;
  ci: readonly [number, number];
  /** The interval's level: 95, or 90 for the equivalence (no-effect) verdict. */
  level: 90 | 95;
  n: number;
  /** Holm-adjusted p, shown for a check in the test's corrected family. */
  holmP?: number;
}
export interface E1Result {
  /** The test the label and numbers come from. */
  test: OwnTest;
  label: E1Label;
  /** The primary contrast (E1's main set, or E3's pooled set); null when the arm did not run. */
  effect: E1Effect | null;
  /** The replication set's contrast, when there is one worth showing. */
  replication?: E1Effect;
  /**
   * What the follow-up test (E2, experiments/RESULTS_E2.md) found for the check, in one sentence
   * with its numbers; absent where E2 did not test it.
   */
  followUp?: string;
}
export interface Evidence {
  grade: EvidenceGrade;
  summary: string;
  sources: SourceRef[];
}
/** A check's evidence: the literature review, plus the check's outcome in E1. */
export interface CheckEvidence extends Evidence {
  e1: E1Result;
}
export interface CheckDefinition {
  id: CheckId;
  title: string;
  category: 'structure' | 'data-density' | 'clarity' | 'sourcing';
  inFoundationDesign: boolean;
  description: string;
  evidence: CheckEvidence;
  /**
   * Research API: false for a check at weight 0 in every preset (still analyzed and still
   * suggesting). The presets feed `scoreChecks`, which the app and the CLI never show.
   */
  scored: boolean;
  /** Research API: the check's weight in each preset. */
  defaultWeights: { foundation: number; evidence: number };
}
/** UTF-16 offsets into the Markdown source; end exclusive. */
export interface Range {
  start: number;
  end: number;
}
export interface Finding {
  checkId: CheckId;
  range: Range;
  message: string;
}
export interface Suggestion {
  id: string;
  checkId: CheckId;
  kind: 'edit' | 'advisory';
  range: Range;
  before: string;
  after?: string;
  title: string;
  rationale: string;
  grade: EvidenceGrade;
}
export interface CheckResult {
  checkId: CheckId;
  score: number;
  applicable: boolean;
  findings: Finding[];
  suggestions: Suggestion[];
  metrics: Record<string, number>;
}
/** Research API: a preset of `scoreChecks` weights. */
export type PresetId = 'foundation' | 'evidence';
/** Research API: a weight per check, for `scoreChecks`. */
export type Weights = Record<CheckId, number>;
export interface AnalysisResult {
  schemaVersion: 2;
  engineVersion: string;
  markdown: string;
  wordCount: number;
  checks: CheckResult[];
  /** Which reader questions the draft covers: words up top and a direct answer, per question. */
  questions: QuestionReport;
}
export interface AnalyzeOptions {
  format?: 'markdown' | 'html';
  /**
   * The questions readers ask. The two question checks and the question report all measure
   * these (trimmed, without repeats), or the page's own title and topic questions when there
   * are none, so every line about a question reads the same set.
   */
  questions?: string[];
}
