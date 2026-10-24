'use client';

import { ClipboardPaste } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { selectDraftSlot } from '@/lib/draft-summary';
import { runExample } from '@/lib/examples';
import { getSample } from '@/lib/samples';
import { type DraftSummary, getLastView, getSummary, MY_POST_SLOT, subscribe } from '@/lib/store';
import { VIEW_HREF } from '@/lib/views';
import { takeLanding } from './landing';
import { NextUp, nextUp } from './next-up';
import { CitedTile, DraftTile, SiteTile } from './tiles';
import { TryExample } from './try-example';

const none = () => null;
const useSummary = <K extends 'draft' | 'site' | 'cited'>(k: K) =>
  useSyncExternalStore(subscribe, () => getSummary(k), none);

/** The post a draft summary belongs to, by name. */
function postTitle(draft: DraftSummary): string {
  return draft.slot === MY_POST_SLOT ? 'My post' : getSample(draft.slot).title;
}

/**
 * The home dashboard: on a first visit a headline and Try it with an example; once
 * anything is checked, the post's name, the three tiles from their stored summaries and one
 * Next up action. Returning users who start their visit here land on their last view.
 */
export function Home() {
  const router = useRouter();
  const draft = useSummary('draft');
  const site = useSummary('site');
  const cited = useSummary('cited');
  const [announce, setAnnounce] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    // Runs before the app shell records this visit to the home (React runs child effects first).
    if (!takeLanding()) return;
    const last = getLastView();
    if (last && last !== 'home') router.replace(VIEW_HREF[last]);
  }, [router]);

  const anything = Boolean(draft || site || cited);
  // After Try it, the button is gone; focus moves to the heading that replaced it.
  useEffect(() => {
    if (anything && moveFocus.current) {
      moveFocus.current = false;
      headingRef.current?.focus();
    }
  }, [anything]);

  function tryExample() {
    moveFocus.current = true;
    runExample();
    setAnnounce('Example loaded in all three checks.');
  }

  function openOwnPost() {
    // The tile follows the active draft at once: My post's own summary, or none.
    selectDraftSlot(MY_POST_SLOT);
    router.push(VIEW_HREF.draft);
  }

  const action = anything ? nextUp({ draft, site, cited }) : null;
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-16 sm:px-6">
      {anything ? (
        <div className="flex flex-wrap items-end justify-between gap-4 pt-2 pb-6">
          <div className="min-w-0">
            {draft ? <p className="mb-1 text-ink-soft text-sm">Your post</p> : null}
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-medium font-serif text-2xl leading-tight tracking-tight outline-none sm:text-3xl"
            >
              {draft ? postTitle(draft) : 'Your checks'}
              {draft?.example ? (
                <span className="relative -top-1 ml-2 inline-block rounded-md bg-sunken px-1.5 py-1 align-middle font-medium font-sans text-[11px] text-ink-soft uppercase leading-none tracking-wide">
                  Example
                </span>
              ) : null}
            </h1>
          </div>
          {draft?.example ? (
            <Button type="button" variant="outline" size="sm" onClick={openOwnPost}>
              <ClipboardPaste aria-hidden="true" />
              Use my own post
            </Button>
          ) : null}
        </div>
      ) : (
        <TryExample onTry={tryExample} />
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        <DraftTile summary={draft} />
        <SiteTile summary={site} />
        <CitedTile summary={cited} />
      </div>

      {action ? <NextUp action={action} /> : null}

      <p role="status" className="sr-only">
        {announce}
      </p>
    </main>
  );
}
