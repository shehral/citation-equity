// Batch bridge for cluster runs (experiments/README.md): `ce bench --export-prompts` writes every
// prompt the bench would send, a batch job (experiments/explorer/batch_generate.py) answers them,
// and `ce bench --answers` replays those answers through the normal bench, keyed by recordingKey.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { recordingKey } from '../adapters/recorded';
import { runBench } from '../run';
import type { BenchDraft, EngineAdapter, GenerateOptions, Pack, ReportSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

/** One generation the bench would ask for, as written by `--export-prompts` (one JSON per line). */
export interface PromptLine {
  /** recordingKey(prompt, { model, seed, temperature, numCtx }): the answer must come back under it. */
  key: string;
  model: string;
  seed: number;
  temperature: number;
  numCtx: number;
  prompt: string;
  packId: string;
  draftId: string;
  queryId: string;
  run: number;
}

/** One answer from a batch job (one JSON per line). */
export interface AnswerLine {
  key: string;
  answer: string;
  /** The model that wrote it; informational. */
  model?: string;
}

/**
 * Every prompt `runBench` sends for `draft`, in order, without calling a model. It runs runBench
 * itself with an adapter that only records its calls, so export and bench cannot drift apart.
 * Prompts never depend on earlier answers, so the placeholder answer changes nothing.
 */
export async function collectPrompts(
  pack: Pack,
  draft: BenchDraft,
  settings?: Partial<ReportSettings>,
): Promise<PromptLine[]> {
  const calls: { prompt: string; opts: GenerateOptions }[] = [];
  const capture: EngineAdapter = {
    name: 'capture',
    async generate(prompt, opts) {
      calls.push({ prompt, opts });
      return '';
    },
  };
  const report = await runBench(pack, draft, capture, settings);
  // runBench records one run per generate call, in call order; anything else would pair a prompt
  // with another run's query and seed.
  if (calls.length !== report.runs.length) {
    throw new Error(
      `collectPrompts: ${calls.length} generate calls for ${report.runs.length} runs; the export would be misaligned`,
    );
  }
  return report.runs.map((r, i) => {
    const { prompt, opts } = calls[i];
    return {
      key: recordingKey(prompt, opts),
      model: opts.model,
      seed: opts.seed,
      temperature: opts.temperature,
      numCtx: opts.numCtx ?? report.settings.numCtx ?? DEFAULT_SETTINGS.numCtx,
      prompt,
      packId: pack.packId,
      draftId: draft.id,
      queryId: r.queryId,
      run: r.run,
    };
  });
}

/** Writes prompt lines as JSONL, creating the directory first. */
export async function writePrompts(path: string, lines: PromptLine[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
}

/**
 * Answers by recording key, from AnswerLine JSONL (blank lines skipped; a later line with the same
 * key wins) or from the `recording.json` map that `ce bench --record` writes.
 */
export function readAnswers(text: string): Record<string, string> {
  const whole = parseJson(text);
  if (isObject(whole) && !isAnswerLine(whole)) {
    for (const [key, value] of Object.entries(whole)) {
      if (typeof value !== 'string') {
        throw new Error(
          `Answers file is a JSON object, but key "${key}" does not map to a string answer`,
        );
      }
    }
    return Object.fromEntries(Object.entries(whole)) as Record<string, string>;
  }
  const answers = new Map<string, string>();
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (err) {
      throw new Error(`Answers line ${i + 1} is not valid JSON (${(err as Error).message})`);
    }
    if (!isAnswerLine(value)) {
      throw new Error(
        `Answers line ${i + 1} is not an answer: expected {"key": string, "answer": string}`,
      );
    }
    answers.set(value.key, value.answer);
  }
  // fromEntries defines own properties, so a key such as "__proto__" stays an ordinary key.
  return Object.fromEntries(answers);
}

/** How many of `lines` have no answer in `answers`. */
export function countMissing(lines: PromptLine[], answers: Record<string, string>): number {
  return lines.filter((l) => !Object.hasOwn(answers, l.key)).length;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAnswerLine(value: unknown): value is AnswerLine {
  return isObject(value) && typeof value.key === 'string' && typeof value.answer === 'string';
}
