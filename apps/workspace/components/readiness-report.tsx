'use client';

import {
  analyzeReadiness,
  type ReadinessId,
  type ReadinessItem,
  type ReadinessStatus,
} from '@citation-equity/engine';
import { CircleCheck, CircleDashed, CircleX, type LucideIcon, TriangleAlert } from 'lucide-react';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { textLink } from '@/components/page-shell';
import { GRADE_CLASS } from '@/components/panel/evidence-badge';
import { Command } from '@/components/panel/ollama-help';
import { CE_SITE_EXAMPLE } from '@/lib/cli-examples';
import { cn } from '@/lib/utils';

/** What each item is, in plain words, shown above its result. */
const WHAT: Record<ReadinessId, string> = {
  byline:
    'Who wrote the page, named where machines can find it: in structured data, a meta author tag or byline markup.',
  dates: 'When the page was published and last updated, in a form machines can read.',
  'structured-data':
    'JSON-LD that says in schema.org terms what the page is: an article, a how-to, a set of questions and answers.',
  'indexing-directives':
    'Tags that ask search engines not to index the page or not to quote it. AI answers built on those engines follow them too.',
  canonical: 'The one address the page should be known by, when it can be reached at several.',
  'crawler-access':
    "Whether the site's robots.txt lets the crawlers of AI answer engines fetch the page.",
  'renders-without-js':
    "Whether the article's text is in the HTML the server sends. Several AI crawlers do not run JavaScript.",
};

/** The two items that need a fetch of the live site, which this page cannot make. */
const NEEDS_CLI: ReadinessId[] = ['crawler-access', 'renders-without-js'];

const STATUS: Record<ReadinessStatus, { label: string; icon: LucideIcon; className: string }> = {
  pass: { label: 'Pass', icon: CircleCheck, className: 'border-grade-strong/50 text-grade-strong' },
  warn: {
    label: 'Warning',
    icon: TriangleAlert,
    className: 'border-warning-foreground/40 bg-warning text-warning-foreground',
  },
  fail: { label: 'Fail', icon: CircleX, className: 'border-destructive/50 text-destructive' },
  unknown: {
    label: 'Not checked',
    icon: CircleDashed,
    className: 'border-border text-muted-foreground',
  },
};

function StatusBadge({ status }: { status: ReadinessStatus }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-xs',
        className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

function Item({ item }: { item: ReadinessItem }) {
  const headingId = useId();
  const { evidence } = item;
  return (
    <section aria-labelledby={headingId} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="mr-auto font-semibold">
          {item.title}
        </h3>
        <StatusBadge status={item.status} />
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-medium text-xs',
            GRADE_CLASS[evidence.grade],
          )}
        >
          Evidence: {evidence.grade}
        </span>
      </div>
      <p className="mt-2 text-muted-foreground text-sm">{WHAT[item.id]}</p>
      <p className="mt-2 text-sm">{item.detail}</p>
      {NEEDS_CLI.includes(item.id) && (
        <div className="mt-2 text-sm">
          <p>This browser page cannot fetch other sites. From a copy of the repository, run:</p>
          <Command>{CE_SITE_EXAMPLE}</Command>
        </div>
      )}
      <p className="mt-3 text-sm leading-relaxed">{evidence.summary}</p>
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
 * Runs the engine's page-level readiness items on HTML the author pastes. Everything happens in
 * this browser: the HTML is parsed, never rendered, and nothing is sent anywhere.
 */
export function ReadinessReport() {
  const inputId = useId();
  const hintId = useId();
  const [html, setHtml] = useState('');
  const deferred = useDeferredValue(html);
  const result = useMemo(() => analyzeReadiness({ html: deferred }), [deferred]);
  return (
    <div className="mt-6">
      <label htmlFor={inputId} className="font-medium">
        Page HTML
      </label>
      <p id={hintId} className="mt-1 text-muted-foreground text-sm">
        Open your published page, view its source (Ctrl+U or Cmd+Option+U in most browsers), copy
        all of it and paste it here. It is checked in this browser and never sent anywhere.
      </p>
      <textarea
        id={inputId}
        aria-describedby={hintId}
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        spellCheck={false}
        rows={8}
        className="mt-2 w-full rounded-md border bg-background p-2 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      />
      <div className="mt-6 space-y-4">
        {result.items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
