'use client';

import type { SourceKind } from '@citation-equity/engine';
import { FileCode, MessagesSquare, PenLine } from 'lucide-react';
import type { CitedSummary, DraftSummary, SiteSummary } from '@/lib/store';
import { VIEW_HREF } from '@/lib/views';
import { FEW_ANSWERS } from './next-up';
import { Big, Meta, Tile } from './tile';

// Each tile is named by the question it answers. Your draft needs attention while a Start here
// fix is open; Your site while any row fails; Who gets cited while no answer cites the user's
// site. Icons match the tabs.

/** Short names for the kinds of sites AI cites, for one line on the tile. */
const KIND_LABEL: Record<SourceKind, string> = {
  forum: 'Forums',
  wiki: 'Wikipedia',
  video: 'Video',
  reviews: 'Reviews',
  news: 'News',
  reference: 'Reference',
  social: 'Social',
  commerce: 'Shops',
  'blog-or-other': 'Blogs',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Empty({ children }: { children: string }) {
  return <p className="text-ink-soft text-sm">{children}</p>;
}

export function DraftTile({ summary }: { summary: DraftSummary | null }) {
  const common = {
    name: 'Your draft',
    question: 'Is my post easy for AI to quote?',
    icon: PenLine,
    href: VIEW_HREF.draft,
  };
  if (!summary) {
    return (
      <Tile {...common} state="not-checked" cta="Paste a post">
        <Empty>Paste a post. Get a score and the few things worth fixing.</Empty>
      </Tile>
    );
  }
  // The stored score is always the Standard score, so "+N" compares like with like.
  const delta = summary.score - summary.baseline.standard;
  const open = summary.openStartHere;
  return (
    <Tile
      {...common}
      state={open > 0 ? 'attention' : 'checked'}
      example={summary.example}
      cta="Open draft"
    >
      <Big n={summary.score} of="/ 100">
        {delta > 0 ? (
          <span className="self-center rounded-full bg-done-soft px-2 py-1 font-semibold text-done text-xs tabular-nums leading-none">
            +{delta} since you started
          </span>
        ) : null}
      </Big>
      <div className="h-2 overflow-hidden rounded-full bg-score-track" aria-hidden="true">
        <div className="h-full rounded-full bg-score" style={{ width: `${summary.score}%` }} />
      </div>
      <Meta>{open > 0 ? `Start with ${plural(open, 'quick win')}` : 'Quick wins done'}</Meta>
    </Tile>
  );
}

export function SiteTile({ summary }: { summary: SiteSummary | null }) {
  const common = {
    name: 'Your site',
    question: 'Can AI read my published page?',
    icon: FileCode,
    href: VIEW_HREF.site,
  };
  if (!summary) {
    return (
      <Tile {...common} state="not-checked" cta="Check a page">
        <Empty>Paste your page's HTML. See if AI search can find, read and quote it.</Empty>
      </Tile>
    );
  }
  const issues = [
    summary.fail > 0 ? plural(summary.fail, 'fail') : '',
    summary.warn > 0 ? plural(summary.warn, 'warning') : '',
  ].filter((s) => s !== '');
  return (
    <Tile
      {...common}
      state={summary.fail > 0 ? 'attention' : 'checked'}
      example={summary.example}
      cta="See details"
    >
      <Big n={summary.pass} of={`of ${summary.total} pass`} />
      {issues.length > 0 ? <Meta>{issues.join(', ')}</Meta> : null}
      {summary.needsLiveSite > 0 ? (
        <Meta>
          {summary.needsLiveSite === 1
            ? '1 more needs your live site'
            : `${summary.needsLiveSite} more need your live site`}
        </Meta>
      ) : null}
    </Tile>
  );
}

export function CitedTile({ summary }: { summary: CitedSummary | null }) {
  const common = {
    name: 'Who gets cited',
    question: 'Who does AI cite for my questions?',
    icon: MessagesSquare,
    href: VIEW_HREF.cited,
  };
  if (!summary) {
    return (
      <Tile {...common} state="not-checked" cta="Paste an answer">
        <Empty>Paste an answer from ChatGPT or Perplexity. See which sites it cites.</Empty>
      </Tile>
    );
  }
  const kinds = summary.topKinds.map((k) => KIND_LABEL[k as SourceKind] ?? k);
  const mostCited =
    kinds.length > 0 ? <Meta>Most cited: {kinds.slice(0, 2).join(', ')}</Meta> : null;
  const few = summary.answers < FEW_ANSWERS ? <Meta>Paste a few more answers</Meta> : null;
  // No site given: citingYou says nothing about the user, so ask for a site.
  if (summary.site === undefined) {
    return (
      <Tile {...common} state="checked" example={summary.example} cta="See who else">
        <Big n={summary.answers} of={summary.answers === 1 ? 'answer' : 'answers'} />
        <Meta>Add your site to see if you are cited</Meta>
        {few}
        {mostCited}
      </Tile>
    );
  }
  return (
    <Tile
      {...common}
      state={summary.citingYou === 0 ? 'attention' : 'checked'}
      example={summary.example}
      cta="See who else"
    >
      <Big n={summary.citingYou} of={`of ${plural(summary.answers, 'answer')} cite you`} />
      {summary.citingYou === 0 ? <Meta>Not cited yet</Meta> : null}
      {few}
      {mostCited}
    </Tile>
  );
}
