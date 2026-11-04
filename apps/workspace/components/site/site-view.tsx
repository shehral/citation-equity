'use client';

import { BLOCKER_IDS } from '@citation-equity/engine';
import { ChevronRight, ClipboardPaste, FileText, Terminal } from 'lucide-react';
import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { LabelChip } from '@/components/check-chip';
import { CE_SITE_EXAMPLE } from '@/lib/cli-examples';
import { EXAMPLE_SITE_INPUT, isExampleSite } from '@/lib/examples';
import { labelTooltip } from '@/lib/glossary';
import { getPastedSite, type SiteInput, setPastedSite } from '@/lib/pasted';
import { getSummary, type SiteSummary, setSummary, subscribe } from '@/lib/store';
import { useScrollToHash } from '@/lib/use-scroll-to-hash';
import { cn } from '@/lib/utils';
import { FIRST_ISSUE_ID } from '@/lib/views';
import {
  blockerName,
  blockersLine,
  checkPastedSite,
  groupRows,
  lastCheckLine,
  liveSiteLine,
  type SiteCheck,
  type SiteRow,
  siteSummaryOf,
} from './site-check';
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

/** The three blockers by name, then the page notes as one item. */
const WHAT_IT_CHECKS = [...BLOCKER_IDS.map(blockerName), 'Four page notes'];

/** Before any paste: what the check covers, with grey dots. */
function WhatItChecks() {
  return (
    <ul
      aria-label="What it checks"
      className="mt-6 grid gap-x-6 gap-y-2 text-ink-soft text-sm sm:grid-cols-2"
    >
      {WHAT_IT_CHECKS.map((name) => (
        <li key={name} className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-border-strong" />
          {name}
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
 * first-issue anchor when a blocker is stored, so the home's link to it still lands somewhere
 * real.
 */
function LastCheck({ summary }: { summary: SiteSummary }) {
  const blocked = summary.blockers.length > 0;
  useScrollToHash(FIRST_ISSUE_ID, blocked);
  return (
    <section
      id={blocked ? FIRST_ISSUE_ID : undefined}
      aria-label="Last check"
      className={cn(card, 'scroll-mt-24 py-4')}
    >
      <p className="flex flex-wrap items-center gap-2 font-medium">
        {lastCheckLine(summary.blockers)}
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

/**
 * The page notes, collapsed: none keeps a page out of AI answers, and our tests did not cover
 * them. Each keeps its plain verdict and Why it matters.
 */
function OtherNotes({ rows }: { rows: SiteRow[] }) {
  return (
    <details className="group/notes border-border border-t">
      <summary className={cn(disclosureSummary, 'w-full gap-2 py-3')}>
        <ChevronRight
          className="size-4 shrink-0 text-ink-faint transition-transform duration-150 group-open/notes:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        <span>Other page notes ({rows.length})</span>
        <LabelChip
          label="not-tested"
          tooltip={labelTooltip('not-tested', { readiness: true })}
          className="ml-auto"
        />
      </summary>
      <ul aria-label="Other page notes" className="divide-y divide-border pl-6">
        {rows.map((row) => (
          <SiteRowItem key={row.id} row={row} kind="note" />
        ))}
      </ul>
    </details>
  );
}

function Results({ check, example }: { check: SiteCheck; example: boolean }) {
  const blockersId = useId();
  const { blockers: blockerRows, notes } = groupRows(check.rows);
  // The stored summary's blockers, so the headline and the anchor read what the home reads. The
  // home links to the first one (/site/#first-issue), the one its banner names; a Check row never
  // takes it.
  const { blockers } = siteSummaryOf(check);
  const firstBlocker = blockers[0];
  useScrollToHash(FIRST_ISSUE_ID, firstBlocker !== undefined);
  return (
    <section aria-label="Results" className={card}>
      <p
        role="status"
        className="flex flex-wrap items-center gap-2 pt-4 pb-3 font-medium font-serif text-xl"
      >
        {blockersLine(blockers)}
        {example && <ExampleChip />}
      </p>
      <h2
        id={blockersId}
        className="pb-2 font-semibold text-ink-soft text-xs uppercase leading-none tracking-wider"
      >
        Blockers
      </h2>
      <ul aria-labelledby={blockersId} className="divide-y divide-border border-border border-t">
        {blockerRows.map((row) => (
          <SiteRowItem
            key={row.id}
            row={row}
            kind="blocker"
            id={row.id === firstBlocker ? FIRST_ISSUE_ID : undefined}
          />
        ))}
      </ul>
      <OtherNotes rows={notes} />
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
    const next = siteSummaryOf(check);
    const prev = getSummary('site');
    const same =
      prev !== null &&
      prev.example === example &&
      prev.needsLiveSite === next.needsLiveSite &&
      prev.blockers.join() === next.blockers.join() &&
      prev.checks.join() === next.checks.join();
    if (!same) setSummary('site', { ...next, example, at: new Date().toISOString() });
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
