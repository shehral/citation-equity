'use client';

import {
  BIG_MAX_RANK,
  type CitedDomain,
  type SiteSize,
  sizeMix,
  TRANCO_URL,
} from '@citation-equity/engine';
import { X } from 'lucide-react';
import { type ChangeEvent, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  getTrancoList,
  listName,
  loadTrancoText,
  setTrancoList,
  subscribeTrancoList,
} from '@/lib/tranco-list';
import { cn } from '@/lib/utils';

const ROWS: [SiteSize, string][] = [
  ['big', 'Big sites'],
  ['mid', 'Mid-size sites'],
  ['small', 'Small sites'],
];

const link =
  'rounded-sm font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring';

/** A quiet share bar, like the one beside each cited site. */
function Bar({ k, n }: { k: number; n: number }) {
  return (
    <span aria-hidden="true" className="hidden h-1.5 w-24 rounded-full bg-sunken sm:block">
      <span
        className="block h-full rounded-full bg-ink-faint"
        style={{ width: `${n === 0 ? 0 : Math.round((k / n) * 100)}%` }}
      />
    </span>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The file picker for a Tranco list, with its error. */
function LoadList() {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  async function read(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (/\.zip$/i.test(file.name)) {
      setError('Unzip the download first, then load the .csv file inside.');
      return;
    }
    try {
      setTrancoList(loadTrancoText(await file.text(), file.name));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <div className="mt-3 space-y-2 text-sm">
      <label htmlFor={id} className="font-medium">
        Load a Tranco list
      </label>
      <p className="text-ink-soft">
        A free ranking of the top million sites.{' '}
        <a href={TRANCO_URL} target="_blank" rel="noreferrer" className={link}>
          Download its CSV
        </a>
        , then load it here. It stays in this page; nothing is uploaded.
      </p>
      <input
        id={id}
        type="file"
        accept=".csv,text/csv,text/plain"
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
    </div>
  );
}

/**
 * Do small sites win these questions at all? The cited sites' citations by size, from the Tranco
 * list the author loaded: big, mid and small with a share bar each, then Wikipedia and hosting
 * platforms, which are counted apart. Without a list it explains what a list adds and offers to
 * load one. Shown only when an answer was pasted.
 */
export function SizeMixCard({ domains }: { domains: CitedDomain[] }) {
  const titleId = useId();
  const loaded = useSyncExternalStore(subscribeTrancoList, getTrancoList, () => null);
  const mix = useMemo(() => sizeMix(domains, loaded?.list), [domains, loaded]);
  const { bySize, sized } = mix;
  const apart = [
    bySize.wikipedia.citations > 0 ? `Wikipedia (${bySize.wikipedia.citations})` : '',
    bySize.platform.citations > 0 ? `hosting platforms (${bySize.platform.citations})` : '',
  ].filter(Boolean);

  return (
    <section
      aria-labelledby={titleId}
      className="mt-10 rounded-lg border bg-surface p-4 shadow-card"
    >
      <h3 id={titleId} className="font-medium font-serif text-xl">
        Do small sites win these questions?
      </h3>
      {loaded ? (
        <>
          {sized === 0 ? (
            <p className="mt-2 text-ink-soft text-sm">
              None of the cited sites is ranked big, mid or small.
            </p>
          ) : (
            <>
              <p className="mt-2 font-serif text-lg">
                Small sites got {bySize.small.citations} of {sized} citations.
              </p>
              <table className="mt-2 w-full text-left text-sm">
                <caption className="sr-only">Citations by site size</caption>
                <tbody>
                  {ROWS.map(([size, name]) => (
                    <tr key={size} className="border-t first:border-t-0">
                      <th scope="row" className="py-1.5 pr-3 font-normal">
                        {name}
                        <span className="ml-2 text-muted-foreground text-xs">
                          {plural(bySize[size].sites, 'site', 'sites')}
                        </span>
                      </th>
                      <td className="w-px whitespace-nowrap py-1.5 text-right">
                        <span className="flex items-center justify-end gap-2">
                          <Bar k={bySize[size].citations} n={sized} />
                          <span className="tabular-nums">
                            {bySize[size].citations} of {sized}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {apart.length > 0 && (
            <p className="mt-2 text-ink-soft text-sm">Counted apart: {apart.join(', ')}.</p>
          )}
          <p className="mt-3 text-muted-foreground text-xs">
            Sizes from {listName(loaded)}. Big: the top {BIG_MAX_RANK.toLocaleString('en-US')}. Mid:
            the rest of the top million. Small: not on the list. A blog on a hosting platform and
            Wikipedia are counted apart, since their rank says nothing about the writer. Sites move
            in and out of the top million, so use a list from around when you asked.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setTrancoList(null)}
          >
            <X aria-hidden="true" />
            Remove the list
          </Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-ink-soft text-sm">
            See how many of these citations went to big, mid-size and small sites.
            {apart.length > 0 ? ` Counted apart already: ${apart.join(', ')}.` : ''}
          </p>
          <LoadList />
        </>
      )}
    </section>
  );
}
