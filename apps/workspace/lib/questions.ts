import { generateQuestions, type QuestionSource, questionKey } from '@citation-equity/engine';
import { sampleBench } from './bench';
import type { Sample } from './samples';

/** The engine's sources, plus a sample pack's own reader questions. */
export type WorkspaceQuestionSource = QuestionSource | 'sample-pack';
export interface WorkspaceQuestion {
  text: string;
  source: WorkspaceQuestionSource;
}

export const MAX_QUESTIONS = 8;

/** Sources the tool generates; every other source is the author's own (typed or imported). */
const GENERATED: ReadonlySet<WorkspaceQuestionSource> = new Set([
  'draft-heading',
  'template',
  'local-model',
]);

/**
 * The questions the author typed or imported (a sample pack's count as imported), which the
 * reader-words check measures instead of the page's own title and topic questions.
 */
export const authorQuestionTexts = (questions: WorkspaceQuestion[]): string[] =>
  questions.filter((q) => !GENERATED.has(q.source)).map((q) => q.text);

/** The small label each question carries. */
export const SOURCE_LABELS: Record<WorkspaceQuestionSource, string> = {
  'sample-pack': 'Sample pack',
  'draft-heading': 'Your heading',
  template: 'Template',
  'local-model': 'Local model',
  'search-console': 'Search Console',
  'bing-ai': 'Bing AI Performance',
  keywords: 'Your keywords',
  user: 'By you',
};

/** The engine's key: case, spacing and closing punctuation ignored, so "What is crema" = "What is crema?". */
const keyOf = questionKey;

/**
 * The questions a draft starts with: a sample's pack queries, or for a draft
 * without a pack (a custom draft), the questions its own title and headings
 * already ask. Template questions are suggestions: "Suggest from draft" adds
 * them, so none is scored until the author asks for it.
 */
export function initialQuestions(sample: Sample | null, markdown: string): WorkspaceQuestion[] {
  const pack = sampleBench(sample)?.pack;
  if (pack && pack.queries.length > 0) {
    return mergeQuestions(
      [],
      pack.queries.map((q) => ({ text: q.query, source: 'sample-pack' as const })),
    );
  }
  return generateQuestions(markdown, { max: MAX_QUESTIONS }).filter(
    (q) => q.source === 'draft-heading',
  );
}

/** `current` plus each of `incoming` not already there (ignoring case, spacing and a closing "?"), up to 8. */
export function mergeQuestions(
  current: WorkspaceQuestion[],
  incoming: WorkspaceQuestion[],
): WorkspaceQuestion[] {
  const out = [...current];
  const seen = new Set(current.map((q) => keyOf(q.text)));
  for (const q of incoming) {
    const key = keyOf(q.text);
    if (out.length >= MAX_QUESTIONS) break;
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push({ text: q.text.trim(), source: q.source });
  }
  return out;
}

/** True when `text` is already one of `questions` (ignoring case, spacing and a closing "?"). */
export const hasQuestion = (questions: WorkspaceQuestion[], text: string): boolean =>
  questions.some((q) => keyOf(q.text) === keyOf(text));

/**
 * Why `text` cannot replace question `index`: empty, or the same as another question on the
 * list. Null when it can.
 */
export function editProblem(
  questions: WorkspaceQuestion[],
  index: number,
  text: string,
): string | null {
  if (keyOf(text) === '') return 'A question cannot be empty.';
  if (questions.some((q, i) => i !== index && keyOf(q.text) === keyOf(text))) {
    return 'That question is already on the list.';
  }
  return null;
}
