import {
  AdapterUnavailableError,
  type BenchDraft,
  type BenchReport,
  type BenchSettings,
  type Comparison,
  compareReports,
  DEFAULT_SETTINGS,
  type EngineAdapter,
  ModelMissingError,
  type Pack,
  type RunRecord,
  runBench,
  validatePack,
} from '@citation-equity/bench';
import type { Sample } from './samples';

/**
 * A report as the bundled samples carry it: gen-samples.mjs strips each run's answer text
 * (Ruling R21, R28), so `runs[].answer` is absent. A local run's full `BenchReport` fits too.
 */
export type ReportView = Omit<BenchReport, 'runs'> & { runs: Omit<RunRecord, 'answer'>[] };

/** The sample's pack and its recorded results (samples/<slug>/results), as far as they exist. */
export interface SampleBench {
  pack: Pack;
  before?: ReportView;
  after?: ReportView;
  comparison?: Comparison;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isRate = (x: unknown) =>
  isObj(x) && isNum(x.k) && isNum(x.n) && isNum(x.p) && isNum(x.lo) && isNum(x.hi);
const isShare = (x: unknown) =>
  isObj(x) &&
  isNum(x.mean) &&
  Array.isArray(x.interval) &&
  x.interval.length === 2 &&
  x.interval.every(isNum);
const hasNums = (x: unknown, keys: string[]) => isObj(x) && keys.every((k) => isNum(x[k]));

/**
 * A schemaVersion 2 report on `packId`, with every field the bench panel reads. Anything else
 * (an older or hand-edited file) is left out, so the panel never throws while rendering it.
 */
function asReport(x: unknown, packId: string): ReportView | undefined {
  if (!isObj(x) || x.schemaVersion !== 2 || x.packId !== packId) return undefined;
  const { summary: sm, settings, runs } = x;
  const ok =
    typeof x.draftId === 'string' &&
    typeof x.createdAt === 'string' &&
    Array.isArray(runs) &&
    runs.every((r) => isObj(r) && typeof r.queryId === 'string' && Array.isArray(r.citedDocIds)) &&
    isObj(settings) &&
    typeof settings.model === 'string' &&
    hasNums(settings, ['runs', 'k', 'temperature']) &&
    isObj(sm) &&
    isNum(sm.validRuns) &&
    isNum(sm.chanceShare) &&
    isRate(sm.retrieved) &&
    isRate(sm.formatFailures) &&
    isRate(sm.citedAmongValid) &&
    isShare(sm.pawcAmongValid);
  return ok ? (x as unknown as ReportView) : undefined;
}

function asComparison(x: unknown, packId: string): Comparison | undefined {
  if (!isObj(x) || x.schemaVersion !== 2 || x.packId !== packId) return undefined;
  const ok =
    hasNums(x.delta, ['retrieved', 'citedAmongValid', 'pawcAmongValid', 'formatFailures']) &&
    hasNums(x.pValue, ['citedAmongValid', 'pawcAmongValid']) &&
    isNum(x.nQueries) &&
    Array.isArray(x.excludedQueries) &&
    x.excludedQueries.every((q) => typeof q === 'string');
  return ok ? (x as unknown as Comparison) : undefined;
}

/**
 * Reads what gen-samples.mjs put on the sample. Null when there is no valid
 * pack, which the bench panel treats like a custom draft. Results for another
 * pack, or of another shape, are left out rather than shown wrong.
 */
export function sampleBench(sample: Sample | null): SampleBench | null {
  if (!sample?.pack) return null;
  let pack: Pack;
  try {
    pack = validatePack(sample.pack);
  } catch {
    return null;
  }
  const results = sample.results ?? {};
  return {
    pack,
    before: asReport(results.before, pack.packId),
    after: asReport(results.after, pack.packId),
    comparison: asComparison(results.comparison, pack.packId),
  };
}

/** Ollama lists `name:tag`; a model asked for without a tag means `:latest`. */
export function hasModel(models: string[], model: string): boolean {
  return models.some((m) => m === model || m === `${model}:latest`);
}

/** The first H1 of a draft, or a fallback, as the bench's draft title. */
export function draftTitle(markdown: string, fallback: string): string {
  return /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown)?.[1] ?? fallback;
}

export type BenchFailure =
  | { kind: 'unavailable' }
  | { kind: 'model-missing' }
  | { kind: 'other'; message: string };

/** What went wrong, for the panel's message: no server (or CORS), no model, or anything else. */
export function classifyBenchError(err: unknown): BenchFailure {
  if (err instanceof AdapterUnavailableError) return { kind: 'unavailable' };
  if (err instanceof ModelMissingError) return { kind: 'model-missing' };
  return { kind: 'other', message: err instanceof Error ? err.message : String(err) };
}

function abortError(): DOMException {
  return new DOMException('The bench run was cancelled.', 'AbortError');
}

/**
 * Settles with `p`, or rejects as soon as `signal` aborts. An abandoned `p`
 * may still reject later; that rejection is caught here, so it never surfaces
 * as unhandled.
 */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      p.catch(() => {});
      reject(abortError());
      return;
    }
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/** An adapter that stops generating once `signal` aborts (runBench itself takes no signal). */
function abortable(inner: EngineAdapter, signal: AbortSignal): EngineAdapter {
  return {
    name: inner.name,
    // The report's caveat and numCtx follow the adapter actually used (Ruling R32).
    caveat: inner.caveat,
    sendsNumCtx: inner.sendsNumCtx,
    generate: (prompt, opts) =>
      signal.aborted
        ? Promise.reject(abortError())
        : untilAborted(inner.generate(prompt, opts), signal),
  };
}

export interface LocalBenchResult {
  before: BenchReport;
  current: BenchReport;
  comparison: Comparison;
}

/**
 * Runs the sample's before draft and the editor's current text through the
 * pack with the same settings (so their seeds pair up), then compares them.
 * Progress counts the generations of both runs. Rejects with an AbortError
 * when `signal` aborts.
 */
export async function runLocalBench(opts: {
  pack: Pack;
  before: BenchDraft;
  current: BenchDraft;
  adapter: EngineAdapter;
  settings: BenchSettings;
  signal: AbortSignal;
  onProgress(done: number, total: number): void;
}): Promise<LocalBenchResult> {
  const { pack, settings, signal, onProgress } = opts;
  const adapter = abortable(opts.adapter, signal);
  const perDraft = pack.queries.length * settings.runs;
  const total = 2 * perDraft;
  const before = await untilAborted(
    runBench(pack, opts.before, adapter, settings, (done) => onProgress(done, total)),
    signal,
  );
  const current = await untilAborted(
    runBench(pack, opts.current, adapter, settings, (done) => onProgress(perDraft + done, total)),
    signal,
  );
  return { before, current, comparison: compareReports(before, current) };
}

/** Settings for a local run: the recorded run's, so the numbers compare, else the defaults. */
export function localSettings(bench: SampleBench | null): BenchSettings {
  const s = bench?.before?.settings;
  return s ? { ...s, numCtx: s.numCtx ?? DEFAULT_SETTINGS.numCtx } : DEFAULT_SETTINGS;
}

/**
 * Reads a pack file the author chose (File API, nothing uploaded): JSON checked with the bench's
 * validatePack. Throws a readable Error when the file is not a valid pack.
 */
export function parsePackFile(text: string): Pack {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file is not JSON. A pack is the JSON file `ce pack` writes.');
  }
  return validatePack(json);
}
