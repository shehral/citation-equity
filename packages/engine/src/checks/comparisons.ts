import { EVIDENCE } from '../evidence';
import type { Artifacts } from '../gather';
import type { CheckResult } from '../types';
import { hasComparisonLanguage, isComparisonHeading } from './comparison-language';
import { issueCollector, topOfDraft } from './structure-issues';
import { type CheckFn, notApplicable } from './types';

const MIN_WORDS = 300;

const RATIONALE = `If readers choose between options here, compare them explicitly: what each is better for, with real differences. In a controlled study, pages with no comparison to alternatives lost the first citation more often in four of six models (What Gets Cited), and pages with comparison content shaped AI answers more in an observational study. Compare only options you know, with differences you can back up; if the page is not about a choice, leave it as it is. Evidence grade: ${EVIDENCE.comparisons.grade}.`;

/** Rows of a Markdown table's source, without the delimiter row. */
function tableRows(a: Artifacts): string[] {
  return a.tables.flatMap((t) =>
    a.markdown
      .slice(t.range.start, t.range.end)
      .split('\n')
      .filter((_, i) => i !== 1),
  );
}

/**
 * Counts headings, sentences and table rows with explicit comparison language. Scores 1 when
 * the draft compares anything, else 0 with one advisory at the top of the draft. It never
 * proposes text: only the author knows the real differences.
 */
export const check: CheckFn = (a: Artifacts): CheckResult => {
  if (a.wordCount < MIN_WORDS) return notApplicable('comparisons');

  const headings = a.headings.filter((h) => isComparisonHeading(h.text)).length;
  const sentences = a.paragraphs
    .flatMap((p) => p.sentences)
    .filter((s) => hasComparisonLanguage(s.plain)).length;
  const rows = tableRows(a).filter(hasComparisonLanguage).length;
  const comparisons = headings + sentences + rows;

  const out = issueCollector('comparisons', a.markdown);
  if (comparisons === 0) {
    out.add({
      range: topOfDraft(a),
      message:
        'The draft never compares options in so many words (no "vs", "than", "unlike", "instead of" or similar).',
      title: 'Compare the options readers choose between',
      rationale: RATIONALE,
    });
  }
  return {
    checkId: 'comparisons',
    applicable: true,
    score: comparisons > 0 ? 1 : 0,
    findings: out.findings,
    suggestions: out.suggestions,
    metrics: { comparisons, words: a.wordCount },
  };
};
