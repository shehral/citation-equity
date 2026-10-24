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
export type E1Label = 'helps' | 'no-effect' | 'insufficient-n' | 'not-run' | 'descriptive';
/** One E1 contrast: mean change d in citation-score units, its interval, and the query count. */
export interface E1Effect {
  d: number;
  ci: readonly [number, number];
  /** The interval's level: 95, or 90 for the equivalence (no-effect) verdict. */
  level: 90 | 95;
  n: number;
  /** Holm-adjusted p, shown for a verdict that rests on it. */
  holmP?: number;
}
export interface E1Result {
  label: E1Label;
  /** The main set's primary contrast; null when the arm did not run. */
  effect: E1Effect | null;
  /** The replication set's contrast, when there is one worth showing. */
  replication?: E1Effect;
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
  /** False for an unscored note: weight 0 in every preset, still analyzed and still suggesting. */
  scored: boolean;
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
export type PresetId = 'foundation' | 'evidence';
export type Weights = Record<CheckId, number>;
export interface AnalysisResult {
  schemaVersion: 1;
  engineVersion: string;
  markdown: string;
  wordCount: number;
  checks: CheckResult[];
  scores: { foundation: number | null; evidence: number | null; custom: number | null };
}
export interface AnalyzeOptions {
  format?: 'markdown' | 'html';
  weights?: Weights;
  /** Target questions readers ask; only the question-coverage check reads them. */
  questions?: string[];
}
