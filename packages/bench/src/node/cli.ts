import { realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AnalysisResult,
  analyze,
  CHECK_DEFINITIONS,
  generateQuestions,
  parseDraft,
  READINESS_NOTE,
} from '@citation-equity/engine';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { AdapterUnavailableError, ModelMissingError } from '../adapters/errors';
import { DEFAULT_OLLAMA_HOST, OllamaAdapter } from '../adapters/ollama';
import { DEFAULT_OPENAI_BASE_URL, OpenAICompatibleAdapter } from '../adapters/openai-compatible';
import { RecordedAdapter, RecordingAdapter } from '../adapters/recorded';
import { CAVEAT, REMOTE_CAVEAT } from '../caveat';
import { chanceLevel, minSignFlipP } from '../metrics';
import { competitorProfile } from '../profile';
import { compareReports, runBench } from '../run';
import type { BenchDraft, BenchReport, Comparison, EngineAdapter, Pack } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { collectPrompts, countMissing, readAnswers, writePrompts } from './batch';
import { printable, rate, readText, writeJson } from './cli-util';
import { buildCseoPack, CSEO_DOMAINS, type CseoDomain } from './cseo';
import { packFromUrls } from './from-urls';
import { MissingApiKeyError, registerLive } from './live';
import { loadPack } from './load-pack';
import { registerQuestions } from './questions';
import { registerSignals } from './signals';
import { checkSite, type SiteReport } from './site';
import { registerSources } from './sources';

/** Where the CLI writes and which fetch it uses; tests pass their own. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Transient progress lines (a terminal only); omitted, no progress is shown. */
  progress?: (text: string) => void;
  fetch?: typeof fetch;
}

