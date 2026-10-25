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
import { REPO_URL } from '@/lib/links';
import type { Sample } from '@/lib/samples';
import { cn } from '@/lib/utils';
import { ModelMissingNote, OllamaInstructions, UnreachableNote } from './ollama-help';

interface TestItProps {
  /** The loaded sample; null (or a sample without a pack) is a custom draft. */
  sample: Sample | null;
  /** The editor's current text, which a local run tests against a baseline draft. */
  markdown: string;
  /** The draft's title when it has no H1 (the sample title, or "My draft"). */
  fallbackTitle?: string;
  /**
   * Told the result of each "Connect local AI": the model when it is ready, else null. Reader
   * questions and Suggest wording reuse it instead of probing on their own.
   */
  onLocalModel?(model: string | null): void;
}

/** The one chance caveat next to the test numbers. */
export const CHANCE_NOTE = 'Small local AI and sample pages, so this could be chance.';

/** The one line on the Connect button's privacy. */
export const CONNECT_NOTE = 'Sends your text only to the AI on this computer.';

/**
 * Test it: for an example, its recorded before/after run in two plain numbers (details folded
 * away); for the author's own post, a test pack to load. A local run, and the connection that
 * Reader questions and Suggest wording use, happen only after the author clicks Connect local AI.
 */
export function TestIt({
  sample,
  markdown,
  fallbackTitle = 'My draft',
  onLocalModel,
}: TestItProps) {
  const bench = useMemo(() => sampleBench(sample), [sample]);
  const baseline = useMemo(
    () =>
      sample
        ? {
            label: 'Example before',
            title: draftTitle(sample.before, sample.title),
            markdown: sample.before,
          }
        : null,
    [sample],
  );
  return (
    <div className="space-y-4">
      {bench && sample && baseline ? (
        <>
          <RecordedRun bench={bench} sample={sample} />
          <LocalRunner
            pack={bench.pack}
            settings={localSettings(bench)}
            baseline={baseline}
            markdown={markdown}
            fallbackTitle={sample.title}
            onLocalModel={onLocalModel}
          />
        </>
      ) : (
        <OwnPostTest
          markdown={markdown}
          fallbackTitle={fallbackTitle}
          onLocalModel={onLocalModel}
        />
      )}
    </div>
  );
}

/** The bench caveat, word for word, under the detailed numbers it qualifies. */
function Caveat() {
  return <p className="border-l-2 border-border-strong pl-3 text-xs">{CAVEAT}</p>;
}

/** Two headline numbers in plain words: how often the answer cited the draft, and found it. */
function Headline({ before, after }: { before: ReportView; after: ReportView }) {
  const stats = [
    ['Cited', before.summary.citedAmongValid.p, after.summary.citedAmongValid.p],
    ['Found', before.summary.retrieved.p, after.summary.retrieved.p],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-2">
      {stats.map(([label, b, a]) => (
        <div key={label} className="rounded-lg bg-sunken px-3 py-2">
          <p className="sr-only">{`${label}: ${pct(b)} before, ${pct(a)} after`}</p>
          <p aria-hidden="true" className="text-ink-soft text-xs">
            {label}
          </p>
          <p aria-hidden="true" className="font-serif text-xl tabular-nums lining-nums">
            {pct(b)} → {pct(a)}
          </p>
        </div>
      ))}
    </div>
  );
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
    <section aria-label="Sample result" className="space-y-3">
      {before && after && comparison ? (
        <>
          <p className="text-ink-soft">Sample result, before and after the edits:</p>
          <Headline before={before} after={after} />
          <p className="text-ink-soft text-xs">{CHANCE_NOTE}</p>
          <details className="space-y-3">
            <summary className="cursor-pointer rounded-sm text-ink-soft text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
              Details
            </summary>
            <div className="mt-2 space-y-3">
              <PackNote pack={pack} />
              <ResultsTable
                before={before}
                after={after}
                comparison={comparison}
                labels={['Before', 'After']}
              />
              <ProfileTable report={before} pack={pack} drafts={drafts} />
              <Caveat />
            </div>
          </details>
        </>
      ) : (
        <p className="text-ink-soft">No recorded run for this sample yet.</p>
      )}
    </section>
  );
}

