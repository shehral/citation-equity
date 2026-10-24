'use client';

import { Button } from '@/components/ui/button';

/**
 * The first-visit hero: a short headline (six words at most, like every heading) and one
 * primary button; the line under it names the three checks in 15 words or fewer.
 */
export function TryExample({ onTry }: { onTry(): void }) {
  return (
    <div className="max-w-2xl pt-3 pb-8 sm:pt-7">
      <h1 className="mb-3.5 font-medium font-serif text-4xl leading-[1.05] tracking-tight sm:text-5xl">
        Get <em className="text-brand">quoted</em> by AI search.
      </h1>
      <p className="mb-6 max-w-xl text-ink-soft text-lg leading-relaxed">
        Check your post, your page, and who ChatGPT, Perplexity and Google AI cite.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" onClick={onTry}>
          Try it with an example
        </Button>
        <span className="text-ink-soft text-sm">or pick a check below</span>
      </div>
    </div>
  );
}
