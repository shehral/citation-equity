'use client';

import { type CitedDomain, OFFPAGE_ADVICE, type SourceKind } from '@citation-equity/engine';
import {
  BookOpen,
  Globe,
  Landmark,
  type LucideIcon,
  MessagesSquare,
  Newspaper,
  PenLine,
  Plus,
  ShoppingBag,
  Star,
  Trash2,
  Users,
  Video,
} from 'lucide-react';
import { useDeferredValue, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { type CitedEntry, citedReport, citedSummary } from '@/components/cited/tally';
import { GradeLabel } from '@/components/grade-label';
import { textLink } from '@/components/page-shell';
import { Button } from '@/components/ui/button';
import { EXAMPLE_CITED_INPUT, isExampleCited } from '@/lib/examples';
import { REPO_URL } from '@/lib/links';
import {
  type CitedInput,
  type CitedInputEntry,
  getPastedCited,
  setPastedCited,
} from '@/lib/pasted';
import { type CitedSummary, getSummary, setSummary, subscribe } from '@/lib/store';
import { cn } from '@/lib/utils';

type Entry = CitedInputEntry;

const EMPTY: CitedInput = { entries: [{ key: 0, question: '', answer: '' }], own: '' };

const KIND_ICON: Record<SourceKind, LucideIcon> = {
  forum: MessagesSquare,
  wiki: BookOpen,
  video: Video,
  reviews: Star,
  news: Newspaper,
  reference: Landmark,
  social: Users,
  commerce: ShoppingBag,
  'blog-or-other': Globe,
};

const field =
  'mt-1 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus-visible:ring-[3px] focus-visible:ring-ring';

const STEPS = [
  'Ask ChatGPT, Perplexity, Gemini or Copilot your question.',
  'Copy the answer with its links.',
  'Paste it here, one box per question.',
];

/** "cited in 1 of 1 answers": the count is the headline stat. */
const citedIn = (k: number, n: number) => `Your site: cited in ${k} of ${n} answers.`;

/** True when two summaries say the same thing (the timestamp aside). */
const sameSummary = (a: CitedSummary | null, b: CitedSummary) =>
  a !== null &&
  a.answers === b.answers &&
  a.citingYou === b.citingYou &&
  a.example === b.example &&
  a.site === b.site &&
  a.topKinds.join() === b.topKinds.join();

function EntryFields({
  entry,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  entry: Entry;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<CitedEntry>) => void;
  onRemove: () => void;
}) {
  const questionId = useId();
  const answerId = useId();
  const n = index + 1;
  return (
    <fieldset className="relative rounded-lg border bg-surface p-4 shadow-card">
      <legend className="float-left font-medium text-sm">Question {n}</legend>
      {canRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2"
          aria-label={`Remove question ${n}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      )}
      <label htmlFor={questionId} className="sr-only">
        Question {n}
      </label>
      <input
        id={questionId}
        type="text"
        value={entry.question}
        placeholder="e.g. Why does espresso taste bitter?"
        onChange={(e) => onChange({ question: e.target.value })}
        className={cn(field, 'clear-left mt-2')}
      />
      <label htmlFor={answerId} className="mt-3 block font-medium text-sm">
        The answer, with its links<span className="sr-only"> (question {n})</span>
      </label>
      <textarea
        id={answerId}
        value={entry.answer}
        onChange={(e) => onChange({ answer: e.target.value })}
        rows={5}
        className={cn(field, 'min-h-32 resize-y leading-relaxed')}
      />
    </fieldset>
  );
}

/** The share of answers as a quiet bar; the "k of n" text next to it carries the number. */
function Bar({ k, n, own }: { k: number; n: number; own?: boolean }) {
  return (
    <span aria-hidden="true" className="hidden h-1.5 w-20 rounded-full bg-sunken sm:block">
      <span
        className={cn('block h-full rounded-full', own ? 'bg-brand' : 'bg-ink-faint')}
        style={{ width: `${n === 0 ? 0 : Math.round((k / n) * 100)}%` }}
      />
    </span>
  );
}

function SitesTable({
  rows,
  total,
  own,
}: {
  rows: Pick<CitedDomain, 'domain' | 'citations' | 'questions'>[];
  total: number;
  own?: boolean;
}) {
  return (
    <table className="mt-3 w-full text-left text-sm">
      <thead className="sr-only">
        <tr>
          <th scope="col">Site, and the questions it was cited for</th>
          <th scope="col">Cited in</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.domain} className="border-t align-top first:border-t-0">
            <th scope="row" className="py-2 pr-3 text-left font-normal">
              <span className="block break-words font-mono text-[13px]">{d.domain}</span>
              {d.questions.length > 0 && (
                <ul className="mt-0.5 space-y-0.5 text-muted-foreground text-xs">
                  {d.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              )}
            </th>
            <td className="w-px whitespace-nowrap py-2 text-right">
              <span className="flex items-center justify-end gap-2">
                <Bar k={d.citations} n={total} own={own} />
                <span className="tabular-nums">
                  {d.citations} of {total}
                </span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KindGroup({
  kind,
  domains,
  total,
}: {
  kind: SourceKind;
  domains: CitedDomain[];
  total: number;
}) {
  const card = OFFPAGE_ADVICE[kind];
  const Icon = KIND_ICON[kind];
  return (
    <section aria-label={card.title} className="rounded-lg border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="mr-auto flex items-center gap-2 font-semibold">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {card.title}
        </h3>
        <GradeLabel grade={card.evidence.grade} />
      </div>
      <SitesTable rows={domains} total={total} />
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t pt-3 text-sm">
        <dt className="font-semibold">Do</dt>
        <dd>{card.short.do}</dd>
        <dt className="font-semibold">Avoid</dt>
        <dd>{card.short.avoid}</dd>
      </dl>
      <details className="mt-3 text-sm">
        <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring">
          What the studies say
        </summary>
        <p className="mt-2 text-muted-foreground leading-relaxed">{card.evidence.summary}</p>
        <ul className="mt-2 space-y-1.5">
          {card.evidence.sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer" className={textLink}>
                {s.citation}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function ExampleChip() {
  return (
    <span className="rounded-full bg-sunken px-2 py-0.5 font-sans text-muted-foreground text-xs">
      Example
    </span>
  );
}

function YouChip() {
  return (
    <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand text-xs">
      You
    </span>
  );
}

/**
 * Who gets cited for the author's questions: three steps, the pasted answers, then the user's own
 * site first and the other sites grouped by kind, each kind with one Do and one Avoid line. The
 * answers stay in page memory (lib/pasted), so switching views keeps them, and are tallied in the
 * browser; only a CitedSummary is stored, for the home tile. While nothing is pasted, a stored
 * summary from the example shows the example's answers; any other stored summary shows as is.
 */
export function CitedView() {
  const ownId = useId();
  const ownHintId = useId();
  const resultsId = useId();
  const [pasted, setPasted] = useState<CitedInput | null>(getPastedCited);
  const stored = useSyncExternalStore(
    subscribe,
    () => getSummary('cited'),
    () => null,
  );
  const input = pasted ?? (stored?.example ? EXAMPLE_CITED_INPUT : EMPTY);
  const { entries, own } = input;
  const deferred = useDeferredValue(input);
  const { report, example } = useMemo(
    () => ({
      report: citedReport(deferred.entries, deferred.own),
      example: isExampleCited(deferred),
    }),
    [deferred],
  );

  useEffect(() => {
    if (report.answers === 0) return;
    const next = { ...citedSummary(report, new Date().toISOString()), example };
    if (!sameSummary(getSummary('cited'), next)) setSummary('cited', next);
  }, [report, example]);

  function change(next: Partial<CitedInput>) {
    const value = { ...input, ...next };
    setPastedCited(value);
    setPasted(value);
  }
  const setEntries = (f: (es: Entry[]) => Entry[]) => change({ entries: f(entries) });
  const update = (key: number, patch: Partial<CitedEntry>) =>
    setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  const nextKey = () => Math.max(-1, ...entries.map((e) => e.key)) + 1;

  return (
    <>
      <p className="mt-3 text-lg text-muted-foreground leading-relaxed">
        AI answers also cite forums, Wikipedia, videos and reviews. See who gets cited for your
        questions, and how to show up there honestly.
      </p>

      <ol aria-label="How it works" className="mt-6 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-start gap-3 text-sm">
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft font-semibold font-serif text-brand"
            >
              {i + 1}
            </span>
            <span className="pt-1">{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 space-y-3">
        {entries.map((entry, i) => (
          <EntryFields
            key={entry.key}
            entry={entry}
            index={i}
            canRemove={entries.length > 1}
            onChange={(patch) => update(entry.key, patch)}
            onRemove={() => setEntries((es) => es.filter((e) => e.key !== entry.key))}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => setEntries((es) => [...es, { key: nextKey(), question: '', answer: '' }])}
      >
        <Plus aria-hidden="true" />
        Add a question
      </Button>

      <div className="mt-6">
        <label htmlFor={ownId} className="font-medium text-sm">
          Your site
        </label>
        <p id={ownHintId} className="text-muted-foreground text-sm">
          Optional. We'll highlight it.
        </p>
        <input
          id={ownId}
          type="text"
          aria-describedby={ownHintId}
          value={own}
          placeholder="example.com"
          onChange={(e) => change({ own: e.target.value })}
          className={cn(field, 'max-w-sm')}
        />
      </div>

      <section aria-labelledby={resultsId} className="mt-12">
        <h2 id={resultsId} className="font-medium font-serif text-2xl">
          Who gets cited
        </h2>
        {report.answers === 0 ? (
          stored ? (
            <div className="mt-3 rounded-lg border bg-surface p-4 shadow-card">
              <p className="flex flex-wrap items-center gap-2 font-serif text-xl">
                {stored.site === undefined
                  ? 'Add your site above to see if it is cited.'
                  : citedIn(stored.citingYou, stored.answers)}
                {stored.example && <ExampleChip />}
              </p>
              <p className="mt-1 text-muted-foreground text-sm">Paste again to see details.</p>
            </div>
          ) : (
            <p className="mt-3 text-muted-foreground text-sm">
              Paste an answer above to see which sites it cites.
            </p>
          )
        ) : (
          <div className="mt-3 space-y-4">
            <div>
              <p className="flex flex-wrap items-center gap-2 font-serif text-xl">
                {report.ownDomain === ''
                  ? 'Add your site above to see if it is cited.'
                  : citedIn(report.ownCitations, report.answers)}
                {example && <ExampleChip />}
              </p>
              {report.answers < 3 && (
                <p className="mt-1 text-muted-foreground text-sm">
                  Paste a few more answers. They change every time.
                </p>
              )}
            </div>
            {report.ownDomain !== '' && (
              <section
                aria-label="Your site"
                className="rounded-lg border border-brand/40 bg-surface p-4 shadow-card"
              >
                <h3 className="flex items-center gap-2 font-semibold">
                  <PenLine className="size-4 text-brand" aria-hidden="true" />
                  Your site
                  <YouChip />
                </h3>
                <SitesTable
                  own
                  rows={[
                    { domain: report.ownDomain, citations: report.ownCitations, questions: [] },
                  ]}
                  total={report.answers}
                />
              </section>
            )}
            {report.groups.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No other site is cited. Paste the source list too, if the answer had one.
              </p>
            ) : (
              report.groups.map((g) => (
                <KindGroup key={g.kind} kind={g.kind} domains={g.domains} total={report.answers} />
              ))
            )}
          </div>
        )}
      </section>

      <p className="mt-10 text-muted-foreground text-sm">
        <a
          href={`${REPO_URL}/blob/main/docs/evidence.md#off-page`}
          target="_blank"
          rel="noreferrer"
          className={textLink}
        >
          How we grade these
        </a>
      </p>
    </>
  );
}