function PackNote({ pack }: { pack: Pack }) {
  const docs = pack.queries.reduce((n, q) => n + q.documents.length, 0);
  return (
    <p className="text-ink-soft text-xs">
      {pack.queries.length} questions, {docs} {pack.synthetic ? 'made-up ' : ''}competitor pages.
    </p>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const points = (x: number) => {
  const v = Math.round(x * 100) || 0; // no "-0"
  return `${v >= 0 ? '+' : ''}${v} points`;
};
const signed3 = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;

function RateCell({ rate }: { rate: Rate }) {
  return (
    <td className="px-2 py-1.5 align-top tabular-nums">
      <span className="font-medium">{pct(rate.p)}</span>{' '}
      <span className="block text-ink-soft text-xs">
        {rate.k} of {rate.n}
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
      <span className="block text-ink-soft text-xs">
        {failures} format failure{failures === 1 ? '' : 's'}
      </span>
    </td>
  );
}

function ShareCell({ report }: { report: ReportView }) {
  const { mean } = report.summary.pawcAmongValid;
  return (
    <td className="px-2 py-1.5 align-top tabular-nums">
      <span className="font-medium">{mean.toFixed(3)}</span>{' '}
      <span className="block text-ink-soft text-xs">{chanceLevel(report.summary.chanceShare)}</span>
    </td>
  );
}

const th = 'px-2 py-1.5 text-left font-medium';

/**
 * Two drafts, in this order: valid answers and format failures, cited among valid answers, the
 * draft's share among valid answers next to the chance level, then retrieved, with the change.
 * Plain counts only: the intervals and p-values stay in the CLI's report.
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
  const excluded = comparison.excludedQueries;
  const questions = new Set(before.runs.map((r) => r.queryId)).size;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {labels[0]} vs {labels[1]}: how often the model retrieved and cited the draft
          </caption>
          <thead className="border-b text-ink-soft text-xs">
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
                <span className="block text-ink-soft text-xs">in format failures</span>
              </td>
            </tr>
            <tr>
              <th scope="row" className={th}>
                Cited among valid answers
              </th>
              <RateCell rate={before.summary.citedAmongValid} />
              <RateCell rate={after.summary.citedAmongValid} />
              <td className="px-2 py-1.5 align-top tabular-nums">
                {points(comparison.delta.citedAmongValid)}
              </td>
            </tr>
            <tr>
              <th scope="row" className={th}>
                Draft share among valid answers
              </th>
              <ShareCell report={before} />
              <ShareCell report={after} />
              <td className="px-2 py-1.5 align-top tabular-nums">
                {signed3(comparison.delta.pawcAmongValid)}
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
      <p className="text-ink-soft text-xs">
        Model {s.model}, {questions} questions, {s.runs} runs each, top {s.k} pages retrieved,
        temperature {s.temperature}. Run on {before.createdAt.slice(0, 10)} (UTC).
        {excluded.length > 0 ? ` Left out: ${excluded.join(', ')}.` : ''}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer rounded-sm text-ink-soft text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
          What these measure
        </summary>
        <dl className="mt-2 space-y-1 text-xs">
          <dt className="font-medium">Valid answers</dt>
          <dd className="text-ink-soft">
            Answers with at least one [n] citation that points to a source. An answer with none is a
            format failure: the model did not follow the citation format, which says nothing about
            the draft, so it is left out of the next two rows.
          </dd>
          <dt className="font-medium">Cited among valid answers</dt>
          <dd className="text-ink-soft">The valid answer cited the draft at least once.</dd>
          <dt className="font-medium">Draft share among valid answers</dt>
          <dd className="text-ink-soft">
            The share of the answer's words attributed to the draft, with earlier sentences counting
            more. Averaged per question. The chance level is the share the draft would get, when it
            is among the sources, if the answer split its credit evenly over them; a small model
            that cites nearly every source lands close to it whatever the draft says. Runs where the
            draft was not retrieved count as 0 in the draft's share, so when Retrieved is below 100%
            the share is pulled down by those runs.
          </dd>
          <dt className="font-medium">Retrieved</dt>
          <dd className="text-ink-soft">
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
        <caption className="pb-1 text-left text-ink-soft text-xs">
          Pages the model cited in the {report.draftId} runs (median of {cited.length}), next to the
          drafts
        </caption>
        <thead className="border-b text-ink-soft text-xs">
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
  markdown,
  fallbackTitle,
  onLocalModel,
}: {
  /** Null until the author loads a pack (own post): Connect still works, a run does not. */
  pack: Pack | null;
  settings: BenchSettings;
  baseline: Baseline | null;
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

  const connectButton = (again: boolean) => (
    <Button
      type="button"
      size="sm"
      variant={again ? 'outline' : 'default'}
      onClick={check}
      disabled={state.kind === 'checking'}
      title={`Connects to ${DEFAULT_OLLAMA_HOST} only`}
    >
      {again ? <RefreshCw aria-hidden="true" /> : <Laptop aria-hidden="true" />}
      {state.kind === 'checking' ? 'Connecting...' : again ? 'Try again' : 'Connect local AI'}
    </Button>
  );

  return (
    <section aria-label="Local AI" className="space-y-3 border-t pt-3">
      {(state.kind === 'idle' || state.kind === 'checking') && (
        <>
          {connectButton(false)}
          <p className="text-ink-soft text-xs">{CONNECT_NOTE}</p>
        </>
      )}

      {state.kind === 'unreachable' && (
        <div role="status" className="space-y-3">
          <UnreachableNote />
          <OllamaInstructions model={model} />
          {connectButton(true)}
        </div>
      )}

      {state.kind === 'model-missing' && (
        <div role="status" className="space-y-3">
          <ModelMissingNote model={model} />
          {connectButton(true)}
        </div>
      )}

      {(state.kind === 'ready' || state.kind === 'cancelled' || state.kind === 'done') && (
        <div className="space-y-3">
          {state.kind === 'cancelled' && <p role="status">Run cancelled. Nothing was kept.</p>}
          {pack && baseline ? (
            <>
              <p className="text-ink-soft">
                Connected to {model}. A test asks it {generations} times and can take a few minutes.
              </p>
              <Button type="button" size="sm" onClick={run}>
                <Play aria-hidden="true" />
                Run test
              </Button>
            </>
          ) : (
            <p className="text-ink-soft">Connected to {model}. Load a test pack to run the test.</p>
          )}
        </div>
      )}

      {state.kind === 'running' && (
        <Progress done={state.done} total={state.total} onCancel={cancel} />
      )}

      {state.kind === 'failed' && (
        <div role="status" className="space-y-3">
          <FailureNote failure={state.failure} model={model} />
          {connectButton(true)}
        </div>
      )}

      {state.kind === 'done' && pack && baseline && (
        <section aria-label="Your run on this machine" className="space-y-3 rounded-md border p-3">
          <h4 className="font-medium">Your run: {baseline.label.toLowerCase()} vs your text</h4>
          <Headline before={state.result.before} after={state.result.current} />
          <p className="text-ink-soft text-xs">{CHANCE_NOTE}</p>
          <details>
            <summary className="cursor-pointer rounded-sm text-ink-soft text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
              Details
            </summary>
            <div className="mt-2 space-y-3">
              <ResultsTable
                before={state.result.before}
                after={state.result.current}
                comparison={state.result.comparison}
                labels={[baseline.label, 'Your text']}
              />
              <ProfileTable report={state.result.before} pack={pack} drafts={doneDrafts} />
              <Caveat />
            </div>
          </details>
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
        aria-label="Test progress"
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
        <p aria-live="polite" className="text-ink-soft text-sm tabular-nums">
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

// ---------- own post ----------

/** How to build a test pack: a docs link to that section, never a command-line block in the app. */
const PACK_DOCS_URL = `${REPO_URL}/blob/main/docs/cli.md#make-a-test-pack`;

/**
 * Test it for the author's own post: a test pack loaded from a file (read in the browser,
 * checked with validatePack), then a local run of the current text against the text as it stood
 * when the pack was loaded.
 */
function OwnPostTest({
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
      <div className="space-y-2">
        <label htmlFor={`${id}-pack`} className="font-medium">
          Load a test pack
        </label>
        <p className="text-ink-soft text-xs">
          Questions and pages to test your post against.{' '}
          <a
            href={PACK_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            How to make one
          </a>
        </p>
        <input
          id={`${id}-pack`}
          type="file"
          accept=".json,application/json"
          onChange={read}
          className={cn(
            'block w-full rounded-md text-sm outline-none',
            'focus-visible:ring-[3px] focus-visible:ring-ring',
            'file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-sm',
          )}
        />
        {error !== null && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {loaded && (
          <div role="status" className="space-y-1">
            <p>Loaded {loaded.name}.</p>
            <PackNote pack={loaded.pack} />
          </div>
        )}
      </div>
      <LocalRunner
        pack={loaded?.pack ?? null}
        settings={localSettings(null)}
        baseline={loaded?.baseline ?? null}
        markdown={markdown}
        fallbackTitle={fallbackTitle}
        onLocalModel={onLocalModel}
      />
    </>
  );
}
