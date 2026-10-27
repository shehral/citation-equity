// `ce questions`: target questions from real queries (a Search Console or Bing AI Performance
// CSV export), from the site's keyword list, or generated from a draft, printed one per line
// with `#` comment lines, so the output can be saved and passed to `ce analyze --questions`.
// `--fanout` adds, as comment lines, the searches an answer engine is likely to run behind each.
import { basename, extname } from 'node:path';
import {
  fanOutSearches,
  generateQuestions,
  type ImportedQuery,
  type KeywordRow,
  parseBingAiQueries,
  parseDraft,
  parseKeywordList,
  parseSearchConsoleQueries,
  type QuestionSource,
  queryNumbers,
  questionContext,
  questionKey,
  rankImportedQueries,
  rankingNote,
  siteQuestionNumbers,
  siteQuestions,
  type TargetQuestion,
} from '@citation-equity/engine';
import type { Command } from 'commander';
import { OllamaAdapter } from '../adapters/ollama';
import { fanOutQuestions, keywordQuestions } from '../questions-llm';
import { DEFAULT_SETTINGS } from '../types';
import type { CliIo } from './cli';
import { printable, readText } from './cli-util';

const MAX = 8;

const LABELS: Record<QuestionSource, string> = {
  'draft-heading': 'Your heading',
  template: 'Template',
  'local-model': 'Local model',
  'search-console': 'Search Console',
  'bing-ai': 'Bing AI Performance',
  keywords: 'Your keywords',
  user: 'By you',
};

const CIRCULARITY =
  "# Questions generated from your own draft tend to look covered; real readers' queries are the better test.";
const SAVE =
  '# Read locally; nothing is sent anywhere. Save this output and pass it to ce analyze --questions.';
const FANOUT_NOTE = [
  '# Under each question, the searches behind it. Answer engines often search for these before answering.',
  '# Cover the ones your readers care about. Made from templates; not tested for citation.',
];

interface QuestionsOptions {
  fromSearchConsole?: string;
  fromBing?: string;
  keywords?: string;
  generate?: string;
  fanout?: boolean;
  localModel?: boolean;
  model?: string;
}

/** Adds `ce questions` to the program. */
export function registerQuestions(program: Command, io: CliIo): void {
  program
    .command('questions')
    .description(
      'List target questions from real queries (Search Console or Bing AI Performance CSV), your keyword list, or a draft.',
    )
    .option('--from-search-console <file>', 'Search Console Performance export, Queries table')
    .option('--from-bing <file>', 'Bing AI Performance export, grounding queries table')
    .option(
      '--keywords <file>',
      'the site keyword list: one per line with an optional volume after a comma or tab, a table with a Keyword column, or JSON',
    )
    .option('--generate <draft>', "generate from a draft's title, headings and first paragraph")
    .option('--fanout', 'also list the searches an answer engine may run behind each question')
    .option(
      '--local-model',
      'with --generate or --keywords: also ask the local Ollama model for questions',
    )
    .option('--model <name>', `local model (default: ${DEFAULT_SETTINGS.model})`)
    .action(async (o: QuestionsOptions) => {
      const csv = o.fromSearchConsole !== undefined || o.fromBing !== undefined;
      const keywords = o.keywords !== undefined;
      if (!csv && !keywords && o.generate === undefined) {
        throw new Error('Pass --from-search-console, --from-bing, --keywords or --generate.');
      }
      if ((csv || keywords) && o.generate !== undefined) {
        throw new Error('--generate cannot be combined with --keywords or the CSV options.');
      }
      if (o.localModel && o.generate === undefined && !keywords) {
        throw new Error('--local-model works with --generate or --keywords.');
      }
      const out = keywords
        ? await fromKeywords(o, io)
        : o.generate === undefined
          ? await fromCsv(o)
          : await fromDraft(o, io);
      io.stdout(out);
    });
}

/** The question line, and with --fanout its searches as comment lines. */
function questionBlock(text: string, fanout: boolean | undefined): string[] {
  const lines = [printable(text)];
  if (!fanout) return lines;
  const searches = fanOutSearches(text);
  if (searches.length === 0) return lines;
  return [
    ...lines,
    '#   Searches behind this question:',
    ...searches.map((s) => `#   - ${printable(s)}`),
  ];
}

async function readImports(
  o: QuestionsOptions,
): Promise<{ queries: ImportedQuery[]; files: string[] }> {
  const queries: ImportedQuery[] = [];
  const files: string[] = [];
  if (o.fromSearchConsole !== undefined) {
    queries.push(...parseSearchConsoleQueries(await readText(o.fromSearchConsole)));
    files.push(`${basename(o.fromSearchConsole)} (Search Console)`);
  }
  if (o.fromBing !== undefined) {
    queries.push(...parseBingAiQueries(await readText(o.fromBing)));
    files.push(`${basename(o.fromBing)} (Bing AI Performance)`);
  }
  return { queries, files };
}

async function fromCsv(o: QuestionsOptions): Promise<string> {
  const { queries, files } = await readImports(o);
  const ranked = rankImportedQueries(queries).slice(0, MAX);
  const lines = [`# Target questions from ${files.join(' and ')}, ${rankingNote(queries)}.`, SAVE];
  if (o.fanout) lines.push(...FANOUT_NOTE);
  if (ranked.length === 0) lines.push('', '# No queries in the file.');
  for (const [i, { query, question }] of ranked.entries()) {
    // Shown when the question is more than the query with a capital and "?".
    const asked =
      questionKey(question.text) === questionKey(query.text)
        ? ''
        : ` Query: "${printable(query.text)}"`;
    lines.push('', `# ${i + 1}. ${LABELS[query.source]}: ${queryNumbers(query)}.${asked}`);
    lines.push(...questionBlock(question.text, o.fanout));
  }
  return `${lines.join('\n')}\n`;
}

