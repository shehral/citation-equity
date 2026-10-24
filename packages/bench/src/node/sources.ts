// `ce sources`: which sites AI answers cite for the author's own questions, grouped by kind, with
// an advice card per kind. Reads a `ce live` report or answers the author pasted into a text file;
// it makes no request, posts nothing and contacts no one.
import { basename } from 'node:path';
import {
  groupByKind,
  OFFPAGE_ADVICE,
  OFFPAGE_NOTE,
  tallyCitedSources,
  urlsFromText,
} from '@citation-equity/engine';
import { type Command, Option } from 'commander';
import { LIVE_CAVEAT } from '../caveat';
import type { LiveReport } from '../types';
import type { CliIo } from './cli';
import { readText } from './cli-util';
import { domainOf } from './domain';

/**
 * Splits pasted answers into one block per question. A line `Q: <question>` starts a block and
 * everything up to the next such line is that answer and its sources. The marker is a capital
 * `Q:` at the start of the line, with or without a blank line before it. One exception keeps an
 * FAQ quoted inside an answer together: a `Q:` line whose next non-blank line starts with `A:`
 * is part of the answer, unless the file itself is written as Q:/A: pairs (its first question
 * is followed by an `A:` line), where every `Q:` line starts an answer. Blank lines and `#`
 * comments before the first question are skipped; any other text there is an error.
 */
