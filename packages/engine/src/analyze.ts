import { version } from '../package.json';
import { CHECKS } from './checks/index';
import { notApplicable } from './checks/types';
import { gather } from './gather';
import { uniqueQuestions } from './import-queries';
import { parseDraft } from './parse';
import { questionReport } from './question-report';
import { pageQuestionsOf } from './questions';
import { type AnalysisResult, type AnalyzeOptions, CHECK_IDS } from './types';

/**
 * Parses a draft and runs every check in CHECK_IDS order. A draft with no words (empty,
 * whitespace, front matter or code only) runs no check and has no question rows.
 *
 * One set of questions feeds both question checks and the question report: `opts.questions`
 * (trimmed, without repeats) when there are any (`from: 'yours'`), else the page's own title and
 * topic questions (`from: 'page'`), never a section's. So the report's two lines per question
 * and the checks' advice always measure the same questions. No total is computed; `scoreChecks`
 * is a separate research function over `checks`.
 */
export function analyze(source: string, opts: AnalyzeOptions = {}): AnalysisResult {
  const artifacts = gather(parseDraft(source, opts.format));
  const hasContent = artifacts.wordCount > 0;
  const given = uniqueQuestions(opts.questions ?? []);
  const questions =
    given.length > 0 || !hasContent ? given : pageQuestionsOf(artifacts).map((q) => q.text);
  const ctx = { questions, readerQuestions: questions };
  const checks = CHECK_IDS.map((id) =>
    hasContent ? CHECKS[id](artifacts, ctx) : notApplicable(id),
  );
  const rows = hasContent ? questionReport(artifacts, questions) : [];
  return {
    schemaVersion: 2,
    engineVersion: version,
    markdown: artifacts.markdown,
    wordCount: artifacts.wordCount,
    checks,
    questions: {
      from: given.length > 0 ? 'yours' : 'page',
      rows,
      covered: rows.filter((r) => r.covered).length,
    },
  };
}
