// Adapted from GEO-optim/GEO (https://github.com/GEO-optim/GEO), commit c9e985f2bc4b539a01e8e9d226ff2a3d8d29a888,
// licensed Apache-2.0: `query_prompt` and the source layout of `generate_answer` in src/generative_le.py,
// and the citation pattern of `extract_citations_new` in src/utils.py.
// Changes: TypeScript port; each source is headed `### Source [n]:` (GEO: `### Source n:`) and carries
// its title; sentences also break at line breaks, and citation markers written just after a sentence's
// full stop belong to that sentence (GEO's nltk splitter gives them to the next one).
// Deviation (bench schemaVersion 2): after the sources the prompt adds REMINDER, which is not in GEO.
// GEO's instruction stays verbatim at the top. In the first recorded runs, 9 of 32 answers in one
// condition carried no [n] at all and one answer was in French (GEO lists several languages).
import type { PackDocument } from './types';

const QUERY_PROMPT = `Write an accurate and concise answer for the given user question, using _only_ the provided summarized web search results. The answer should be correct, high-quality, and written by an expert using an unbiased and journalistic tone. The user's language of choice such as English, Français, Español, Deutsch, or 日本語 should be used. The answer should be informative, interesting, and engaging. The answer's logic and reasoning should be rigorous and defensible. Every sentence in the answer should be _immediately followed_ by an in-line citation to the search result(s). The cited search result(s) should fully support _all_ the information in the sentence. Search results need to be cited using [index]. When citing several search results, use [1][2][3] format rather than [1, 2, 3]. You can use multiple search results to respond comprehensively while avoiding irrelevant search results.

Question: {query}

Search Results:
{source_text}
`;

/** Restates the task after the sources, where a small model still sees it (not in GEO). */
export const REMINDER =
  'Answer the question above using only these sources. Write in English. End every sentence with its citation, for example [1][2].';

/** The GEO answer prompt with `sources` numbered [1]..[n] in the order given, ending with REMINDER. */
export function buildPrompt(query: string, sources: PackDocument[]): string {
  const sourceText = sources
    .map((s, i) => {
      const body = s.title.trim() ? `${s.title.trim()}\n${s.text}` : s.text;
      return `### Source [${i + 1}]:\n${body}\n`;
    })
    .join('\n\n');
  // One pass with a function replacement: `$` in page text is never read as a replacement pattern,
  // and a query that contains "{source_text}" is not filled in a second time.
  const geo = QUERY_PROMPT.replace(/\{(query|source_text)\}/g, (_, name) =>
    name === 'query' ? query : sourceText,
  );
  return `${geo}${REMINDER}`;
}

export interface ParsedAnswer {
  sentences: { text: string; citations: number[] }[];
}

/** GEO's citation marker: `[` + optional punctuation + digits + optional punctuation + `]`. */
const CITATION = /\[[^\p{L}\p{N}_\s]*\d+[^\p{L}\p{N}_\s]*\]/gu;
/** A sentence end, any closing quotes or brackets, any citation markers after it, then whitespace. */
const BOUNDARY = /([.!?]+["'”’)]*)((?:\s*\[[^\p{L}\p{N}_\s]*\d+[^\p{L}\p{N}_\s]*\])*)(?:\s+|$)/gu;

/** 1-based source numbers cited in `sentence`, in order, duplicates kept (GEO keeps them too). */
function citationsOf(sentence: string): number[] {
  return [...sentence.matchAll(CITATION)].map((m) => Number(/\d+/.exec(m[0])?.[0]));
}

/** `text` with its citation markers removed. */
export function stripCitations(text: string): string {
  return text.replace(CITATION, ' ');
}

const OPEN = /^\s*<(think|thinking|reasoning)>/i;

/**
 * `answer` without a leading reasoning trace. A reasoning model served through an
 * OpenAI-compatible server, or a batch run with thinking on, can return `<think>...</think>`
 * (also `<thinking>` or `<reasoning>`) before its answer; the trace's own [n] markers must not
 * count as citations. Every leading block is removed; an unterminated one is all reasoning, so
 * nothing is left. A bare closing `</think>` with no opening tag (some chat templates put the
 * opening tag in the prompt) ends a trace that started at the top, unless nothing follows it:
 * then the tag is stray and the text before it is the answer. Text after the answer starts is
 * kept as it is.
 */
export function stripReasoning(answer: string): string {
  let rest = answer;
  for (;;) {
    const open = OPEN.exec(rest);
    if (!open) break;
    const close = new RegExp(`</${open[1]}>`, 'i').exec(rest);
    if (!close) return '';
    rest = rest.slice(close.index + close[0].length);
  }
  if (rest === answer) {
    const bare = /<\/(think|thinking|reasoning)>/i.exec(answer);
    if (bare && !/<(think|thinking|reasoning)>/i.test(answer.slice(0, bare.index))) {
      const after = answer.slice(bare.index + bare[0].length);
      // With nothing after it, the tag is stray: the text before it is the answer.
      rest = after.trim() === '' ? answer.slice(0, bare.index).trimEnd() : after;
    }
  }
  return rest.trimStart();
}

/**
 * Splits a generated answer into sentences and reads the [n] markers of each. A leading
 * reasoning trace is dropped first (stripReasoning).
 */
export function parseAnswer(answer: string): ParsedAnswer {
  const sentences = stripReasoning(answer)
    .split(/\n/)
    .flatMap((line) => line.replace(BOUNDARY, '$1$2\u0000').split('\u0000'))
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text) => ({ text, citations: citationsOf(text) }));
  return { sentences };
}
