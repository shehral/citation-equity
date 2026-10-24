// `ce questions`: target questions from real queries (a Search Console or Bing AI Performance
// CSV export) or generated from a draft, printed one per line with `#` comment lines, so the
// output can be saved and passed to `ce analyze --questions`.
import { basename, extname } from 'node:path';
import {
  generateQuestions,
  type ImportedQuery,
  parseBingAiQueries,
  parseDraft,
  parseSearchConsoleQueries,
  type QuestionSource,
  queryNumbers,
  questionContext,
  questionKey,
  rankImportedQueries,
  rankingNote,
  type TargetQuestion,
} from '@citation-equity/engine';
import type { Command } from 'commander';
import { OllamaAdapter } from '../adapters/ollama';
import { fanOutQuestions } from '../questions-llm';
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
  user: 'By you',
};

const CIRCULARITY =
  "# Questions generated from your own draft tend to look covered; real readers' queries are the better test.";

interface QuestionsOptions {
  fromSearchConsole?: string;
  fromBing?: string;
  generate?: string;
  localModel?: boolean;
  model?: string;
}

/** Adds `ce questions` to the program. */
export function registerQuestions(program: Command, io: CliIo): void {
  program
    .command('questions')
    .description(
      'List target questions from real queries (Search Console or Bing AI Performance CSV) or from a draft.',
    )
    .option('--from-search-console <file>', 'Search Console Performance export, Queries table')
    .option('--from-bing <file>', 'Bing AI Performance export, grounding queries table')
    .option('--generate <draft>', "generate from a draft's title, headings and first paragraph")
    .option('--local-model', 'with --generate: also ask the local Ollama model for questions')
    .option('--model <name>', `local model (default: ${DEFAULT_SETTINGS.model})`)
    .action(async (o: QuestionsOptions) => {
      const csv = o.fromSearchConsole !== undefined || o.fromBing !== undefined;
      if (!csv && o.generate === undefined) {
        throw new Error('Pass --from-search-console, --from-bing or --generate.');
      }
      if (csv && o.generate !== undefined) {
        throw new Error('--generate cannot be combined with the CSV options.');
      }
      if (o.localModel && o.generate === undefined) {
        throw new Error('--local-model works with --generate.');
      }
      io.stdout(o.generate === undefined ? await fromCsv(o) : await fromDraft(o, io));
    });
}

async function fromCsv(o: QuestionsOptions): Promise<string> {
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
  const ranked = rankImportedQueries(queries).slice(0, MAX);
  const lines = [
    `# Target questions from ${files.join(' and ')}, ${rankingNote(queries)}.`,
    '# Read locally; nothing is sent anywhere. Save this output and pass it to ce analyze --questions.',
  ];
  if (ranked.length === 0) lines.push('', '# No queries in the file.');
  for (const [i, { query, question }] of ranked.entries()) {
    // Shown when the question is more than the query with a capital and "?".
    const asked =
      questionKey(question.text) === questionKey(query.text)
        ? ''
        : ` Query: "${printable(query.text)}"`;
    lines.push('', `# ${i + 1}. ${LABELS[query.source]}: ${queryNumbers(query)}.${asked}`);
    lines.push(printable(question.text));
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
    lines.push('', `# ${i + 1}. ${label}`, printable(q.text));
  }
  return `${lines.join('\n')}\n`;
}
