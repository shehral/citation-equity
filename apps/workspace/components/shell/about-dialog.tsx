'use client';

import { CHECK_IDS } from '@citation-equity/engine';
import Link from 'next/link';
import { textLink } from '@/components/page-shell';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { REPO_URL } from '@/lib/links';
import { RESEARCH_HREF } from '@/lib/views';

/** The credit, word for word. It appears here and nowhere else in the app. */
export const CREDIT =
  'Original design by Prof. Akram Bayat. Built by Mohammad Ali Shehral and Ishan Gupta, Northeastern University, San Jose.';

interface AboutDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

/** About: what the tool is, how it works, the research link and the credit. */
export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl bg-surface shadow-pop sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-medium font-serif text-2xl">About</DialogTitle>
          <DialogDescription className="text-base text-foreground leading-relaxed">
            Citation Equity is a free, open-source writing tool that helps independent writers get
            quoted by AI search. It suggests; you decide.
          </DialogDescription>
        </DialogHeader>
        <section aria-labelledby="about-how" className="space-y-2">
          <h3 id="about-how" className="font-semibold text-sm">
            How it works
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            <li>
              <strong className="font-semibold">Checks</strong> your draft against{' '}
              {CHECK_IDS.length} writing habits.
            </li>
            <li>
              <strong className="font-semibold">Suggests</strong> fixes one at a time; you apply,
              mark done or skip.
            </li>
            <li>
              <strong className="font-semibold">Tests</strong> before and after on a free AI that
              runs on your computer.
            </li>
          </ul>
          <p className="text-ink-soft text-sm leading-relaxed">
            No check is proven yet.{' '}
            <Link
              href={RESEARCH_HREF}
              prefetch={false}
              className={textLink}
              onClick={() => onOpenChange(false)}
            >
              How we tested this
            </Link>
          </p>
        </section>
        <section aria-labelledby="about-credits" className="space-y-2">
          <h3 id="about-credits" className="font-semibold text-sm">
            Credits
          </h3>
          <p className="text-sm leading-relaxed">{CREDIT}</p>
          <p className="text-sm">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className={textLink}>
              Source code on GitHub (MIT)
            </a>
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
