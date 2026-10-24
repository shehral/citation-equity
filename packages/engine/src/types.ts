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
export interface Evidence {
  grade: EvidenceGrade;
  summary: string;
  sources: SourceRef[];
}
export interface CheckDefinition {
  id: CheckId;
  title: string;
  category: 'structure' | 'data-density' | 'clarity' | 'sourcing';
  inFoundationDesign: boolean;
  description: string;
  evidence: Evidence;
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
