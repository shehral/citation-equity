'use client';

import {
  type BenchSettings,
  CAVEAT,
  type Comparison,
  chanceLevel,
  competitorProfile,
  DEFAULT_OLLAMA_HOST,
  type DocProfile,
  OllamaAdapter,
  type Pack,
  probeOllama,
  profileDocument,
  type Rate,
} from '@citation-equity/bench';
import { Laptop, Play, RefreshCw, X } from 'lucide-react';
import { type ChangeEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  type BenchFailure,
  classifyBenchError,
  draftTitle,
  hasModel,
  type LocalBenchResult,
  localSettings,
  parsePackFile,
  type ReportView,
  runLocalBench,
  type SampleBench,
  sampleBench,
} from '@/lib/bench';
import type { Sample } from '@/lib/samples';
import { cn } from '@/lib/utils';
import { Command, ModelMissingNote, OllamaInstructions, UnreachableNote } from './ollama-help';

interface BenchPanelProps {
  /** The loaded sample; null (or a sample without a pack) is a custom draft. */
  sample: Sample | null;
  /** The editor's current text, which a local run tests against a baseline draft. */
  markdown: string;
  /** The draft's title when it has no H1 (the sample title, or "My draft"). */
  fallbackTitle?: string;
  /**
   * Told the result of each "Check for a local model": the model when it is
   * ready, else null. Other panels reuse it instead of probing on their own.
   */
  onLocalModel?(model: string | null): void;
}

/**
 * The citation test bench: the sample's recorded before/after run, and, only
 * after the author clicks "Check for a local model", a run of the current text
 * on a local Ollama. Every state shows the caveat, after the numbers it qualifies.
 */
export function BenchPanel({
  sample,
  markdown,
  fallbackTitle = 'My draft',
  onLocalModel,
}: BenchPanelProps) {
  const bench = useMemo(() => sampleBench(sample), [sample]);
  const baseline = useMemo(
    () =>
      sample
        ? {
            label: 'Sample before',
            title: draftTitle(sample.before, sample.title),
            markdown: sample.before,
          }
        : null,
    [sample],
  );
  return (
    <section aria-labelledby="bench-heading" className="space-y-4 rounded-lg border bg-card p-4">
      <h2 id="bench-heading" className="font-medium">
        Citation test bench
      </h2>
      {bench && sample && baseline ? (
        <>
          <RecordedRun sample={sample} bench={bench} />
          <LocalRunner
            pack={bench.pack}
            settings={localSettings(bench)}
            baseline={baseline}
            baselineNote="the sample's before draft"
            markdown={markdown}
            fallbackTitle={sample.title}
            onLocalModel={onLocalModel}
          />
        </>
      ) : (
        <CustomDraftBench
          markdown={markdown}
          fallbackTitle={fallbackTitle}
          onLocalModel={onLocalModel}
        />
      )}
    </section>
  );
}

function Caveat() {
  return <p className="border-l-2 border-warning-foreground/40 pl-3 text-sm">{CAVEAT}</p>;
}

// ---------- recorded results ----------

function RecordedRun({ sample, bench }: { sample: Sample; bench: SampleBench }) {
  const { before, after, comparison, pack } = bench;
  const drafts = useMemo(
    () => [
      ['Before', sample.before] as const,
      ...(sample.after === undefined ? [] : [['After', sample.after] as const]),
    ],
    [sample],
  );
  return (
    <section aria-labelledby="bench-recorded-heading" className="space-y-3">
      <h3 id="bench-recorded-heading" className="font-medium text-sm">
        Recorded run: before vs after
      </h3>
      <PackNote pack={pack} />
      {before && after && comparison ? (
        <>
          <ResultsTable
            before={before}
            after={after}
            comparison={comparison}
            labels={['Before', 'After']}
          />
          <ProfileTable report={before} pack={pack} drafts={drafts} />
        </>
      ) : (
        <p className="text-muted-foreground text-sm">No recorded run for this sample yet.</p>
      )}
      <Caveat />
    </section>
  );
}

