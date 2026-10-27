'use client';

import { fanOutSearches } from '@citation-equity/engine';
import { Sparkles } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ModelMissingNote,
  OllamaInstructions,
  UnreachableNote,
} from '@/components/draft/ollama-help';
import { Button } from '@/components/ui/button';
import { classifyBenchError } from '@/lib/bench';
import { suggestSearches } from '@/lib/search-helper';
import { cn } from '@/lib/utils';

/** The one plain line under the list. Guidance only: no score, no check, no promise. */
export const SEARCHES_NOTE =
  'Answer engines often search for these before answering. Cover the ones your readers care about.';

const summaryClass = cn(
  'cursor-pointer rounded-sm text-ink-soft text-xs outline-none hover:text-foreground',
  'focus-visible:ring-[3px] focus-visible:ring-ring',
);

const sameSearch = (a: string, b: string) =>
  a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim();

function localError(err: unknown, model: string): ReactNode {
  const failure = classifyBenchError(err);
  if (failure.kind === 'unavailable') {
    return (
      <>
        <UnreachableNote />
        <OllamaInstructions model={model} />
      </>
    );
  }
  if (failure.kind === 'model-missing') return <ModelMissingNote model={model} />;
  return <p>The local model could not suggest searches: {failure.message}</p>;
}

/**
 * "Searches behind this question": collapsed, the (up to 8) searches an answer engine is likely
 * to run before answering `question` (engine templates from its own words), and with a
 * connected local model, "Suggest more searches", which sends only the question.
 */
export function SearchesBehind({
  question,
  localModel,
  className,
}: {
  question: string;
  /** The connected local model, or null: then the list has no model button. */
  localModel: string | null;
  className?: string;
}) {
  const searches = useMemo(() => fanOutSearches(question), [question]);
  const [more, setMore] = useState<{ question: string; items: string[] }>({
    question,
    items: [],
  });
  const [message, setMessage] = useState<ReactNode>(null);
  const [asking, setAsking] = useState(false);
  /** Bumped on unmount and on each ask, so a late answer for an earlier question is dropped. */
  const op = useRef(0);
  useEffect(
    () => () => {
      op.current++;
    },
    [],
  );
  const extra = more.question === question ? more.items : [];
  if (searches.length === 0 && extra.length === 0) return null;

  async function ask(model: string) {
    const id = ++op.current;
    const asked = question;
    setAsking(true);
    setMessage(null);
    try {
      const found = await suggestSearches(asked, model);
      if (id !== op.current) return;
      const known = [...searches, ...extra];
      const fresh = found.filter((s) => !known.some((k) => sameSearch(k, s)));
      setMore({ question: asked, items: [...extra, ...fresh] });
      setMessage(
        fresh.length === 0
          ? `No new searches from ${model}.`
          : `Added ${fresh.length} search${fresh.length === 1 ? '' : 'es'} from ${model}.`,
      );
    } catch (err) {
      if (id === op.current) setMessage(localError(err, model));
    } finally {
      if (id === op.current) setAsking(false);
    }
  }

  return (
    <details className={cn('w-full text-sm', className)}>
      <summary className={summaryClass}>Searches behind this question</summary>
      <div className="mt-2 space-y-2 rounded-md border bg-muted/40 px-3 py-2">
        <p className="text-ink-soft text-xs">{SEARCHES_NOTE}</p>
        <ul className="list-disc space-y-0.5 pl-5">
          {searches.map((s) => (
            <li key={s}>{s}</li>
          ))}
          {extra.map((s) => (
            <li key={`more-${s}`}>
              {s} <span className="text-ink-soft text-xs">({localModel ?? 'local model'})</span>
            </li>
          ))}
        </ul>
        {localModel !== null && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={asking}
            onClick={() => ask(localModel)}
          >
            <Sparkles aria-hidden="true" />
            {asking ? 'Asking...' : 'Suggest more searches'}
          </Button>
        )}
        {message !== null && (
          <div role="status" className="space-y-2 text-xs">
            {message}
          </div>
        )}
      </div>
    </details>
  );
}
