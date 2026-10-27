import type { TargetQuestion } from '@citation-equity/engine';
import { DEFAULT_SETTINGS, type EngineAdapter } from './types';

const DEFAULT_MAX = 8;

/** The one prompt `fanOutQuestions` sends: the draft's title (when it has one) and intro only. */
export function fanOutPrompt(input: { title: string; intro: string }, max: number): string {
  return [
    `List up to ${max} questions a reader might ask an AI assistant about the topic of this page, including follow-up questions and comparisons with alternatives.`,
    'Write one per line, as plain questions that end with a question mark, and write nothing else.',
    '',
    ...(input.title.trim() === '' ? [] : [`Title: ${input.title.trim()}`]),
    `Introduction: ${input.intro.trim()}`,
  ].join('\n');
}

/** A line of the answer as a question: list markers, bold and quotes removed. */
const cleanLine = (line: string): string =>
  line
    .trim()
    .replace(/^(?:[-*•]|\d+[.)])\s+/u, '')
    .replace(/^\*\*(.*)\*\*$/u, '$1')
    .replace(/^["“](.*)["”]$/u, '$1')
    .trim();

/**
 * Asks a model (a local one in the workspace) for questions readers might ask about the
 * draft's topic. Only the title and intro are sent. Keeps the lines that end in "?", without
 * repeats (ignoring case), at most `max` (default 8), each with source 'local-model'.
 */
export async function fanOutQuestions(
  input: { title: string; intro: string },
  adapter: EngineAdapter,
  opts: { model: string; seed?: number; max?: number },
): Promise<TargetQuestion[]> {
  const max = opts.max ?? DEFAULT_MAX;
  if (max <= 0) return [];
  const answer = await adapter.generate(fanOutPrompt(input, max), {
    model: opts.model,
    seed: opts.seed ?? 1,
    temperature: DEFAULT_SETTINGS.temperature,
  });
  const out: TargetQuestion[] = [];
  const seen = new Set<string>();
  for (const line of answer.split('\n')) {
    const text = cleanLine(line);
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (!text.endsWith('?') || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, source: 'local-model' });
    if (out.length === max) break;
  }
  return out;
}

const KEYWORDS_MAX = 10;
const SEARCHES_MAX = 8;
/** A line longer than this is an explanation, not a search. */
const SEARCH_WORDS = 10;

/** The one prompt `keywordQuestions` sends: the site's keywords, and nothing else. */
export function keywordQuestionsPrompt(keywords: string[], max: number): string {
  return [
    `These are search keywords for one website. List up to ${max} questions its readers might ask an AI assistant that these keywords point to.`,
    'Write one per line, as plain questions that end with a question mark, and write nothing else.',
    '',
    'Keywords:',
    ...keywords.map((k) => `- ${k.trim()}`),
  ].join('\n');
}

/**
 * Asks a model (a local one in the workspace) for more reader questions from the site's
 * keywords. Only the keywords are sent. Keeps the lines that end in "?", without repeats
 * (ignoring case), at most `max` (default 10), each with source 'local-model'.
 */
export async function keywordQuestions(
  keywords: string[],
  adapter: EngineAdapter,
  opts: { model: string; seed?: number; max?: number },
): Promise<TargetQuestion[]> {
  const max = opts.max ?? KEYWORDS_MAX;
  const list = keywords.map((k) => k.trim()).filter((k) => k !== '');
  if (max <= 0 || list.length === 0) return [];
  const answer = await adapter.generate(keywordQuestionsPrompt(list, max), {
    model: opts.model,
    seed: opts.seed ?? 1,
    temperature: DEFAULT_SETTINGS.temperature,
  });
  const out: TargetQuestion[] = [];
  const seen = new Set<string>();
  for (const line of answer.split('\n')) {
    const text = cleanLine(line);
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (!text.endsWith('?') || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, source: 'local-model' });
    if (out.length === max) break;
  }
  return out;
}

/** The one prompt `searchQueries` sends: the question, and nothing else. */
export function searchQueriesPrompt(question: string, max: number): string {
  return [
    `List up to ${max} web searches an AI answer engine might run before answering this question.`,
    'Write one short search per line, and write nothing else.',
    '',
    `Question: ${question.trim()}`,
  ].join('\n');
}

/**
 * Asks a model (a local one in the workspace) for the searches an answer engine might run
 * behind a question. Only the question is sent. Keeps short lines (up to 10 words) that are not
 * a heading ("Here are the searches:"), without repeats (ignoring case), at most `max`
 * (default 8).
 */
export async function searchQueries(
  question: string,
  adapter: EngineAdapter,
  opts: { model: string; seed?: number; max?: number },
): Promise<string[]> {
  const max = opts.max ?? SEARCHES_MAX;
  if (max <= 0 || question.trim() === '') return [];
  const answer = await adapter.generate(searchQueriesPrompt(question, max), {
    model: opts.model,
    seed: opts.seed ?? 1,
    temperature: DEFAULT_SETTINGS.temperature,
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of answer.split('\n')) {
    const text = cleanLine(line);
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    const words = text.split(/\s+/).length;
    if (text === '' || text.endsWith(':') || words > SEARCH_WORDS || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === max) break;
  }
  return out;
}