/** A keyword list file: JSON (strings, or objects with a keyword and a volume), else text. */
function parseKeywordFile(text: string, path: string): KeywordRow[] {
  if (!/\.json$/i.test(path) && !/^\s*[[{]/.test(text)) return parseKeywordList(text);
  const fail = () =>
    new Error(
      '--keywords: a JSON list of keywords is an array of strings or of objects like {"keyword": "espresso bitter", "volume": 880}.',
    );
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw fail();
  }
  const list = Array.isArray(data) ? data : (data as { keywords?: unknown } | null)?.keywords;
  if (!Array.isArray(list)) throw fail();
  return list.flatMap((item): KeywordRow[] => {
    if (typeof item === 'string') return item.trim() === '' ? [] : [{ text: item.trim() }];
    if (typeof item !== 'object' || item === null) throw fail();
    const r = item as Record<string, unknown>;
    const keyword = [r.keyword, r.query, r.text].find((v) => typeof v === 'string') as
      | string
      | undefined;
    if (keyword === undefined) throw fail();
    const volume = [r.volume, r.searches, r.impressions].find(
      (v) => typeof v === 'number' && Number.isFinite(v),
    ) as number | undefined;
    if (keyword.trim() === '') return [];
    return [volume === undefined ? { text: keyword.trim() } : { text: keyword.trim(), volume }];
  });
}

async function fromKeywords(o: QuestionsOptions, io: CliIo): Promise<string> {
  const path = o.keywords as string;
  const rows = parseKeywordFile(await readText(path), path);
  const { queries, files } = await readImports(o);
  const model = o.model ?? DEFAULT_SETTINGS.model;
  const lines: string[] = [];
  let suggested: string[] = [];
  if (o.localModel) {
    const found = await keywordQuestions(
      rows.map((r) => r.text),
      new OllamaAdapter({ fetch: io.fetch }),
      { model },
    );
    suggested = found.map((q) => q.text);
  }
  const list = siteQuestions({ keywords: rows, queries, suggested });
  const citations = list.some((q) => q.citations !== undefined);
  const volume = list.some((q) => q.volume !== undefined);
  const ranking = citations
    ? 'ranked by citations, then volume, then list order'
    : volume
      ? 'ranked by volume, then list order'
      : 'in list order';
  lines.push(
    `# Questions for your site from ${[basename(path), ...files].join(' and ')}, ${ranking}.`,
    SAVE,
  );
  if (o.localModel) {
    lines.push(`# Also asked ${model} on the local Ollama server; only the keywords were sent.`);
  }
  if (o.fanout) lines.push(...FANOUT_NOTE);
  if (list.length === 0) lines.push('', '# No keywords in the file.');
  for (const [i, q] of list.entries()) {
    const label = q.source === 'local-model' ? `${LABELS[q.source]} (${model})` : LABELS[q.source];
    const numbers = siteQuestionNumbers(q).replace(/^Volume/, 'volume');
    const what = q.source === 'keywords' ? 'Keyword' : 'Query';
    const asked =
      q.source === 'local-model' || questionKey(q.text) === questionKey(q.keyword)
        ? ''
        : ` ${what}: "${printable(q.keyword)}"`;
    lines.push('', `# ${i + 1}. ${label}${numbers === '' ? '' : `: ${numbers}`}.${asked}`);
    lines.push(...questionBlock(q.text, o.fanout));
  }
  return `${lines.join('\n')}\n`;
}

async function fromDraft(o: QuestionsOptions, io: CliIo): Promise<string> {
  const path = o.generate as string;
  const source = await readText(path);
  const format = /^\.html?$/i.test(extname(path)) ? 'html' : 'markdown';
  const markdown = parseDraft(source, format).markdown;
  const questions: TargetQuestion[] = generateQuestions(markdown, { max: MAX });
  const lines = [
    `# Target questions generated from ${basename(path)} (title, headings and first paragraph).`,
    CIRCULARITY,
  ];
  if (o.fanout) lines.push(...FANOUT_NOTE);
  const model = o.model ?? DEFAULT_SETTINGS.model;
  if (o.localModel && questions.length >= MAX) {
    // The list is full, so a model question could not be added: nothing is sent.
    lines.push(
      `# Did not ask ${model}: the draft already gave ${MAX} questions, the most this lists.`,
    );
  } else if (o.localModel) {
    lines.push(
      `# Also asked ${model} on the local Ollama server; only the title and intro were sent.`,
    );
    const found = await fanOutQuestions(
      questionContext(markdown),
      new OllamaAdapter({ fetch: io.fetch }),
      { model, max: MAX },
    );
    const seen = new Set(questions.map((q) => questionKey(q.text)));
    for (const q of found) {
      if (questions.length >= MAX) break;
      if (seen.has(questionKey(q.text))) continue;
      seen.add(questionKey(q.text));
      questions.push(q);
    }
  }
  if (questions.length === 0) lines.push('', '# No questions could be generated from this draft.');
  for (const [i, q] of questions.entries()) {
    const label = q.source === 'local-model' ? `${LABELS[q.source]} (${model})` : LABELS[q.source];
    lines.push('', `# ${i + 1}. ${label}`, ...questionBlock(q.text, o.fanout));
  }
  return `${lines.join('\n')}\n`;
}
