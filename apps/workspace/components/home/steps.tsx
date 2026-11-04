'use client';

import type { ReadinessId, SourceKind } from '@citation-equity/engine';
import { FileCode, MessagesSquare, PenLine } from 'lucide-react';
import { useId } from 'react';
import { blockerName, blockersLine } from '@/components/site/site-check';
import { START_HERE_ID, VIEW_HREF } from '@/lib/views';
import { Big, Meta, Tile } from './tile';

// The home's three step cards, one per later step, each named by the question it answers and
// titled one level below the Next steps heading (h3 under its h2). Your draft needs attention
// while a question is not covered (or it has none); Your site while a blocker is found; Results
// while no answer cites the user's site. Icons match the tabs. The props are the stored
// summaries' fields, typed here so the cards depend on nothing else.

interface DraftStep {
  covered: number;
  total: number;
  fromPage: boolean;
  example: boolean;
}

interface SiteStep {
  /** Blocker ids, as `/site/` stores them. */
  blockers: string[];
  needsLiveSite: number;
  example: boolean;
}

interface CitedStep {
  answers: number;
  citingYou: number;
  /** The user's own site; absent when none was given. */
  site?: string;
  topKinds: string[];
  example: boolean;
}

/** Fewer answers than this is a small sample. */
const FEW_ANSWERS = 3;

/** Short names for the kinds of sites AI cites, for one line on the card. */
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

/** The cards' names sit under the h2 Next steps. */
const CARD_HEADING = 3;

function Empty({ children }: { children: string }) {
  return <p className="text-ink-soft text-sm">{children}</p>;
}

/** A status in words where a card has no number to show. */
function Line({ children }: { children: string }) {
  return <p className="font-medium font-serif text-3xl leading-tight tracking-tight">{children}</p>;
}

function DraftCard({ summary }: { summary: DraftStep | null }) {
  const common = {
    name: 'Your draft',
    question: 'Does it answer them?',
    icon: PenLine,
    headingLevel: CARD_HEADING,
  } as const;
  if (!summary) {
    return (
      <Tile {...common} state="not-checked" href={VIEW_HREF.draft} cta="Open draft">
        <Empty>Paste your post. See which questions it covers.</Empty>
      </Tile>
    );
  }
  const { covered, total, fromPage, example } = summary;
  return (
    <Tile
      {...common}
      state={total === 0 || covered < total ? 'attention' : 'checked'}
      example={example}
      href={`${VIEW_HREF.draft}#${START_HERE_ID}`}
      cta="Open draft"
    >
      {total === 0 ? (
        <Line>No questions yet</Line>
      ) : (
        <>
          <Big n={covered} of={`of ${total} covered`} />
          {fromPage ? <Meta>From your title</Meta> : null}
        </>
      )}
    </Tile>
  );
}

function SiteCard({ summary }: { summary: SiteStep | null }) {
  const common = {
    name: 'Your site',
    question: 'Can engines reach it?',
    icon: FileCode,
    href: VIEW_HREF.site,
    headingLevel: CARD_HEADING,
  } as const;
  if (!summary) {
    return (
      <Tile {...common} state="not-checked" cta="Check page">
        <Empty>Paste your page's HTML. See what keeps engines away.</Empty>
      </Tile>
    );
  }
  // The store accepts only blocker ids, and blockerName shows any other id as it is.
  const blockers = summary.blockers as ReadinessId[];
  return (
    <Tile
      {...common}
      state={blockers.length > 0 ? 'attention' : 'checked'}
      example={summary.example}
      cta="See details"
    >
      <Line>{blockersLine(blockers)}</Line>
      {blockers.length > 0 ? <Meta>{blockers.map(blockerName).join(', ')}</Meta> : null}
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

function ResultsCard({ summary }: { summary: CitedStep | null }) {
  const common = {
    name: 'Results',
    question: 'Did it change anything?',
    icon: MessagesSquare,
    href: VIEW_HREF.cited,
    cta: 'See results',
    headingLevel: CARD_HEADING,
  } as const;
  if (!summary) {
    return (
      <Tile {...common} state="not-checked">
        <Empty>Test before and after, or paste AI answers.</Empty>
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
      <Tile {...common} state="checked" example={summary.example}>
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
    >
      {/* A snapshot of live answers, not a before and after; "1 of 1 live answer cites you". */}
      <Big
        n={summary.citingYou}
        of={`of ${plural(summary.answers, 'live answer')} ${summary.answers === 1 ? 'cites' : 'cite'} you`}
      />
      {summary.citingYou === 0 ? <Meta>Not cited yet</Meta> : null}
      {few}
      {mostCited}
    </Tile>
  );
}

/** The heading Next steps and the three step cards: Your draft, Your site and Results. */
export function Steps({
  draft,
  site,
  cited,
}: {
  draft: DraftStep | null;
  site: SiteStep | null;
  cited: CitedStep | null;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2
        id={headingId}
        className="font-semibold text-ink-soft text-xs uppercase leading-none tracking-wider"
      >
        Next steps
      </h2>
      <DraftCard summary={draft} />
      <SiteCard summary={site} />
      <ResultsCard summary={cited} />
    </section>
  );
}