function PackNote({ pack }: { pack: Pack }) {
  const docs = pack.queries.reduce((n, q) => n + q.documents.length, 0);
  return (
    <p className="text-muted-foreground text-xs">
      Pack: {pack.title}, {pack.queries.length} questions, {docs} competitor pages
      {pack.synthetic ? ', all synthetic (written for this project, not real sites)' : ''}.
    </p>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const points = (x: number) => {
  const v = Math.round(x * 100) || 0; // no "-0"
  return `${v >= 0 ? '+' : ''}${v} points`;
};
const signed3 = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
const pValue = (p: number) => `p = ${p.toFixed(2)}`;

function RateCell({ rate }: { rate: Rate }) {
  return (
    <td className="px-2 py-1.5 align-top tabular-nums">
      <span className="font-medium">{pct(rate.p)}</span>{' '}
      <span className="block text-muted-foreground text-xs">
        {rate.k} of {rate.n}; 95% CI {pct(rate.lo)} to {pct(rate.hi)}
      </span>
    </td>
  );
}

function ValidCell({ report }: { report: ReportView }) {
  const failures = report.summary.formatFailures.k;
  return (
    <td className="px-2 py-1.5 align-top tabular-nums">
      <span className="font-medium">
        {report.summary.validRuns} of {report.runs.length}
      </span>{' '}
      <span className="block text-muted-foreground text-xs">
        {failures} format failure{failures === 1 ? '' : 's'}
      </span>
    </td>
  );
}

function ShareCell({ report }: { report: ReportView }) {
  const { mean, interval } = report.summary.pawcAmongValid;
  return (
    <td className="px-2 py-1.5 align-top tabular-nums">
      <span className="font-medium">{mean.toFixed(3)}</span>{' '}
      <span className="block text-muted-foreground text-xs">
        {interval[0].toFixed(3)} to {interval[1].toFixed(3)}
      </span>{' '}
      <span className="block text-muted-foreground text-xs">
        {chanceLevel(report.summary.chanceShare)}
      </span>
    </td>
  );
}

const th = 'px-2 py-1.5 text-left font-medium';

/**
 * Two drafts, in this order: valid answers and format failures, cited among valid answers, the
 * draft's share among valid answers next to the chance level, then retrieved; with intervals,
 * deltas and p-values.
 */
function ResultsTable({
  before,
  after,
  comparison,
  labels,
}: {
  before: ReportView;
  after: ReportView;
  comparison: Comparison;
  labels: [string, string];
}) {
  const s = before.settings;
  const n = comparison.nQueries;
  // With no question valid on both sides there is no paired test, so no p-value to show.
  const paired = n > 0;
  const pCell = (p: number) => (paired ? pValue(p) : 'no paired test possible');
  const excluded = comparison.excludedQueries;
  const questions = new Set(before.runs.map((r) => r.queryId)).size;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {labels[0]} vs {labels[1]}: how often the model retrieved and cited the draft
          </caption>
          <thead className="border-b text-muted-foreground text-xs">
            <tr>
              <th scope="col" className={th}>
                Measure
              </th>
              <th scope="col" className={th}>
                {labels[0]}
              </th>
              <th scope="col" className={th}>
                {labels[1]}
              </th>
              <th scope="col" className={th}>
                Change
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <th scope="row" className={th}>
                Valid answers
              </th>
              <ValidCell report={before} />
              <ValidCell report={after} />
              <td className="px-2 py-1.5 align-top tabular-nums">
                {points(comparison.delta.formatFailures)}{' '}
                <span className="block text-muted-foreground text-xs">in format failures</span>
              </td>
            </tr>
            <tr>
              <th scope="row" className={th}>
                Cited among valid answers
              </th>
              <RateCell rate={before.summary.citedAmongValid} />
              <RateCell rate={after.summary.citedAmongValid} />
              <td className="px-2 py-1.5 align-top tabular-nums">
                {points(comparison.delta.citedAmongValid)}{' '}
                <span className="block text-muted-foreground text-xs">
                  {pCell(comparison.pValue.citedAmongValid)}
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" className={th}>
                Draft share among valid answers
              </th>
              <ShareCell report={before} />
              <ShareCell report={after} />
              <td className="px-2 py-1.5 align-top tabular-nums">
                {signed3(comparison.delta.pawcAmongValid)}{' '}
                <span className="block text-muted-foreground text-xs">
                  {pCell(comparison.pValue.pawcAmongValid)}
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" className={th}>
                Retrieved
              </th>
              <RateCell rate={before.summary.retrieved} />
              <RateCell rate={after.summary.retrieved} />
              <td className="px-2 py-1.5 align-top tabular-nums">
                {points(comparison.delta.retrieved)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">
        Model {s.model}, {questions} questions, {s.runs} runs each, top {s.k} pages retrieved,
        temperature {s.temperature}. Run on {before.createdAt.slice(0, 10)} (UTC).{' '}
        {paired ? (
          <>
            p is a two-sided sign-flip test over the {n} question{n === 1 ? '' : 's'} with a valid
            answer on both sides
            {n <= 12
              ? `; with ${n} question${n === 1 ? '' : 's'} it cannot go below ${formatNumber(2 / 2 ** n, 3)}`
              : ''}
          </>
        ) : (
          'No question has a valid answer on both sides, so no paired test was possible'
        )}
        {excluded.length > 0 ? `; left out: ${excluded.join(', ')}` : ''}.
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer rounded-sm text-muted-foreground text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
          What these measure
        </summary>
        <dl className="mt-2 space-y-1 text-xs">
          <dt className="font-medium">Valid answers</dt>
          <dd className="text-muted-foreground">
            Answers with at least one [n] citation that points to a source. An answer with none is a
            format failure: the model did not follow the citation format, which says nothing about
            the draft, so it is left out of the next two rows.
          </dd>
          <dt className="font-medium">Cited among valid answers</dt>
          <dd className="text-muted-foreground">The valid answer cited the draft at least once.</dd>
          <dt className="font-medium">Draft share among valid answers</dt>
          <dd className="text-muted-foreground">
            Position-adjusted word count: the share of the answer's words attributed to the draft,
            with earlier sentences counting more (the measure of the GEO paper, Aggarwal et al.
            2024). Averaged per question. The chance level is the share the draft would get, when it
            is among the sources, if the answer split its credit evenly over them; a small model
            that cites nearly every source lands close to it whatever the draft says. Runs where the
            draft was not retrieved count as 0 in the draft's share, so when Retrieved is below 100%
            the share is pulled down by those runs.
          </dd>
          <dt className="font-medium">Retrieved</dt>
          <dd className="text-muted-foreground">
            The draft was among the top {s.k} pages the search step handed to the model.
          </dd>
        </dl>
      </details>
    </div>
  );
}

const PROFILE_ROWS: [keyof Omit<DocProfile, 'docId'>, string][] = [
  ['words', 'Words'],
  ['headings', 'Headings'],
  ['lists', 'Lists'],
  ['tables', 'Tables'],
  ['statistics', 'Statistics'],
  ['links', 'Links'],
];

function formatNumber(x: number, digits = 1): string {
  return Number.isInteger(x) ? String(x) : String(Number(x.toFixed(digits)));
}

/** Medians of the competitor pages the model cited in `report`, next to each draft's counts. */
function ProfileTable({
  report,
  pack,
  drafts,
}: {
  report: ReportView;
  pack: Pack;
  /** Pass a memoized array: the profiles are recomputed only when it changes. */
  drafts: readonly (readonly [label: string, markdown: string])[];
}) {
  // The panel re-renders on every keystroke; these parse up to dozens of pages, so memoize.
  const { cited, medians } = useMemo(() => competitorProfile(report, pack), [report, pack]);
  const profiles = useMemo(
    () => drafts.map(([label, md]) => [label, profileDocument(label, md)] as const),
    [drafts],
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="pb-1 text-left text-muted-foreground text-xs">
          Pages the model cited in the {report.draftId} runs (median of {cited.length}), next to the
          drafts
        </caption>
        <thead className="border-b text-muted-foreground text-xs">
          <tr>
            <th scope="col" className={th}>
              Count
            </th>
            <th scope="col" className={th}>
              Cited pages
            </th>
            {profiles.map(([label]) => (
              <th key={label} scope="col" className={th}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {PROFILE_ROWS.map(([key, label]) => (
            <tr key={key}>
              <th scope="row" className={th}>
                {label}
              </th>
              <td className="px-2 py-1 tabular-nums">{formatNumber(medians[key])}</td>
              {profiles.map(([draftLabel, p]) => (
                <td key={draftLabel} className="px-2 py-1 tabular-nums">
                  {p[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- local run ----------

type LocalState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'unreachable' }
  | { kind: 'model-missing' }
  | { kind: 'ready' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'cancelled' }
  | { kind: 'failed'; failure: BenchFailure }
  /** `markdown` is the text that was run, which the editor may have moved past since. */
  | { kind: 'done'; result: LocalBenchResult; markdown: string };

interface Baseline {
  /** The column label, e.g. "Sample before". */
  label: string;
  title: string;
  markdown: string;
}

function LocalRunner({
  pack,
  settings,
  baseline,
  baselineNote,
  markdown,
  fallbackTitle,
  onLocalModel,
}: {
  /** Null until the author loads a pack (custom drafts): the check still runs, a run does not. */
  pack: Pack | null;
  settings: BenchSettings;
  baseline: Baseline | null;
  /** What the baseline is, in a sentence: "the sample's before draft". */
  baselineNote: string;
  markdown: string;
  fallbackTitle: string;
  onLocalModel?(model: string | null): void;
}) {
  const [state, setState] = useState<LocalState>({ kind: 'idle' });
  /** Bumped by every action, so a late answer from an earlier one is dropped. */
  const op = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const model = settings.model;
  const generations = pack ? 2 * pack.queries.length * settings.runs : 0;

  useEffect(
    () => () => {
      op.current++;
      controller.current?.abort();
    },
    [],
  );

  // A new pack (or baseline) makes a run in flight, or its result, meaningless: stop and drop it.
  const runFor = useRef({ pack, baseline });
  useEffect(() => {
    if (runFor.current.pack === pack && runFor.current.baseline === baseline) return;
    runFor.current = { pack, baseline };
    op.current++;
    controller.current?.abort();
    setState((prev) =>
      prev.kind === 'running' || prev.kind === 'done' || prev.kind === 'cancelled'
        ? { kind: 'ready' }
        : prev,
    );
  }, [pack, baseline]);

  async function check() {
    const id = ++op.current;
    setState({ kind: 'checking' });
    let found: { reachable: boolean; models: string[] };
    try {
      found = await probeOllama();
    } catch {
      found = { reachable: false, models: [] };
    }
    if (id !== op.current) return;
    const ready = found.reachable && hasModel(found.models, model);
    onLocalModel?.(ready ? model : null);
    if (!found.reachable) setState({ kind: 'unreachable' });
    else if (!ready) setState({ kind: 'model-missing' });
    else setState({ kind: 'ready' });
  }

  async function run() {
    if (!pack || !baseline) return;
    const id = ++op.current;
    const ctrl = new AbortController();
    controller.current = ctrl;
    const text = markdown;
    setState({ kind: 'running', done: 0, total: generations });
    try {
      const result = await runLocalBench({
        pack,
        before: { id: 'before', title: baseline.title, markdown: baseline.markdown },
        current: { id: 'current', title: draftTitle(text, fallbackTitle), markdown: text },
        adapter: new OllamaAdapter(),
        settings,
        signal: ctrl.signal,
        onProgress: (done, total) => {
          if (id === op.current) setState({ kind: 'running', done, total });
        },
      });
      if (id === op.current) setState({ kind: 'done', result, markdown: text });
    } catch (err) {
      if (id === op.current) setState({ kind: 'failed', failure: classifyBenchError(err) });
    }
  }

  function cancel() {
    op.current++;
    controller.current?.abort();
    setState({ kind: 'cancelled' });
  }

  const doneDrafts = useMemo(
    () =>
      state.kind === 'done' && baseline
        ? [[baseline.label, baseline.markdown] as const, ['Your text', state.markdown] as const]
        : [],
    [state, baseline],
  );

  const checkButton = (label: string) => (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={check}
      disabled={state.kind === 'checking'}
    >
      {label === 'Check again' ? <RefreshCw aria-hidden="true" /> : <Laptop aria-hidden="true" />}
      {label}
    </Button>
  );
  const runButton = (
    <Button type="button" size="sm" onClick={run}>
      <Play aria-hidden="true" />
      Run on my machine
    </Button>
  );

  return (
    <section aria-labelledby="bench-local-heading" className="space-y-3 border-t pt-4">
      <h3 id="bench-local-heading" className="font-medium text-sm">
        Run it on your computer
      </h3>
      {(state.kind === 'idle' || state.kind === 'checking') && (
        <>
          <p className="text-muted-foreground text-sm">
            {pack
              ? 'With Ollama on this computer, you can run the bench on your current text.'
              : 'With Ollama on this computer, you can suggest target questions with a local model now, and run the bench once you load a pack.'}{' '}
            Checking sends one request to Ollama at {DEFAULT_OLLAMA_HOST} and nowhere else; your
            draft never leaves this computer.
          </p>
          {checkButton(state.kind === 'checking' ? 'Checking' : 'Check for a local model')}
        </>
      )}

      {state.kind === 'unreachable' && (
        <div role="status" className="space-y-3">
          <UnreachableNote />
          <OllamaInstructions model={model} />
          {checkButton('Check again')}
        </div>
      )}

      {state.kind === 'model-missing' && (
        <div role="status" className="space-y-3">
          <ModelMissingNote model={model} />
          {checkButton('Check again')}
        </div>
      )}

      {(state.kind === 'ready' || state.kind === 'cancelled' || state.kind === 'done') && (
        <div className="space-y-3">
          {state.kind === 'cancelled' && (
            <p role="status" className="text-sm">
              Run cancelled. Nothing was kept.
            </p>
          )}
          {pack && baseline ? (
            <>
              <p className="text-muted-foreground text-sm">
                Ollama is running with {model}. A run tests {baselineNote} and your current text on{' '}
                {pack.queries.length} questions, {settings.runs} times each: {generations}{' '}
                generations, which can take several minutes on a laptop.
              </p>
              {runButton}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Ollama is running with {model}. The target questions panel can now suggest questions
              with it. Load a pack above to run the bench on your text.
            </p>
          )}
        </div>
      )}

      {state.kind === 'running' && (
        <Progress done={state.done} total={state.total} onCancel={cancel} />
      )}

      {state.kind === 'failed' && (
        <div role="status" className="space-y-3">
          <FailureNote failure={state.failure} model={model} />
          {checkButton('Check again')}
        </div>
      )}

      {state.kind === 'done' && pack && baseline && (
        <section aria-label="Your run on this machine" className="space-y-3 rounded-md border p-3">
          <h4 className="font-medium text-sm">
            Your run on this machine: {baseline.label.toLowerCase()} vs your text
          </h4>
          <ResultsTable
            before={state.result.before}
            after={state.result.current}
            comparison={state.result.comparison}
            labels={[baseline.label, 'Your text']}
          />
          <ProfileTable report={state.result.before} pack={pack} drafts={doneDrafts} />
          <Caveat />
        </section>
      )}
    </section>
  );
}

function Progress({ done, total, onCancel }: { done: number; total: number; onCancel(): void }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="space-y-2">
      <div
        role="progressbar"
        aria-label="Bench progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" className="text-muted-foreground text-sm tabular-nums">
          {done} of {total} generations
        </p>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          <X aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FailureNote({ failure, model }: { failure: BenchFailure; model: string }) {
  if (failure.kind === 'model-missing') return <ModelMissingNote model={model} />;
  if (failure.kind === 'unavailable') {
    return (
      <div className="space-y-3 text-sm">
        <p>
          Ollama stopped answering during the run. It may have quit, or it blocks requests from this
          site (CORS). Start it this way and try again:
        </p>
        <OllamaInstructions model={model} />
      </div>
    );
  }
  return <p className="text-sm">The run stopped with an error: {failure.message}</p>;
}

// ---------- custom draft ----------

/**
 * The bench for the author's own draft: how to build a pack, a file input that loads one (read
 * in the browser, checked with validatePack), and then a local run of the current text against
 * the text as it stood when the pack was loaded.
 */
function CustomDraftBench({
  markdown,
  fallbackTitle,
  onLocalModel,
}: {
  markdown: string;
  fallbackTitle: string;
  onLocalModel?(model: string | null): void;
}) {
  const id = useId();
  const [loaded, setLoaded] = useState<{ name: string; pack: Pack; baseline: Baseline } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function read(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const pack = parsePackFile(await file.text());
      setLoaded({
        name: file.name,
        pack,
        baseline: {
          label: 'Text at pack load',
          title: draftTitle(markdown, fallbackTitle),
          markdown,
        },
      });
      setError(null);
    } catch (err) {
      setLoaded(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Lets the same file be chosen again after an edit.
      input.value = '';
    }
  }

  return (
    <>
      <CustomDraftNote />
      <div className="space-y-2">
        <label htmlFor={`${id}-pack`} className="font-medium text-sm">
          Load a pack (JSON)
        </label>
        <p id={`${id}-pack-help`} className="text-muted-foreground text-xs">
          A pack file written by `ce pack`. It is read in this browser and is not uploaded. A local
          run then compares your text as it is when you load the pack with your text at the time of
          the run.
        </p>
        <input
          id={`${id}-pack`}
          type="file"
          accept=".json,application/json"
          aria-describedby={`${id}-pack-help`}
          onChange={read}
          className={cn(
            'block w-full rounded-md text-sm outline-none',
            'focus-visible:ring-[3px] focus-visible:ring-ring',
            'file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-sm',
          )}
        />
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {loaded && (
          <div role="status" className="space-y-1">
            <p className="text-sm">Loaded {loaded.name}.</p>
            <PackNote pack={loaded.pack} />
          </div>
        )}
      </div>
      <LocalRunner
        pack={loaded?.pack ?? null}
        settings={localSettings(null)}
        baseline={loaded?.baseline ?? null}
        baselineNote="your text as it was when you loaded the pack"
        markdown={markdown}
        fallbackTitle={fallbackTitle}
        onLocalModel={onLocalModel}
      />
      <Caveat />
    </>
  );
}

function CustomDraftNote() {
  return (
    <div className="space-y-2 text-sm">
      <p>
        A bench run needs a pack: a fixed set of reader questions and the competitor pages your
        draft is tested against. The sample drafts ship with one. For your own draft, build a pack
        from pages you choose in a copy of the repository, then load it below, or run the whole
        bench from the command line:
      </p>
      <Command>
        {[
          'pnpm install && pnpm --filter "@citation-equity/bench..." build',
          'alias ce="node packages/bench/bin/ce.js"',
          'ce analyze draft.md',
          'ce pack from-urls --question "Your reader\'s question" --urls urls.txt --id my-pack --out my-pack.json',
          'ce bench --draft draft.md --after revised.md --pack my-pack.json --out results/',
        ].join('\n')}
      </Command>
      <p className="text-muted-foreground text-xs">
        from-urls fetches only the URLs you list, and respects each site's robots.txt. The bench
        needs Ollama running on your computer.
      </p>
    </div>
  );
}
