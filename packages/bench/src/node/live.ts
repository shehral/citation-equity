// `ce live`: asks a live engine that searches the web itself (Gemini with Google Search grounding)
// the author's questions, and records whether its sources include the author's page.
import { join } from 'node:path';
import { type Command, InvalidArgumentError, Option } from 'commander';
import { LIVE_CAVEAT } from '../caveat';
import { wilson } from '../metrics';
import type { LiveAnswer, LiveEngine, LiveReport, LiveRunRecord } from '../types';
import type { CliIo } from './cli';
import { rate, readText, writeJson } from './cli-util';
import { domainOf, urlKey } from './domain';
import { DEFAULT_GEMINI_MODEL, geminiGroundedEngine } from './gemini';

/** A required API key is not in the environment; the CLI prints the message and exits 2. */
export class MissingApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingApiKeyError';
  }
}

/**
 * `runLive` stopped on an engine error. `report` holds the calls that finished, marked
 * `incomplete`; `cause` is the engine's error.
 */
export class LiveRunIncompleteError extends Error {
  constructor(
    readonly report: LiveReport,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'LiveRunIncompleteError';
  }
}

/**
 * Asks each question `runs` times (seeds 1..runs) and records the engine's sources. The domain is
 * matched on each source's `domain`; the URL on its `uri`, so an engine whose URIs are unresolved
 * redirects can match the domain but not the URL. Questions run one at a time, in order. If the
 * engine throws, the calls that finished are not lost: a `LiveRunIncompleteError` carries them.
 */
export async function runLive(
  questions: string[],
  targetUrl: string,
  engine: LiveEngine,
  runs: number,
  now: () => Date = () => new Date(),
): Promise<LiveReport> {
  const targetKey = urlKey(targetUrl);
  if (targetKey === null) {
    throw new Error(
      'The target URL must be an absolute http(s) URL, for example https://example.com/page',
    );
  }
  const targetDomain = domainOf(targetUrl);
  // A host with no dot (localhost, an intranet name) has no domain: it would match every source
  // whose domain is unknown (''), so its results would be false citations (Ruling R33).
  if (targetDomain === '') {
    throw new Error(
      `The target URL's host has no domain (${new URL(targetUrl).hostname}); give the page's public address, for example https://example.com/page`,
    );
  }
  if (!Number.isInteger(runs) || runs < 1) throw new Error('Runs must be 1 or more');
  if (questions.length === 0) throw new Error('Give at least one question');
  const createdAt = now().toISOString();
  const records: LiveRunRecord[] = [];
  const build = (incomplete?: LiveReport['incomplete']): LiveReport => {
    const count = (pick: (r: LiveRunRecord) => boolean) =>
      wilson(records.filter(pick).length, records.length);
    return {
      schemaVersion: 1,
      engine: engine.name,
      model: engine.model ?? 'unspecified',
      targetUrl,
      createdAt,
      runs: records,
      summary: {
        domainCited: count((r) => r.draftDomainCited),
        urlCited: count((r) => r.draftUrlCited),
        nQuestions: incomplete ? new Set(records.map((r) => r.question)).size : questions.length,
      },
      ...(incomplete && { incomplete }),
      caveat: LIVE_CAVEAT,
    };
  };
  for (const question of questions) {
    for (let run = 1; run <= runs; run++) {
      let reply: LiveAnswer;
      try {
        reply = await engine.ask(question, run);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        throw new LiveRunIncompleteError(build({ planned: questions.length * runs, error }), err);
      }
      const { answer, sources } = reply;
      records.push({
        question,
        run,
        answer,
        sources,
        draftDomainCited: sources.some((s) => domainOf(s.domain) === targetDomain),
        draftUrlCited: sources.some((s) => urlKey(s.uri) === targetKey),
      });
    }
  }
  return build();
}

const ENGINES = ['gemini'] as const;

