import {
  QUESTION_LABELS,
  type QuestionInput,
  type QuestionLineLabels,
  type QuestionSource,
  questionKey,
  type SiteQuestionTemplate,
} from '@citation-equity/engine';
import { sampleBench } from './bench';
import type { Sample } from './samples';

/** The engine's sources, plus a sample pack's own reader questions. */
export type WorkspaceQuestionSource = QuestionSource | 'sample-pack';
export interface WorkspaceQuestion {
  text: string;
  source: WorkspaceQuestionSource;
  /**
   * How the home's list made it from what was typed there: kept as a question (`as-written`) or
   * guessed from a keyword (any other template). It sets the input kind of a `keywords` question.
   */
  template?: SiteQuestionTemplate;
}

export const MAX_QUESTIONS = 8;

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

/** Every template the engine's keyword list can store, so a stored one can be checked. */
const TEMPLATES: Record<SiteQuestionTemplate, true> = {
  'as-written': true,
  'what-is': true,
  'how-to': true,
  'how-it-works': true,
  comparison: true,
  best: true,
  'yes-no': true,
  kept: true,
};

/** True for one of the engine's keyword-list templates. */
export const isQuestionTemplate = (v: unknown): v is SiteQuestionTemplate =>
  typeof v === 'string' && Object.hasOwn(TEMPLATES, v);

/**
 * Where each source's questions came from, as our tests can speak to it. Our tests used the
 * reader's exact question, so only questions the writer gives as the reader's own carry the
 * measured label; a keyword guess and a local model's question carry what E5 found for guesses,
 * and the page's own always read Not tested. `keywords` is decided by its template (see
 * inputKindOf).
 */
const KIND: Record<Exclude<WorkspaceQuestionSource, 'keywords'>, QuestionInput> = {
  user: 'reader',
  'sample-pack': 'reader',
  'search-console': 'reader',
  'bing-ai': 'reader',
  'local-model': 'local-model',
  'draft-heading': 'page',
  template: 'page',
};

/**
 * A question's input kind. A home-list item typed as a question is the reader's own; one turned
 * into a question from a keyword, or kept as typed, is a keyword guess, and so is one saved
 * before templates were stored.
 */
export function inputKindOf(q: WorkspaceQuestion): QuestionInput {
  if (q.source === 'keywords') return q.template === 'as-written' ? 'reader' : 'keyword';
  return KIND[q.source];
}

/** A question row's two line labels (words up top, answered), from the engine's table. */
export const labelsFor = (q: WorkspaceQuestion): QuestionLineLabels =>
  QUESTION_LABELS[inputKindOf(q)];

/** The engine's key: case, spacing and closing punctuation ignored, so "What is crema" = "What is crema?". */
const keyOf = questionKey;

/**
 * The questions a draft starts with: a sample's pack queries, else none, so the page's own
 * title and topic questions are measured until the author adds theirs. Heading questions wait
 * for a click on the button that adds them.
 */
export function initialQuestions(sample: Sample | null): WorkspaceQuestion[] {
  const pack = sampleBench(sample)?.pack;
  if (!pack || pack.queries.length === 0) return [];
  return mergeQuestions(
    [],
    pack.queries.map((q) => ({ text: q.query, source: 'sample-pack' as const })),
  );
}

/**
 * `current` plus each of `incoming` not already there (ignoring case, spacing and a closing "?"),
 * up to 8. A question keeps its template, when it has one.
 */
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
    out.push({
      text: q.text.trim(),
      source: q.source,
      ...(q.template === undefined ? {} : { template: q.template }),
    });
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
