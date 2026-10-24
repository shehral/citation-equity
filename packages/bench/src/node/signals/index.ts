// `ce signals`: real-world signals read from files the site owner already has (server logs, a
// Bing Webmaster Tools export). Everything is parsed locally; nothing is sent anywhere.
import { type Command, Option } from 'commander';
import type { CliIo } from '../cli';
import { printable, readText } from '../cli-util';
import { type BingAiSignals, parseBingAiPerformanceCsv } from './bing';
import { AI_REFERRAL_SOURCES, type LogFormat, type LogSignals, parseAccessLog } from './logs';

export {
  AI_REFERRAL_SOURCES,
  type BingAiSignals,
  type LogSignals,
  parseAccessLog,
  parseBingAiPerformanceCsv,
};

export const SIGNALS_NOTE = 'Real signals from your own site; nothing is sent anywhere.';

/** Rows shown per table in text output; --json has them all. */
const TOP = 20;
/** Paths shown per crawler or referral source in text output. */
const TOP_PATHS = 3;

/** Adds `ce signals logs` and `ce signals bing` to the program. */
export function registerSignals(program: Command, io: CliIo): void {
  const signals = program
    .command('signals')
    .description('Read real AI signals from your own files: server logs, Bing AI Performance.');

  // With --json the note goes to stderr, so stdout stays one JSON document.
  const print = (json: boolean | undefined, value: unknown, text: () => string) => {
    if (json) {
      io.stderr(`${SIGNALS_NOTE}\n`);
      io.stdout(`${JSON.stringify(value, null, 2)}\n`);
    } else {
      io.stdout(`${SIGNALS_NOTE}\n\n${text()}`);
    }
  };

  signals
    .command('logs')
    .description(
      'Count AI crawler hits and AI assistant referrals in an access log (combined format or JSON lines).',
    )
    .argument('<file>', 'access log')
    .addOption(
      new Option(
        '--format <format>',
        'log format (default: JSON lines when most lines start with "{", else combined)',
      ).choices(['combined', 'jsonl'] as const),
    )
    .option('--json', 'print the signals as JSON')
    .action(async (file: string, o: { json?: boolean; format?: LogFormat }) => {
      const result = parseAccessLog(await readText(file), { format: o.format });
      print(o.json, result, () => formatLogs(result));
    });

  signals
    .command('bing')
    .description('Summarize a Bing Webmaster Tools AI Performance CSV export.')
    .argument('<file.csv>', 'the exported CSV')
    .option('--json', 'print the signals as JSON')
    .action(async (file: string, o: { json?: boolean }) => {
      const result = parseBingAiPerformanceCsv(await readText(file));
      print(o.json, result, () => formatBing(result));
    });
}

const topPaths = (paths: Record<string, number>) =>
  Object.entries(paths)
    .slice(0, TOP_PATHS)
    .map(([p, n]) => `${printable(p)} (${n})`)
    .join(', ');

function formatLogs(s: LogSignals): string {
  const lines = [`Access log: ${s.lines} lines, ${s.parsed} parsed`, ''];
  if (s.lines > 0 && s.parsed === 0) {
    lines.push(
      'No line could be read as a request. ce reads the combined format (Apache and nginx default) and JSON lines; pass --format combined or --format jsonl if it guessed wrong.',
      '',
    );
  }
  lines.push('AI crawler hits');
  if (s.crawlerHits.length === 0) {
    lines.push('  none');
  } else {
    const ua = Math.max(7, ...s.crawlerHits.map((c) => c.userAgent.length));
    const op = Math.max(8, ...s.crawlerHits.map((c) => c.operator.length));
    lines.push(
      `${'Crawler'.padEnd(ua)}  ${'Operator'.padEnd(op)}  ${'Purpose'.padEnd(13)}  Hits  Top paths`,
    );
    for (const c of s.crawlerHits) {
      lines.push(
        `${c.userAgent.padEnd(ua)}  ${c.operator.padEnd(op)}  ${c.purpose.padEnd(13)}  ${String(c.hits).padStart(4)}  ${topPaths(c.paths)}`,
      );
    }
  }
  lines.push('', 'AI assistant referrals');
  if (s.aiReferrals.length === 0) {
    lines.push('  none');
  } else {
    const src = Math.max(6, ...s.aiReferrals.map((r) => r.source.length));
    lines.push(`${'Source'.padEnd(src)}  Visits  Top paths`);
    for (const r of s.aiReferrals) {
      lines.push(`${r.source.padEnd(src)}  ${String(r.visits).padStart(6)}  ${topPaths(r.paths)}`);
    }
  }
  lines.push(
    '',
    "User agents can be faked; to confirm a crawler, check the request IP against the operator's published ranges.",
    'Referrals count visits whose Referer header is an AI assistant, or whose link carries its utm_source (such as utm_source=chatgpt.com); many clicks from AI apps send neither.',
  );
  return `${lines.join('\n')}\n`;
}

function formatBing(s: BingAiSignals): string {
  const range = s.dateRange ? `, ${s.dateRange[0]} to ${s.dateRange[1]}` : '';
  const lines = [
    `Bing AI Performance export: ${s.rows} rows, ${s.totalCitations} citations${range}`,
  ];
  const table = (title: string, column: string, rows: [string, number][]) => {
    if (rows.length === 0) return;
    const width = Math.max(9, ...rows.slice(0, TOP).map(([, n]) => String(n).length));
    lines.push('', `${title} (top ${Math.min(TOP, rows.length)} of ${rows.length})`);
    lines.push(`${'Citations'.padStart(width)}  ${column}`);
    for (const [key, n] of rows.slice(0, TOP)) {
      lines.push(`${String(n).padStart(width)}  ${printable(key)}`);
    }
  };
  table(
    'Cited pages',
    'Page',
    s.byPage.map((p) => [p.url, p.citations]),
  );
  table(
    'Grounding queries',
    'Query',
    s.byQuery.map((q) => [q.query, q.citations]),
  );
  lines.push(
    '',
    "Microsoft describes this data as a sample of citation activity in Copilot, Bing's AI summaries and some partner integrations; it has no clicks or traffic.",
  );
  return `${lines.join('\n')}\n`;
}
