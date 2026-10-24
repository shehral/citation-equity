'use client';

import { ClipboardPaste, FileText, Terminal } from 'lucide-react';
import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { CE_SITE_EXAMPLE } from '@/lib/cli-examples';
import { EXAMPLE_SITE_INPUT, isExampleSite } from '@/lib/examples';
import { getPastedSite, type SiteInput, setPastedSite } from '@/lib/pasted';
import { getSummary, type SiteSummary, setSummary, subscribe } from '@/lib/store';
import { useScrollToHash } from '@/lib/use-scroll-to-hash';
import { cn } from '@/lib/utils';
import { FIRST_ISSUE_ID } from '@/lib/views';
import { checkPastedSite, liveSiteLine, ROWS, type SiteCheck, siteSummaryLine } from './site-check';
import { Chevron, disclosureSummary, SiteRowItem } from './site-row';

const field =
  'mt-2 w-full rounded-md border border-input bg-surface p-3 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring';
const card = 'mt-6 rounded-lg border border-border bg-surface px-4 shadow-card sm:px-5';

function PasteBox({
  label,
  hint,
  icon,
  value,
  rows,
  onChange,
}: {
  label: string;
  hint: string;
  icon: ReactNode;
  value: string;
  rows: number;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="mt-6">
      <label htmlFor={id} className="flex items-center gap-2 font-medium">
        {icon}
        {label}
      </label>
      <p id={hintId} className="mt-1 text-ink-soft text-sm">
        {hint}
      </p>
      <textarea
        id={id}
        aria-describedby={hintId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        rows={rows}
        className={field}
      />
    </div>
  );
}

/** Before any paste: the seven checks as names with grey dots. */
function WhatItChecks() {
  return (
    <ul
      aria-label="What it checks"
      className="mt-6 grid gap-x-6 gap-y-2 text-ink-soft text-sm sm:grid-cols-2"
    >
      {ROWS.map((r) => (
        <li key={r.id} className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-border-strong" />
          {r.name}
        </li>
      ))}
    </ul>
  );
}

function ExampleChip() {
  return (
    <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium font-sans text-brand text-xs">
      Example
    </span>
  );
}

/**
 * After a reload: the stored summary, since the pasted HTML was never stored. It carries the
 * first-issue anchor when the check failed, so the home's Next up still lands somewhere real.
 */
function LastCheck({ summary }: { summary: SiteSummary }) {
  useScrollToHash(FIRST_ISSUE_ID, summary.fail > 0);
  return (
    <section
      id={summary.fail > 0 ? FIRST_ISSUE_ID : undefined}
      aria-label="Last check"
      className={cn(card, 'scroll-mt-24 py-4')}
    >
      <p className="flex flex-wrap items-center gap-2 font-medium">
        {siteSummaryLine(summary)}
        {summary.example && <ExampleChip />}
      </p>
      <p className="mt-1 text-ink-soft text-sm">Paste again to see details.</p>
    </section>
  );
}

/** The checks only `ce site` can run; the command shows on expand, once. */
function LiveSiteRow({ check }: { check: SiteCheck }) {
  return (
    <details className="group border-border border-t py-3 text-sm">
      <summary className={cn(disclosureSummary, 'gap-2 text-ink-soft')}>
        <Terminal className="size-4" aria-hidden="true" />
        {liveSiteLine(check.summary)}
        <Chevron />
      </summary>
      <div className="mt-2 space-y-2 pl-6">
        <ul className="list-disc pl-4 text-ink-soft">
          {check.liveOnly.map((what) => (
            <li key={what}>{what}</li>
          ))}
        </ul>
        <p>Run from the command line, in a copy of the repository:</p>
        <pre className="overflow-x-auto rounded-md bg-sunken px-3 py-2 font-mono text-xs">
          <code>{CE_SITE_EXAMPLE}</code>
        </pre>
        <p className="text-ink-soft">Checks all 7 against your live page.</p>
      </div>
    </details>
  );
}

function Results({ check, example }: { check: SiteCheck; example: boolean }) {
  // The home's Next up links to the first failing row (/site/#first-issue).
  const firstFail = check.rows.find((r) => r.status === 'fail')?.id;
  useScrollToHash(FIRST_ISSUE_ID, firstFail !== undefined);
  return (
    <section aria-label="Results" className={card}>
      <p
        role="status"
        className="flex flex-wrap items-center gap-2 border-border border-b py-4 font-medium font-serif text-xl"
      >
        {siteSummaryLine(check.summary)}
        {example && <ExampleChip />}
      </p>
      <ul className="divide-y divide-border">
        {check.rows.map((row) => (
          <SiteRowItem
            key={row.id}
            row={row}
            id={row.id === firstFail ? FIRST_ISSUE_ID : undefined}
          />
        ))}
      </ul>
      <LiveSiteRow check={check} />
    </section>
  );
}

const EMPTY: SiteInput = { html: '', robotsTxt: '' };

/**
 * Your site: paste the page's HTML (and optionally its robots.txt), then a compact result.
 * The pasted text stays in page memory (lib/pasted), so switching views keeps it; only the
 * summary is stored. While nothing is pasted and the stored check is the example's, the view
 * runs on the example's page, so its details show.
 */
export function SiteView() {
  const [pasted, setPasted] = useState<SiteInput | null>(getPastedSite);
  const stored = useSyncExternalStore(
    subscribe,
    () => getSummary('site'),
    () => null,
  );
  const input = pasted ?? (stored?.example ? EXAMPLE_SITE_INPUT : EMPTY);
  const deferredHtml = useDeferredValue(input.html);
  const deferredRobots = useDeferredValue(input.robotsTxt);
  const { check, example } = useMemo(() => {
    const checked = { html: deferredHtml, robotsTxt: deferredRobots };
    return {
      check: deferredHtml.trim() === '' ? null : checkPastedSite(checked),
      example: isExampleSite(checked),
    };
  }, [deferredHtml, deferredRobots]);

  function change(patch: Partial<SiteInput>) {
    const next = { ...input, ...patch };
    setPastedSite(next);
    setPasted(next);
  }

  useEffect(() => {
    if (!check) return;
    const prev = getSummary('site');
    const same =
      prev !== null &&
      prev.example === example &&
      (Object.keys(check.summary) as (keyof typeof check.summary)[]).every(
        (k) => prev[k] === check.summary[k],
      );
    if (!same) setSummary('site', { ...check.summary, example, at: new Date().toISOString() });
  }, [check, example]);

  return (
    <div>
      <PasteBox
        label="Page HTML"
        hint="On your live page, View Source (Ctrl+U, or ⌘⌥U on Mac), copy all, paste here. Checked here, never sent."
        icon={<ClipboardPaste className="size-4 text-brand" aria-hidden="true" />}
        value={input.html}
        rows={8}
        onChange={(html) => change({ html })}
      />
      <PasteBox
        label="robots.txt (optional)"
        hint="Open yoursite.com/robots.txt, copy all, paste here."
        icon={<FileText className="size-4 text-brand" aria-hidden="true" />}
        value={input.robotsTxt}
        rows={3}
        onChange={(robotsTxt) => change({ robotsTxt })}
      />
      {check ? (
        <Results check={check} example={example} />
      ) : stored ? (
        <LastCheck summary={stored} />
      ) : (
        <WhatItChecks />
      )}
    </div>
  );
}
