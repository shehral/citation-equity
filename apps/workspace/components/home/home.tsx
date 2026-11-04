'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { runExample } from '@/lib/examples';
import { EMPTY_SITE_INPUT, getSiteInput, subscribeSiteInput } from '@/lib/site-questions';
import { getActiveSlot, getLastView, getSummary, MY_POST_SLOT, subscribe } from '@/lib/store';
import { VIEW_HREF } from '@/lib/views';
import { BlockerBanner } from './blocker-banner';
import { takeLanding } from './landing';
import { isExampleSlot, QuestionList, QuestionsInput, startFresh } from './questions-panel';
import { Steps } from './steps';

const none = () => null;
const useSummary = <K extends 'draft' | 'site' | 'cited'>(k: K) =>
  useSyncExternalStore(subscribe, () => getSummary(k), none);

/**
 * The home, "What will your readers ask?": the readers' questions first (the input card and the
 * list, each question ticked for the open draft), Try it with an example on a first visit, a
 * banner while the site check found a blocker, and one step card per later step. Returning
 * users who start their visit here land on their last view.
 */
export function Home() {
  const router = useRouter();
  const draft = useSummary('draft');
  const site = useSummary('site');
  const cited = useSummary('cited');
  const input = useSyncExternalStore(subscribeSiteInput, getSiteInput, () => EMPTY_SITE_INPUT);
  const slot = useSyncExternalStore(subscribe, getActiveSlot, () => MY_POST_SLOT);
  const [announce, setAnnounce] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Runs before the app shell records this visit to the home (React runs child effects first).
    if (!takeLanding()) return;
    const last = getLastView();
    if (last && last !== 'home') router.replace(VIEW_HREF[last]);
  }, [router]);

  const example = isExampleSlot(slot);
  // Try it shows on a first visit only: nothing checked yet and no question typed or imported.
  // While an example is open, its strip shows instead.
  const offerExample =
    !example &&
    !draft &&
    !site &&
    !cited &&
    input.keywords.trim() === '' &&
    input.imported === null;

  // The button that was clicked goes away with the click; the heading takes the focus.
  function tryExample() {
    runExample();
    setAnnounce('Example loaded.');
    headingRef.current?.focus();
  }

  function startOwn() {
    startFresh();
    headingRef.current?.focus();
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-6 pb-16 sm:px-6">
      <div className="max-w-2xl pt-2 sm:pt-5">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-medium font-serif text-4xl leading-[1.05] tracking-tight outline-none sm:text-5xl"
        >
          What will your readers ask?
        </h1>
        <p className="mt-3 max-w-xl text-ink-soft text-lg leading-relaxed">
          Start from their questions. Then check your draft answers them and AI search can reach it.
        </p>
        {example ? (
          <div className="mt-5 inline-flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border-strong border-dashed px-4 py-2.5 text-sm">
            <p>
              <strong className="font-semibold">This is the example.</strong> Type your own
              questions to replace it.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={startOwn}>
              Start fresh
            </Button>
          </div>
        ) : offerExample ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="button" size="lg" onClick={tryExample}>
              Try it with an example
            </Button>
            <span className="text-ink-soft text-sm">or type your own below</span>
          </div>
        ) : null}
      </div>

      <BlockerBanner blockers={site?.blockers ?? []} example={site?.example ?? false} />

      {/*
        One grid, three items. On a phone they stack in source order: the input card, the step
        cards, then the list. From lg the step cards move to a second column beside the other two;
        the last row (1fr) takes up any height they add, so the list sits right under the input
        card. The column sticks under the header, never taller than the screen below it: on a
        short screen it scrolls inside itself, so no card is cut off. A scroll box clips what
        spills past it, so its padding (offset by a negative margin) keeps room for the cards'
        focus ring, shadow and hover lift.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_auto_1fr] lg:gap-x-8">
        <QuestionsInput className="lg:col-start-1 lg:row-start-1" />
        <div className="lg:sticky lg:top-20 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:-m-1 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:p-1">
          <Steps draft={draft} site={site} cited={cited} />
        </div>
        <QuestionList canTryExample={offerExample} className="lg:col-start-1 lg:row-start-2" />
      </div>

      <p role="status" className="sr-only">
        {example ? announce : ''}
      </p>
    </main>
  );
}
