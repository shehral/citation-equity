import { version } from '../package.json';
import { CHECKS } from './checks/index';
import { notApplicable } from './checks/types';
import { gather } from './gather';
import { parseDraft } from './parse';
import { pageQuestionsOf } from './questions';
import { PRESET_WEIGHTS } from './registry';
import { scoreChecks } from './score';
import { type AnalysisResult, type AnalyzeOptions, CHECK_IDS } from './types';

/**
 * Parses a draft, runs every check in CHECK_IDS order and scores the results
 * under both presets (plus `custom` when `opts.weights` is given). A draft
 * with no words (empty, whitespace, front matter or code only) runs no check.
 * `opts.questions` feeds the question-coverage check, which does not apply
 * without them. The reader-words check measures `opts.authorQuestions` when
 * there are any, else the page's own title and topic questions.
 */
export function analyze(source: string, opts: AnalyzeOptions = {}): AnalysisResult {
  const artifacts = gather(parseDraft(source, opts.format));
  const hasContent = artifacts.wordCount > 0;
  const own = (opts.authorQuestions ?? []).map((q) => q.trim()).filter((q) => q !== '');
  const ctx = {
    questions: opts.questions ?? [],
    readerQuestions:
      own.length > 0 || !hasContent ? own : pageQuestionsOf(artifacts).map((q) => q.text),
  };
  const checks = CHECK_IDS.map((id) =>
    hasContent ? CHECKS[id](artifacts, ctx) : notApplicable(id),
  );
  return {
    schemaVersion: 1,
    engineVersion: version,
    markdown: artifacts.markdown,
    wordCount: artifacts.wordCount,
    checks,
    scores: {
      foundation: scoreChecks(checks, PRESET_WEIGHTS.foundation),
      evidence: scoreChecks(checks, PRESET_WEIGHTS.evidence),
      custom: opts.weights ? scoreChecks(checks, opts.weights) : null,
    },
  };
}