interface LiveOptions {
  engine: (typeof ENGINES)[number];
  questions: string;
  url: string;
  runs: number;
  model?: string;
  out: string;
}

/** Adds `ce live` to the program. The key comes from the environment only and is never printed. */
export function registerLive(program: Command, io: CliIo): void {
  program
    .command('live')
    .description(
      'Ask a live engine your questions and record whether its sources include your page (needs an API key).',
    )
    .addOption(
      new Option('--engine <name>', 'the live engine').choices(ENGINES).makeOptionMandatory(),
    )
    .requiredOption(
      '--questions <file>',
      'text file with one question per line (# starts a comment)',
    )
    .requiredOption('--url <page>', 'your published page')
    .option('--runs <n>', 'runs per question', runsInt, 8)
    .option('--model <name>', `engine model (default: ${DEFAULT_GEMINI_MODEL})`)
    .option('--out <dir>', 'where to write live-<engine>.json', 'results')
    .action(async (o: LiveOptions) => live(o, io));
}

async function live(o: LiveOptions, io: CliIo): Promise<void> {
  // Checked first, so a missing key fails before any file is read or request is sent.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new MissingApiKeyError(
      'GEMINI_API_KEY is not set. Create a key in Google AI Studio, then: export GEMINI_API_KEY=<your key>',
    );
  }
  // A repeated line is asked once, so per-question counts stay over `runs` runs.
  const questions = [
    ...new Set(
      (await readText(o.questions))
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#')),
    ),
  ];
  const engine = geminiGroundedEngine({ apiKey, model: o.model, fetchImpl: io.fetch });
  let report: LiveReport;
  try {
    report = await runLive(questions, o.url, engine, o.runs);
  } catch (err) {
    if (!(err instanceof LiveRunIncompleteError)) throw err;
    // The finished calls are saved under their own name, so a complete earlier run is not
    // overwritten, then the engine's error is rethrown for the usual message and exit code.
    const partial = err.report;
    if (partial.runs.length > 0) {
      const path = join(o.out, `live-${engine.name}.partial.json`);
      // A failed save is reported, but the engine's error stays the one the run stops with.
      try {
        await writeJson(path, partial);
        io.stderr(
          `Stopped after ${partial.runs.length} of ${partial.incomplete?.planned} calls. Wrote the finished calls to ${path} (marked incomplete).\n`,
        );
      } catch (writeErr) {
        io.stderr(
          `Stopped after ${partial.runs.length} of ${partial.incomplete?.planned} calls. Could not save them to ${path}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}\n`,
        );
      }
    }
    throw err.cause;
  }
  const path = join(o.out, `live-${engine.name}.json`);
  await writeJson(path, report);
  io.stdout(formatLive(report, path));
}

function formatLive(r: LiveReport, path: string): string {
  const runsPer = r.runs.length / r.summary.nQuestions;
  const lines = [
    LIVE_CAVEAT,
    '',
    `${r.engine} (${r.model}), ${r.summary.nQuestions} questions x ${runsPer} runs, target ${r.targetUrl}`,
    `  Domain cited  ${rate(r.summary.domainCited)}`,
    `  URL cited     ${rate(r.summary.urlCited)}`,
    '',
  ];
  const questions = [...new Set(r.runs.map((x) => x.question))];
  const width = Math.max(...questions.map((q) => q.length));
  for (const q of questions) {
    const runs = r.runs.filter((x) => x.question === q);
    const domain = runs.filter((x) => x.draftDomainCited).length;
    const url = runs.filter((x) => x.draftUrlCited).length;
    lines.push(
      `  ${q.padEnd(width)}  domain ${domain} of ${runs.length}, URL ${url} of ${runs.length}`,
    );
  }
  lines.push('', `Wrote ${path}`, '', LIVE_CAVEAT);
  return `${lines.join('\n')}\n`;
}

function runsInt(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1)
    throw new InvalidArgumentError('Must be 1 or more.');
  return Number(value);
}