/** Builds the `ce` program. Commander's own exits are turned into thrown CommanderErrors. */
export function createProgram(io: CliIo): Command {
  const out = io.stdout;
  const program = new Command('ce')
    .description(
      'Citation Equity: check a draft, and test it on a local model over a fixed page set.',
    )
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride()
    .showHelpAfterError('(run ce --help for usage)');

  program
    .command('analyze')
    .description('Score a draft under both presets and list its checks and suggestions.')
    .argument('<file>', 'Markdown or HTML draft')
    .addOption(
      new Option('--format <format>', 'input format (default: from the file extension)').choices([
        'md',
        'html',
      ]),
    )
    .option('--json', 'print the full analysis as JSON')
    .option(
      '--questions <file>',
      "target questions, one per line (# starts a comment; default: the draft's own question headings)",
    )
    .action(
      async (file: string, o: { format?: 'md' | 'html'; json?: boolean; questions?: string }) => {
        const source = await readText(file);
        const format = (o.format ? o.format === 'html' : /\.html?$/i.test(file))
          ? 'html'
          : 'markdown';
        // Without a file, the draft's own question headings are scored; template rewrites are
        // only suggested, since the author has not accepted them.
        const generated = o.questions ? [] : generateQuestions(parseDraft(source, format).markdown);
        const questions = o.questions
          ? (await readText(o.questions))
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l !== '' && !l.startsWith('#'))
          : generated.filter((q) => q.source === 'draft-heading').map((q) => q.text);
        const suggested = generated.filter((q) => q.source !== 'draft-heading').map((q) => q.text);
        const result = analyze(source, { format, questions });
        if (o.json) {
          out(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
        const from = o.questions
          ? `from ${basename(o.questions)}`
          : "the draft's own question headings; pass --questions to use your own";
        const listed = questions.length > 0 ? questions.map((q) => `- ${q}`) : ['- none'];
        const more =
          suggested.length > 0
            ? `\nSuggested from the draft's title and headings (not scored; add the ones you want to a --questions file):\n${suggested.map((q) => `- ${q}`).join('\n')}\n`
            : '';
        out(
          `Target questions (${from}):\n${listed.join('\n')}\n${more}\n${formatAnalysis(result, format)}`,
        );
      },
    );

  program
    .command('bench')
    .description(
      'Run a draft (and optionally its revision) through a pack on a model: local Ollama by default, or an OpenAI-compatible server.',
    )
    .requiredOption('--draft <before.md>', 'the draft to test')
    .option('--after <after.md>', 'a revised draft to compare with the first')
    .requiredOption('--pack <pack.json>', 'the pack of queries and competitor pages')
    .option('--runs <n>', `runs per query (default: ${DEFAULT_SETTINGS.runs})`, positiveInt)
    .option(
      '--k <n>',
      `documents retrieved per query (default: ${DEFAULT_SETTINGS.k})`,
      positiveInt,
    )
    .addOption(
      new Option('--adapter <name>', 'model server API')
        .choices(['ollama', 'openai'] as const)
        .default('ollama'),
    )
    .option(
      '--base-url <url>',
      `server URL (default: ${DEFAULT_OLLAMA_HOST} for ollama, ${DEFAULT_OPENAI_BASE_URL} for openai)`,
    )
    .option(
      '--send-key',
      'with --adapter openai: send OPENAI_API_KEY to a --base-url that is not https (it travels unencrypted)',
    )
    .option(
      '--model <name>',
      `model name, also part of each answer's key (default: ${DEFAULT_SETTINGS.model})`,
    )
    .option(
      '--temperature <t>',
      `sampling temperature (default: ${DEFAULT_SETTINGS.temperature})`,
      nonNegativeNumber,
    )
    .option('--seed <n>', `base seed (default: ${DEFAULT_SETTINGS.baseSeed})`, integer)
    .option(
      '--num-ctx <tokens>',
      `context window per generation (default: ${DEFAULT_SETTINGS.numCtx})`,
      positiveInt,
    )
    .option('--out <dir>', 'where to write the JSON results', 'results')
    .option('--record', 'also write recording.json, for replay with RecordedAdapter')
    .addOption(
      new Option(
        '--export-prompts <file.jsonl>',
        'write every prompt as JSONL for a batch job (experiments/README.md) and exit; no model is contacted',
      ).conflicts(['answers', 'record']),
    )
    .addOption(
      new Option(
        '--answers <file>',
        'replay answers from a batch job (JSONL) or a recording.json instead of asking a model',
      ).conflicts(['adapter', 'baseUrl', 'sendKey']),
    )
    .action(async (o: BenchOptions) => bench(o, io));

  const pack = program.command('pack').description('Build a pack file.');
  pack
    .command('from-urls')
    .description('Fetch pages you name (robots.txt respected) into a one-query pack.')
    .requiredOption('--question <q>', 'the question the pages answer')
    .requiredOption('--urls <file>', 'text file with one URL per line (# starts a comment)')
    .requiredOption('--id <packId>', 'pack id')
    .requiredOption('--out <pack.json>', 'where to write the pack')
    .action(async (o: { question: string; urls: string; id: string; out: string }) => {
      const urls = (await readText(o.urls))
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#'));
      const result = await packFromUrls({
        question: o.question,
        urls,
        packId: o.id,
        fetchImpl: io.fetch,
        onSkip: (url, reason) => io.stderr(`Skipped ${url}: ${reason}\n`),
      });
      await writeJson(o.out, result);
      out(`Wrote ${o.out} (${result.queries[0].documents.length} of ${urls.length} pages)\n`);
    });
  pack
    .command('cseo')
    .description('Download a C-SEO Bench QA subset (not redistributed; cached locally).')
    .option('--domains <list>', `comma-separated: ${CSEO_DOMAINS.join(', ')}`, domainList, [
      'web',
      'news',
    ] as CseoDomain[])
    .option('--max-queries <n>', 'queries in the pack', positiveInt, 20)
    .option('--max-doc-chars <n>', 'drop documents longer than this', positiveInt, 4000)
    .option('--cache-dir <dir>', 'download cache (gitignored)', join('.cache', 'cseo'))
    .requiredOption('--out <pack.json>', 'where to write the pack')
    .action(
      async (o: {
        domains: CseoDomain[];
        maxQueries: number;
        maxDocChars: number;
        cacheDir: string;
        out: string;
      }) => {
        const { out: outPath, ...build } = o;
        const result = await buildCseoPack({ ...build, fetchImpl: io.fetch });
        await writeJson(outPath, result);
        out(`Wrote ${outPath} (${result.queries.length} queries)\n`);
      },
    );

  program
    .command('site')
    .description(
      'Check a published page: AI crawler access in robots.txt, rendering without JavaScript, and page metadata.',
    )
    .argument('<url>', 'the published page')
    .option('--json', 'print the full report as JSON')
    .action(async (url: string, o: { json?: boolean }) => {
      const report = await checkSite(url, { fetchImpl: io.fetch });
      out(o.json ? `${JSON.stringify(report, null, 2)}\n` : formatSite(report));
    });

  registerSignals(program, io);
  registerQuestions(program, io);
  registerLive(program, io);
  registerSources(program, io);

  return program;
}

/**
 * Runs `ce` with user arguments (no `node` or script path) and resolves to the exit code:
 * 0 success, 1 a usage or input error, 2 the model server not reachable, the model not available,
 * or a required API key not set.
 */
export async function runCli(args: string[], io?: Partial<CliIo>): Promise<number> {
  const full: CliIo = {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    // Progress only when run for real in a terminal; callers passing io opt in themselves.
    progress: io === undefined && process.stderr.isTTY ? (s) => process.stderr.write(s) : undefined,
    ...io,
  };
  try {
    await createProgram(full).parseAsync(args, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode; // commander already printed it
    // These messages end with their one-line fix.
    if (
      err instanceof AdapterUnavailableError ||
      err instanceof ModelMissingError ||
      err instanceof MissingApiKeyError
    ) {
      full.stderr(`${err.message}\n`);
      return 2;
    }
    full.stderr(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

interface BenchOptions {
  draft: string;
  after?: string;
  pack: string;
  adapter: 'ollama' | 'openai';
  baseUrl?: string;
  sendKey?: boolean;
  runs?: number;
  k?: number;
  model?: string;
  temperature?: number;
  seed?: number;
  numCtx?: number;
  out: string;
  record?: boolean;
  exportPrompts?: string;
  answers?: string;
}

async function bench(o: BenchOptions, io: CliIo): Promise<void> {
  const out = io.stdout;
  const pack = await loadPack(o.pack);
  const before = await readDraft(o.draft, 'before');
  const drafts = [before];
  if (o.after) drafts.push(await readDraft(o.after, 'after'));
  // Omitted flags stay undefined; runBench falls back to DEFAULT_SETTINGS for them.
  const settings = {
    runs: o.runs,
    k: o.k,
    model: o.model,
    temperature: o.temperature,
    baseSeed: o.seed,
    numCtx: o.numCtx,
  };

  if (o.exportPrompts) {
    const lines = [];
    for (const draft of drafts) lines.push(...(await collectPrompts(pack, draft, settings)));
    await writePrompts(o.exportPrompts, lines);
    const runs = new Set(lines.map((l) => l.run)).size;
    const model = lines[0]?.model;
    out(
      `Wrote ${lines.length} prompts (${drafts.length} draft${drafts.length === 1 ? '' : 's'} x ${pack.queries.length} quer${pack.queries.length === 1 ? 'y' : 'ies'} x ${runs} run${runs === 1 ? '' : 's'}, model ${model}) to ${o.exportPrompts}\n` +
        'Answer them with experiments/explorer/batch_generate.py, then replay with the same flags and --answers <answers.jsonl> in place of --export-prompts.\n',
    );
    return;
  }

  let server: EngineAdapter;
  if (o.answers) {
    const answers = readAnswers(await readText(o.answers));
    let missing = 0;
    let total = 0;
    for (const draft of drafts) {
      const lines = await collectPrompts(pack, draft, settings);
      missing += countMissing(lines, answers);
      total += lines.length;
    }
    if (missing > 0) {
      throw new Error(
        `${missing} of ${total} prompts have no answer in ${o.answers}. Answers are keyed by model, seed, temperature, prompt and any context window other than the default: replay with the --model, --runs, --k, --seed, --temperature and --num-ctx used for --export-prompts.`,
      );
    }
    // The bench cannot tell where replayed answers came from, so it does not call the model local.
    server = new RecordedAdapter(answers, 'recorded', { caveat: REMOTE_CAVEAT });
  } else {
    server = benchAdapter(o, io);
  }
  const recorder = o.record ? new RecordingAdapter(server) : undefined;
  const adapter = recorder ?? server;
  const caveat = adapter.caveat ?? CAVEAT;

  // The caveat opens the output and closes it, also when a run fails part way.
  out(`${caveat}\n\n`);
  try {
    const progress = (label: string) =>
      io.progress
        ? (done: number, total: number) => {
            io.progress?.(`\r${label}: ${done}/${total} generations${done === total ? '\n' : ''}`);
          }
        : undefined;

    await mkdir(o.out, { recursive: true });
    const reports: BenchReport[] = [];
    for (const draft of drafts) {
      const report = await runBench(pack, draft, adapter, settings, progress(draft.id));
      await writeJson(join(o.out, `${draft.id}.json`), report);
      // Saved after each draft, so a failure in a later run keeps the answers already recorded.
      if (recorder) await writeJson(join(o.out, 'recording.json'), recorder.recording);
      reports.push(report);
      out(formatReport(report, draft));
    }
    let comparison: Comparison | undefined;
    if (reports.length === 2) {
      comparison = compareReports(reports[0], reports[1]);
      await writeJson(join(o.out, 'comparison.json'), comparison);
      out(formatComparison(comparison));
    }
    out(formatProfiles(reports, pack, drafts));
    const written = reports.map((r) => `${r.draftId}.json`);
    if (comparison) written.push('comparison.json');
    if (recorder) written.push('recording.json');
    out(`Wrote ${written.join(', ')} to ${o.out}\n\n`);
  } finally {
    out(`${caveat}\n`);
  }
}

/**
 * The model server for `ce bench`. The OpenAI key is read from the environment only and never
 * printed. It is sent only to an https server, or to any server with --send-key, so
 * a key exported for OpenAI does not travel in clear text to a plain-http LAN or third-party host.
 */
function benchAdapter(o: BenchOptions, io: CliIo): EngineAdapter {
  if (o.adapter === 'openai') {
    const baseUrl = o.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
    const key = process.env.OPENAI_API_KEY || undefined;
    const https = /^https:\/\//i.test(baseUrl.trim());
    if (key && !https && !o.sendKey) {
      io.stderr(
        `OPENAI_API_KEY is set but not sent: ${baseUrl} is not https. Pass --send-key to send it anyway.\n`,
      );
    }
    return new OpenAICompatibleAdapter({
      baseUrl,
      apiKey: https || o.sendKey ? key : undefined,
      fetch: io.fetch,
    });
  }
  if (o.sendKey) throw new Error('--send-key works with --adapter openai.');
  return new OllamaAdapter({ host: o.baseUrl, fetch: io.fetch });
}

// ---------- formatting ----------

const signed = (x: number, digits: number) => `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;
const points = (x: number) => {
  const v = Math.round(x * 100); // -0 prints as "+0"
  return `${v >= 0 ? '+' : ''}${v} points`;
};

/** `text` on one line, at most `max` characters, with an ellipsis when cut. */
function excerpt(text: string, max = 80): string {
  const flat = printable(text.replace(/\s+/g, ' ').trim());
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

/** 1-based line of `offset` in `markdown`. */
function lineAt(markdown: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < Math.min(offset, markdown.length); i++) if (markdown[i] === '\n') line++;
  return line;
}

function formatAnalysis(result: AnalysisResult, format: 'markdown' | 'html' = 'markdown'): string {
  const lines: string[] = [];
  if (result.wordCount === 0) {
    lines.push('No content yet');
  } else {
    const score = (s: number | null) =>
      s === null ? 'not scored (no check applies)' : `${s} / 100`;
    lines.push(`Foundation score: ${score(result.scores.foundation)}`);
    lines.push(`Evidence score: ${score(result.scores.evidence)}`);
  }
  lines.push('');
  const defs = new Map(CHECK_DEFINITIONS.map((d) => [d.id, d]));
  const idWidth = Math.max(5, ...result.checks.map((c) => c.checkId.length));
  lines.push(`${'Check'.padEnd(idWidth)}  ${'Grade'.padEnd(8)}  Score  Title`);
  for (const c of result.checks) {
    const def = defs.get(c.checkId);
    const score = c.applicable ? String(Math.round(c.score * 100)) : 'n/a';
    lines.push(
      `${c.checkId.padEnd(idWidth)}  ${(def?.evidence.grade ?? '').padEnd(8)}  ${score.padStart(5)}  ${def?.title ?? ''}`,
    );
  }
  const suggestions = result.checks.flatMap((c) => c.suggestions);
  lines.push('');
  lines.push(
    suggestions.length === 0 ? 'Suggestions: none' : `Suggestions (${suggestions.length})`,
  );
  // Each suggestion says where it is (the line of the draft, or of the Markdown made from an HTML
  // draft), what text it is about, and the finding behind it, so it can be found and acted on.
  const findings = result.checks.flatMap((c) => c.findings);
  const where = format === 'html' ? 'Markdown line' : 'line';
  for (const s of suggestions) {
    lines.push(`  [${s.kind}] ${s.checkId}: ${s.title}`);
    const at = `${where} ${lineAt(result.markdown, s.range.start)}`;
    const change =
      s.kind === 'edit' && s.after !== undefined
        ? `"${excerpt(s.before)}" -> "${excerpt(s.after)}"`
        : `"${excerpt(s.before)}"`;
    lines.push(`      ${at}: ${change}`);
    const finding = findings.find(
      (f) =>
        f.checkId === s.checkId && f.range.start <= s.range.end && s.range.start <= f.range.end,
    );
    // Shown unless the title or rationale already says it.
    if (finding && finding.message !== s.title && !s.rationale.includes(finding.message)) {
      lines.push(`      ${printable(finding.message)}`);
    }
    lines.push(`      ${s.rationale}`);
  }
  lines.push('');
  lines.push('Grades say how well published studies support each check; see docs/evidence.md.');
  return `${lines.join('\n')}\n`;
}

/** A mean over `n` per-query means with its 95% t interval; one query has no interval. */
const share = (mean: number, [lo, hi]: [number, number], n: number) =>
  n < 2
    ? `${mean.toFixed(3)} (no interval: ${n === 1 ? 'one question' : 'no questions'})`
    : `${mean.toFixed(3)} (95% interval ${lo.toFixed(3)} to ${hi.toFixed(3)} over ${n} questions)`;

function formatReport(r: BenchReport, draft: BenchDraft): string {
  const queries = new Set(r.runs.map((x) => x.queryId)).size;
  const validQueries = new Set(r.runs.filter((x) => !x.formatFailure).map((x) => x.queryId)).size;
  const s = r.summary;
  const failures = s.formatFailures.k;
  return [
    `Draft "${draft.title}" (${r.draftId}): ${r.runs.length} runs over ${queries} quer${queries === 1 ? 'y' : 'ies'}, model ${r.settings.model}, ${r.settings.numCtx === null ? 'context window set by the server' : `context ${r.settings.numCtx} tokens`}`,
    `  Valid answers            ${s.validRuns} of ${r.runs.length} (${failures} format failure${failures === 1 ? '' : 's'})`,
    `  Cited among valid        ${rate(s.citedAmongValid)}`,
    // The share counts valid runs without the draft as 0; the chance level is per retrieved run.
    `  Draft share among valid  ${share(s.pawcAmongValid.mean, s.pawcAmongValid.interval, validQueries)}; ${chanceLevel(s.chanceShare)} when retrieved (${s.chanceShare.toFixed(3)})`,
    `  Retrieved                ${rate(s.retrieved)}`,
    `  Cited, all runs          ${rate(s.cited)}`,
    `  PAWC share, all runs     ${share(s.meanPawc, s.pawcInterval, queries)}`,
    '',
    '',
  ].join('\n');
}

function formatComparison(c: Comparison): string {
  const excluded =
    c.excludedQueries.length > 0
      ? ` (left out, no valid answer on one side: ${c.excludedQueries.join(', ')})`
      : '';
  // With one paired question the sign-flip p is 1 whatever the data, so it is not printed.
  const testable = c.nQueries >= 2;
  const p = (value: number) => (testable ? ` (sign-flip p = ${value.toFixed(3)})` : '');
  const floor = minSignFlipP(c.nQueries);
  const note = !testable
    ? [
        `  No paired test possible with ${c.nQueries === 1 ? 'one question' : 'no questions'}; add questions to the pack to test the change.`,
      ]
    : floor > 0.01
      ? [`  With ${c.nQueries} questions the smallest p this test can give is ${floor.toFixed(3)}.`]
      : [];
  return [
    `After vs before, paired over ${c.nQueries} quer${c.nQueries === 1 ? 'y' : 'ies'}${excluded}`,
    `  Format failures          ${points(c.delta.formatFailures)}`,
    `  Cited among valid        ${points(c.delta.citedAmongValid)}${p(c.pValue.citedAmongValid)}`,
    `  Draft share among valid  ${signed(c.delta.pawcAmongValid, 3)}${p(c.pValue.pawcAmongValid)}`,
    `  Retrieved                ${points(c.delta.retrieved)}`,
    ...note,
    '',
    '',
  ].join('\n');
}

function formatProfiles(reports: BenchReport[], pack: Pack, drafts: BenchDraft[]): string {
  const lines: string[] = [];
  reports.forEach((report, i) => {
    const { cited, medians, draft } = competitorProfile(report, pack, drafts[i]);
    lines.push(
      `Pages cited in the ${report.draftId} runs: median of ${cited.length} competitor pages vs the draft`,
    );
    for (const [key, median] of Object.entries(medians)) {
      const draftValue = draft?.[key as keyof typeof medians] ?? 0;
      lines.push(`  ${key.padEnd(10)}  ${String(median).padStart(6)}  vs ${draftValue}`);
    }
    lines.push('');
  });
  return `${lines.join('\n')}\n`;
}

function formatSite(r: SiteReport): string {
  const lines: string[] = [];
  const status = r.httpStatus === null ? 'page not fetched' : `HTTP ${r.httpStatus}`;
  // Sitemaps and item details hold text from the fetched page and robots.txt: untrusted.
  lines.push(`Site readiness for ${printable(r.url)} (${status}, checked ${r.fetchedAt})`);
  const robots = r.robotsTxtFound
    ? `found${r.sitemaps.length > 0 ? `; sitemaps: ${r.sitemaps.map(printable).join(', ')}` : ''}`
    : 'not found or not readable (see crawler-access below)';
  lines.push(`robots.txt: ${robots}`);
  lines.push('');
  const uaWidth = Math.max(7, ...r.crawlers.map((c) => c.userAgent.length));
  const opWidth = Math.max(8, ...r.crawlers.map((c) => c.operator.length));
  lines.push(
    `${'Crawler'.padEnd(uaWidth)}  ${'Operator'.padEnd(opWidth)}  ${'Purpose'.padEnd(13)}  Access`,
  );
  for (const c of r.crawlers) {
    lines.push(
      `${c.userAgent.padEnd(uaWidth)}  ${c.operator.padEnd(opWidth)}  ${c.purpose.padEnd(13)}  ${c.allowed ? 'allowed' : 'blocked'}`,
    );
  }
  lines.push('');
  const idWidth = Math.max(4, ...r.readiness.items.map((i) => i.id.length));
  lines.push(`${'Item'.padEnd(idWidth)}  ${'Status'.padEnd(7)}  ${'Grade'.padEnd(8)}  Detail`);
  for (const i of r.readiness.items) {
    lines.push(
      `${i.id.padEnd(idWidth)}  ${i.status.padEnd(7)}  ${i.evidence.grade.padEnd(8)}  ${printable(i.detail)}`,
    );
  }
  lines.push('');
  lines.push(
    'Grades say how well documentation and studies support each item; see docs/evidence.md.',
  );
  lines.push(READINESS_NOTE);
  return `${lines.join('\n')}\n`;
}

// ---------- input and output files ----------

/** The draft's title is its first H1, or the file name without extension. */
async function readDraft(path: string, id: string): Promise<BenchDraft> {
  const markdown = await readText(path);
  const h1 = /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown)?.[1];
  return { id, title: h1 ?? basename(path, extname(path)), markdown };
}

// ---------- option parsers ----------

function integer(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new InvalidArgumentError('Not an integer.');
  return Number(value);
}

function positiveInt(value: string): number {
  const n = integer(value);
  if (n < 1) throw new InvalidArgumentError('Must be 1 or more.');
  return n;
}

function nonNegativeNumber(value: string): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n) || n < 0) {
    throw new InvalidArgumentError('Must be a number, 0 or more.');
  }
  return n;
}

function domainList(value: string): CseoDomain[] {
  const domains = value.split(',').map((d) => d.trim());
  const unknown = domains.filter((d) => !(CSEO_DOMAINS as readonly string[]).includes(d));
  if (unknown.length > 0 || domains.length === 0) {
    throw new InvalidArgumentError(
      `Unknown domain ${unknown.join(', ')}; choose from ${CSEO_DOMAINS.join(', ')}.`,
    );
  }
  return domains as CseoDomain[];
}

/**
 * True when the module at `moduleUrl` is the script Node was started with (`argv1`, symlinks
 * resolved). It stands in for `import.meta.main`, which Node only has from 24.2, while the
 * engines field allows any Node 24.
 */
export function isEntryModule(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(fileURLToPath(moduleUrl)) === real(argv1);
}

// Run as a script (tsx src/node/cli.ts ...); bin/ce.js calls runCli on the built code instead.
if (import.meta.main ?? isEntryModule(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
