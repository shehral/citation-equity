import {
  type AnalysisResult,
  CHECK_IDS,
  type CheckResult,
  type Suggestion,
} from '@citation-equity/engine';

export const DRAFT = '# Espresso\n\n## Why espresso turns bitter\n\nBitter shots run long.\n';

const HEADING = 'Why espresso turns bitter';
const HEADING_START = DRAFT.indexOf(HEADING) - '## '.length;
const HEADING_END = DRAFT.indexOf(HEADING) + HEADING.length;

/** An edit suggestion that turns the H2 into a question. */
export const HEADING_EDIT: Suggestion = {
  id: 'edit0001',
  checkId: 'question-headings',
  kind: 'edit',
  range: { start: HEADING_START, end: HEADING_END },
  before: `## ${HEADING}`,
  after: '## Why does espresso turn bitter?',
  title: 'Phrase this heading as a question',
  rationale: 'Readers ask questions; a question heading matches them.',
  grade: 'mixed',
};

/** An advisory with no `after`. */
export const QUOTE_ADVISORY: Suggestion = {
  id: 'adv00001',
  checkId: 'expert-quotes',
  kind: 'advisory',
  range: { start: DRAFT.indexOf('Bitter'), end: DRAFT.indexOf('long.') + 'long.'.length },
  before: 'Bitter shots run long.',
  title: 'Name who said this',
  rationale: 'Attributed quotes carry more weight.',
  grade: 'mixed',
};

/** An advisory the local wording helper may address (not a statistics, quote or source check). */
export const PARAGRAPH_ADVISORY: Suggestion = {
  id: 'adv00002',
  checkId: 'standalone-paragraphs',
  kind: 'advisory',
  range: QUOTE_ADVISORY.range,
  before: QUOTE_ADVISORY.before,
  title: 'Make this paragraph stand on its own',
  rationale: 'A paragraph that names its subject still reads clearly when quoted alone.',
  grade: 'untested',
};

/** What a check found at a suggestion's text, by suggestion id (the engine pairs them by range). */
export const FINDINGS: Record<string, string> = {
  [PARAGRAPH_ADVISORY.id]: 'It has 4 words, too short to carry its point alone.',
};

/** An AnalysisResult shaped like the engine's, with chosen suggestions and scores. */
export function makeResult(
  markdown: string,
  suggestions: Suggestion[],
  scores: AnalysisResult['scores'] = { foundation: 62, evidence: 48, custom: null },
): AnalysisResult {
  const checks: CheckResult[] = CHECK_IDS.map((checkId) => ({
    checkId,
    applicable: true,
    score: 0.5,
    findings: suggestions
      .filter((s) => s.checkId === checkId && FINDINGS[s.id] !== undefined)
      .map((s) => ({ checkId, range: s.range, message: FINDINGS[s.id] ?? '' })),
    suggestions: suggestions.filter((s) => s.checkId === checkId),
    metrics: {},
  }));
  return { schemaVersion: 1, engineVersion: '0.0.0', markdown, wordCount: 8, checks, scores };
}
