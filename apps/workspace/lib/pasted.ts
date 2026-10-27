// What the author pasted into Your site and Who gets cited, kept in this page's memory only.
// It is never written to browser storage, so a full reload forgets it (the views then show the
// stored summary with "Paste again to see details"), but moving between views inside the app
// keeps it, since a module outlives the components that mount and unmount on each view.

import { onClearAll } from './store';

export interface SiteInput {
  html: string;
  robotsTxt: string;
}

export interface CitedInputEntry {
  /** Stable per entry, for React keys. */
  key: number;
  question: string;
  answer: string;
}

export interface CitedInput {
  entries: CitedInputEntry[];
  own: string;
}

let site: SiteInput | null = null;
let cited: CitedInput | null = null;

/** The site view's pasted input, or null when nothing was pasted on this page. */
export const getPastedSite = (): SiteInput | null => site;

export function setPastedSite(input: SiteInput): void {
  site = input;
}

/** The cited view's pasted answers and site, or null when nothing was pasted on this page. */
export const getPastedCited = (): CitedInput | null => cited;

export function setPastedCited(input: CitedInput): void {
  cited = input;
}

/**
 * Puts `question` in a box of Who gets cited ("Ask an AI" on Your questions), so the answer can
 * be pasted next to it: into the last box when it is empty, else a new box. Nothing changes when
 * a box already holds the question.
 */
export function addCitedQuestion(question: string): void {
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const current = cited ?? { entries: [], own: '' };
  if (current.entries.some((e) => key(e.question) === key(question))) return;
  const last = current.entries.at(-1);
  if (last && last.question.trim() === '' && last.answer.trim() === '') {
    cited = {
      ...current,
      entries: [...current.entries.slice(0, -1), { ...last, question }],
    };
    return;
  }
  const next = Math.max(-1, ...current.entries.map((e) => e.key)) + 1;
  cited = { ...current, entries: [...current.entries, { key: next, question, answer: '' }] };
}

/** Forgets both, so the views fall back to the stored summary (or to the example). */
export function clearPasted(): void {
  site = null;
  cited = null;
}

onClearAll(clearPasted);