export function parsePastedAnswers(text: string): { question: string; text: string }[] {
  const blocks: { question: string; lines: string[] }[] = [];
  const format = 'Start each answer with a line "Q: <the question you asked>".';
  const lines = text.split(/\r?\n/);
  const nextIsAnswerMarker = (i: number): boolean => {
    const next = lines.slice(i + 1).find((l) => l.trim() !== '');
    return next !== undefined && /^A:/.test(next);
  };
  let pairs = false;
  for (const [i, line] of lines.entries()) {
    const q = /^Q:(.*)$/.exec(line);
    const starts = q !== null && (blocks.length === 0 || pairs || !nextIsAnswerMarker(i));
    if (q && starts) {
      const question = q[1].trim();
      if (question === '') throw new Error(`Line ${i + 1} has an empty question. ${format}`);
      if (blocks.length === 0) pairs = nextIsAnswerMarker(i);
      blocks.push({ question, lines: [] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].lines.push(line);
    } else if (line.trim() !== '' && !line.trim().startsWith('#')) {
      throw new Error(`Line ${i + 1} comes before any question. ${format}`);
    }
  }
  if (blocks.length === 0) throw new Error(`No question found. ${format}`);
  return blocks.map((b) => ({ question: b.question, text: b.lines.join('\n') }));
}

/** The parts of a LiveReport `ce sources` reads, checked before use. */
function asLiveReport(value: unknown, path: string): LiveReport {
  const r = value as Partial<LiveReport> | null;
  const ok =
    r !== null &&
    typeof r === 'object' &&
    r.schemaVersion === 1 &&
    Array.isArray(r.runs) &&
    r.runs.every(
      (run) =>
        typeof run?.question === 'string' &&
        Array.isArray(run.sources) &&
        run.sources.every((s) => typeof s?.uri === 'string' && typeof s.domain === 'string'),
    );
  if (!ok) throw new Error(`${path} is not a ce live report (live-<engine>.json)`);
  return r as LiveReport;
}

interface SourcesOptions {
  live?: string;
  pasted?: string;
  own?: string;
}

export function registerSources(program: Command, io: CliIo): void {
  program
    .command('sources')
    .description(
      'Show which sites AI answers cite for your questions, grouped by kind, with what you can do about each (reads local files only).',
    )
    .addOption(
      new Option('--live <report.json>', 'a report written by ce live').conflicts('pasted'),
    )
    .addOption(
      new Option(
        '--pasted <answers.txt>',
        'answers you copied from ChatGPT, Perplexity, Gemini or Copilot, each starting with a line "Q: <question>"',
      ),
    )
    .option(
      '--own <domain>',
      "your site, counted apart (default with --live: the report's target URL)",
    )
    .action(async (o: SourcesOptions) => sources(o, io));
}

async function sources(o: SourcesOptions, io: CliIo): Promise<void> {
  let answers: { question: string; urls: string[] }[];
  let from: string;
  let own = o.own;
  let caveat = OFFPAGE_NOTE;
  const notes: string[] = [];
  if (o.live) {
    const text = await readText(o.live);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = null;
    }
    const report = asLiveReport(value, o.live);
    // A source's domain, not its URI: Gemini's URIs can be unresolved redirects through Google,
    // and a source whose domain is unknown ('') names no site, so it is left out and counted.
    answers = report.runs.map((r) => ({
      question: r.question,
      urls: r.sources.map((s) => s.domain).filter((d) => d !== ''),
    }));
    const unknown = report.runs.reduce(
      (k, r) => k + r.sources.filter((s) => s.domain === '').length,
      0,
    );
    from = `from ce live (${report.engine}, ${report.model})`;
    own ??= report.targetUrl;
    caveat = LIVE_CAVEAT;
    notes.push(OFFPAGE_NOTE);
    if (unknown > 0) {
      notes.push(
        `${unknown} source${unknown === 1 ? '' : 's'} with no known site ${unknown === 1 ? 'was' : 'were'} left out.`,
      );
    }
    if (report.incomplete) {
      notes.push(
        `This report is incomplete: ${report.runs.length} of ${report.incomplete.planned} planned calls finished.`,
      );
    }
  } else if (o.pasted) {
    answers = parsePastedAnswers(await readText(o.pasted)).map((b) => ({
      question: b.question,
      urls: urlsFromText(b.text),
    }));
    from = `pasted from ${basename(o.pasted)}`;
  } else {
    throw new Error('Give --live <report.json> (from ce live) or --pasted <answers.txt>.');
  }
  const ownDomain = own === undefined ? '' : domainOf(own);
  const { domains, ownCitations } = tallyCitedSources(answers, ownDomain || undefined);
  const n = answers.length;
  const nQuestions = new Set(answers.map((a) => a.question)).size;
  const of = (k: number) => `${k} of ${n} answer${n === 1 ? '' : 's'}`;

  const lines: string[] = [caveat, ...notes, ''];
  lines.push(
    `Sources cited in ${n} answer${n === 1 ? '' : 's'} to ${nQuestions} question${nQuestions === 1 ? '' : 's'} ${from}`,
  );
  if (ownDomain === '') {
    lines.push('Your site: not checked. Pass --own example.com to count your own domain apart.');
  } else if (ownCitations > 0) {
    lines.push(`Your site (${ownDomain}): cited in ${of(ownCitations)}.`);
  } else {
    lines.push(`Your site (${ownDomain}): not cited in any of ${n} answer${n === 1 ? '' : 's'}.`);
  }
  lines.push('');

  const groups = groupByKind(domains);
  if (groups.length === 0) lines.push('No other site was cited.', '');
  const width = Math.max(0, ...domains.map((d) => d.domain.length));
  for (const g of groups) {
    lines.push(`${OFFPAGE_ADVICE[g.kind].title} (${g.kind})`);
    for (const d of g.domains) {
      lines.push(`  ${d.domain.padEnd(width)}  ${of(d.citations)}`);
      for (const q of d.questions) lines.push(`      ${q}`);
    }
    lines.push('');
  }

  if (groups.length > 0) {
    lines.push(
      'What you can do, by kind of site (grades and sources: docs/evidence.md, section Off-page)',
      '',
    );
    for (const g of groups) {
      const card = OFFPAGE_ADVICE[g.kind];
      lines.push(`${card.title} (evidence: ${card.evidence.grade})`);
      lines.push(`  Do: ${card.advice}`);
      lines.push(`  Avoid: ${card.avoid}`);
      lines.push(`  Evidence: ${card.evidence.summary}`);
      lines.push('');
    }
  }
  lines.push(caveat);
  io.stdout(`${lines.join('\n')}\n`);
}
