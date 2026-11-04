'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useSyncExternalStore } from 'react';
import { TestIt } from '@/components/draft/test-it';
import { draftKeyFor } from '@/lib/draft-summary';
import { draftTextFor, isEmptyDraft } from '@/lib/open-draft';
import { getLoadedPack, setLoadedPack } from '@/lib/pasted';
import { MY_DRAFT_LABEL, sampleFor } from '@/lib/samples';
import { getActiveSlot, MY_POST_SLOT, subscribe } from '@/lib/store';
import { VIEW_HREF } from '@/lib/views';

// The prerendered page cannot know this browser's draft, so the server and the first hydration
// render read none and show nothing here: no "Paste a draft first." flashes before a stored
// draft appears, and no other draft's panel either.
const serverSlot = () => MY_POST_SLOT;
const serverText = () => null;

/**
 * Test before and after on the open draft (the store's active slot): its saved text, else its
 * starting text, and its sample when it is an example. A draft with nothing to measure (the rule
 * the draft card uses) asks for a draft instead. A test pack loaded for an own post stays in page
 * memory (lib/pasted) while the author leaves to edit, so the run compares the text at the load
 * with the edited text.
 */
export function TestPanel() {
  const slot = useSyncExternalStore(subscribe, getActiveSlot, serverSlot);
  const key = draftKeyFor(slot);
  const sample = sampleFor(key);
  // A string snapshot, so it compares by value; the draft is read from page memory when storage
  // refused it, like everywhere else.
  const markdown = useSyncExternalStore(subscribe, () => draftTextFor(key), serverText);
  const empty = useMemo(() => markdown !== null && isEmptyDraft(markdown), [markdown]);

  if (markdown === null) return null;
  if (empty) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-ink-soft">Paste a draft first.</p>
        <Link
          href={VIEW_HREF.draft}
          prefetch={false}
          className="inline-flex items-center gap-1 rounded-sm font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          Open draft
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    );
  }
  return (
    <TestIt
      key={key}
      sample={sample}
      markdown={markdown}
      fallbackTitle={sample?.title ?? MY_DRAFT_LABEL}
      initialPack={getLoadedPack(key)}
      onPackChange={(loaded) => setLoadedPack(key, loaded)}
    />
  );
}
