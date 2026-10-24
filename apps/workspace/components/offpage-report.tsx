'use client';

import {
  type CitedDomain,
  groupByKind,
  hostOf,
  OFFPAGE_ADVICE,
  OFFPAGE_NOTE,
  type OffPageAdvice,
  tallyCitedSources,
  urlsFromText,
} from '@citation-equity/engine';
import { Plus, Trash2 } from 'lucide-react';
import { useDeferredValue, useId, useMemo, useRef, useState } from 'react';
import { textLink } from '@/components/page-shell';
import { GRADE_CLASS } from '@/components/panel/evidence-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Entry {
  key: number;
  question: string;
  answer: string;
}

const field =
  'mt-1 w-full rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One question and the answer pasted for it. */
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
  onChange: (patch: Partial<Entry>) => void;
  onRemove: () => void;
}) {
  const questionId = useId();
  const answerId = useId();
  const n = index + 1;
  return (
    <fieldset className="rounded-lg border p-4">
      <legend className="px-1 font-medium text-sm">Question {n}</legend>
      <label htmlFor={questionId} className="sr-only">
        Question {n}
      </label>
      <input
        id={questionId}
        type="text"
        value={entry.question}
        placeholder="The question you asked, for example: Why does espresso taste bitter?"
        onChange={(e) => onChange({ question: e.target.value })}
        className={field}
      />
      <label htmlFor={answerId} className="mt-3 block text-sm">
        Answer {n}, with its sources
      </label>
      <textarea
        id={answerId}
        value={entry.answer}
        onChange={(e) => onChange({ answer: e.target.value })}
        spellCheck={false}
        rows={5}
        className={cn(field, 'font-mono text-xs')}
      />
      {canRemove && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          aria-label={`Remove question ${n}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
          Remove
        </Button>
      )}
    </fieldset>
  );
}

function KindTable({
  title,
  domains,
  total,
}: {
  title: string;
  domains: CitedDomain[];
  total: number;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="mb-1 text-left font-semibold">{title}</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-2 pr-4 font-medium">
              Site
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Answers citing it
            </th>
            <th scope="col" className="py-2 font-medium">
              For
            </th>
          </tr>
        </thead>
        <tbody>
          {domains.map((d) => (
            <tr key={d.domain} className="border-b align-top last:border-b-0">
              <th scope="row" className="py-2 pr-4 font-mono font-normal">
                {d.domain}
              </th>
              <td className="whitespace-nowrap py-2 pr-4">
                {d.citations} of {total}
              </td>
              <td className="py-2">
                <ul className="space-y-0.5">
                  {d.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdviceCard({ card }: { card: OffPageAdvice }) {
  const { evidence } = card;
  return (
    <section aria-label={`What to do: ${card.title}`} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold">{card.title}</h3>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-medium text-xs',
            GRADE_CLASS[evidence.grade],
          )}
        >
          Evidence: {evidence.grade}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">
        <span className="font-medium">What to do. </span>
        {card.advice}
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <span className="font-medium">What to avoid. </span>
        {card.avoid}
      </p>
      <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{evidence.summary}</p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
          Sources ({evidence.sources.length})
        </summary>
        <ul className="mt-2 space-y-2">
          {evidence.sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer" className={textLink}>
                {s.citation}
              </a>
              <p className="mt-0.5 text-muted-foreground text-xs">{s.claim}</p>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/**
 * Who gets cited for the author's questions, from answers pasted by hand: the URLs are pulled out
 * and tallied in this browser. Nothing is fetched or sent, and nothing is posted anywhere.
 */
export function OffPageReport() {
  const ownId = useId();
  const ownHintId = useId();
  const reportId = useId();
  const nextKey = useRef(1);
  const [entries, setEntries] = useState<Entry[]>([{ key: 0, question: '', answer: '' }]);
  const [own, setOwn] = useState('');
  const deferredEntries = useDeferredValue(entries);
  const deferredOwn = useDeferredValue(own);

  const report = useMemo(() => {
    const answers = deferredEntries
      .map((e, i) => ({ ...e, label: e.question.trim() || `Question ${i + 1}` }))
      .filter((e) => e.answer.trim() !== '')
      .map((e) => ({ question: e.label, urls: urlsFromText(e.answer) }));
    const ownDomain = hostOf(deferredOwn);
    const { domains, ownCitations } = tallyCitedSources(answers, ownDomain || undefined);
    return {
      answers: answers.length,
      questions: new Set(answers.map((a) => a.question)).size,
      ownDomain,
      ownCitations,
      groups: groupByKind(domains),
    };
  }, [deferredEntries, deferredOwn]);

  const update = (key: number, patch: Partial<Entry>) =>
    setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  return (
    <div className="mt-6">
      <div className="space-y-4">
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
        onClick={() =>
          setEntries((es) => [...es, { key: nextKey.current++, question: '', answer: '' }])
        }
      >
        <Plus aria-hidden="true" />
        Add a question
      </Button>

      <div className="mt-6">
        <label htmlFor={ownId} className="font-medium">
          Your site
        </label>
        <p id={ownHintId} className="mt-1 text-muted-foreground text-sm">
          Optional. Its www form and subdomains count as yours, and are reported apart from the
          others.
        </p>
        <input
          id={ownId}
          type="text"
          aria-describedby={ownHintId}
          value={own}
          placeholder="example.com"
          onChange={(e) => setOwn(e.target.value)}
          className={cn(field, 'max-w-sm')}
        />
      </div>

      <section aria-labelledby={reportId} className="mt-10">
        <h2 id={reportId} className="font-semibold text-xl">
          Who gets cited
        </h2>
        <p className="mt-3 rounded-md border-l-2 border-grade-mixed/60 pl-3 text-sm leading-relaxed">
          {OFFPAGE_NOTE}
        </p>
        {report.answers === 0 ? (
          <p className="mt-3 text-muted-foreground text-sm">
            Paste an answer above to see which sites it cites.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm">
              {plural(report.answers, 'answer')} to {plural(report.questions, 'question')}.{' '}
              {report.ownDomain === ''
                ? 'Enter your site to see whether it is cited.'
                : report.ownCitations > 0
                  ? `Your site (${report.ownDomain}) is cited in ${report.ownCitations} of ${plural(report.answers, 'answer')}.`
                  : `Your site (${report.ownDomain}) is not cited in any of them.`}
            </p>
            {report.groups.length === 0 && (
              <p className="mt-3 text-muted-foreground text-sm">
                No other site is cited. Paste the answer's source list too, if the engine showed
                one.
              </p>
            )}
            {report.groups.map((g) => (
              <KindTable
                key={g.kind}
                title={OFFPAGE_ADVICE[g.kind].title}
                domains={g.domains}
                total={report.answers}
              />
            ))}
          </>
        )}
      </section>

      {report.groups.length > 0 && (
        <div className="mt-10">
          <h2 className="font-semibold text-xl">What you can do</h2>
          <p className="mt-3 text-sm leading-relaxed">
            One card for each kind of site cited above, most cited first. Each says what to do,
            where the line is, and how well the studies support it.
          </p>
          <div className="mt-4 space-y-4">
            {report.groups.map((g) => (
              <AdviceCard key={g.kind} card={OFFPAGE_ADVICE[g.kind]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
