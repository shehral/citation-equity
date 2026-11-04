// The working screens just get the job done: no study names, no effect sizes, intervals, p values
// or n, no test names (E1, E2, E3), no grade words and no "our test found" sentences. All of that
// lives on /research. The one exception is the label chip: a fixed short phrase saying what our
// tests found, with a one-sentence tooltip and no number. Its phrases may appear only inside a
// chip. Each screen's test file (quiet-*.test.tsx) renders its view on the real engine with its
// example loaded and everything it has opened, so text behind a click is checked too.
import {
  EVIDENCE,
  OFFPAGE_ADVICE,
  READINESS_EVIDENCE,
  type SourceRef,
  TEST_LABEL_TEXT,
} from '@citation-equity/engine';
import { fireEvent, screen, within } from '@testing-library/react';
import { expect } from 'vitest';
import { resetLanding } from '@/components/home/landing';
import { clearPasted } from '@/lib/pasted';
import { clearAll } from '@/lib/store';

/** Every source in the evidence registries: the draft checks, Your site and Who gets cited. */
const SOURCES: SourceRef[] = [
  ...Object.values(EVIDENCE).flatMap((e) => e.sources),
  ...Object.values(READINESS_EVIDENCE).flatMap((e) => e.sources),
  ...Object.values(OFFPAGE_ADVICE).flatMap((a) => a.evidence.sources),
];

/**
 * The study names the registries cite: each authored work's first author ("Aggarwal, P., ...")
 * and its short title (before the colon, else the whole title), plus the names the engine's
 * prose uses for two of them. Documentation pages (Google Search Central, a help center) have no
 * author and are not studies.
 */
export const STUDY_NAMES: string[] = (() => {
  const names = new Set<string>(['ConflictingQA', 'AutoGEO']);
  for (const { citation } of SOURCES) {
    const author = /^([\p{Lu}][\p{L}'-]+), [\p{Lu}]\./u.exec(citation)?.[1];
    if (!author) continue;
    names.add(author);
    const title = /\(\d{4}\)\. ([^.?]+?)(?::|\?|\.)/.exec(citation)?.[1]?.trim();
    if (title) names.add(title);
  }
  return [...names];
})();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What no working screen may say, each with the reason it is listed. */
const BANNED: [RegExp, string][] = [
  [/\bE[123]\b/, 'a test name'],
  [/95%/, 'an interval level'],
  [/\bCI\b/, 'an interval'],
  [/Holm/, 'a corrected p value'],
  [/\bp = /, 'a p value'],
  [/(^|[\s(])n \d/, 'a sample size'],
  [/\b(strong|moderate|mixed|untested) evidence\b/i, 'a grade word'],
  [/\bUntested\b/, 'a grade word'],
  [/\bour (own )?tests? (found|measured)\b/i, 'an "our test found" sentence'],
  [/\bGEO\b/, '"GEO"'],
  [/—/, 'an em dash'],
  [new RegExp(['contra', 'dicted'].join(''), 'i'), 'the retired grade word'],
  ...STUDY_NAMES.map((name): [RegExp, string] => [
    new RegExp(`\\b${escapeRegExp(name)}\\b`),
    `the study name "${name}"`,
  ]),
];

/** The label phrases, as the engine words them: allowed on a working screen only inside a chip. */
export const LABEL_PHRASES: string[] = Object.values(TEST_LABEL_TEXT);

const LABEL_PATTERNS = LABEL_PHRASES.map(
  (phrase) => [phrase, new RegExp(`\\b${escapeRegExp(phrase)}\\b`)] as const,
);

/**
 * The text on screen; the same text with every label chip left out; each label chip's text; and
 * the chips' tooltips.
 */
export function screenText(root: HTMLElement = document.body): {
  text: string;
  outsideChips: string;
  chips: string[];
  titles: string[];
} {
  const labelChips = [...root.querySelectorAll<HTMLElement>('[data-label-chip]')];
  const titles = labelChips.map((el) => el.title).filter((t) => t !== '');
  const outside = root.cloneNode(true) as HTMLElement;
  // A space in each chip's place, so the words on either side never join into a phrase.
  for (const chip of outside.querySelectorAll('[data-label-chip]'))
    chip.replaceWith(outside.ownerDocument.createTextNode(' '));
  return {
    text: root.textContent ?? '',
    outsideChips: outside.textContent ?? '',
    chips: labelChips.map((el) => el.textContent ?? ''),
    titles,
  };
}

/** Fails when the screen under `root` says anything of the evidence beyond its label chips. */
export function expectQuiet(where: string, root: HTMLElement = document.body) {
  const { text, outsideChips, chips, titles } = screenText(root);
  for (const [pattern, why] of BANNED) {
    expect(pattern.test(text), `${where}: ${why} in "${text.match(pattern)?.[0]}"`).toBe(false);
  }
  // A label phrase is a chip's text, never a sentence's.
  for (const [phrase, pattern] of LABEL_PATTERNS) {
    expect(pattern.test(outsideChips), `${where}: the label "${phrase}" outside a chip`).toBe(
      false,
    );
  }
  for (const chip of chips)
    expect(LABEL_PHRASES, `${where}: a chip reads "${chip}"`).toContain(chip);
  // A chip's tooltip is one plain sentence, without numbers, test names or studies.
  for (const title of titles) {
    expect(title.split(/(?<=\.)\s+/), where).toHaveLength(1);
    expect(title, where).not.toMatch(/\d|\bE[123]\b|\bCI\b|Holm|\bGEO\b/);
  }
}

/**
 * Every "score" (also "scored", "scoring") in `text` outside "citation score", each with 40
 * characters either side; empty when there is none. The tool has no score, so on /research the
 * word means only the 0-to-1 citation score of our tests. The rule has no exceptions: text the
 * page quotes (the evidence registries, the check registry, docs/evidence.md) follows it too.
 */
export function strayScores(text: string): string[] {
  const rest = text.replace(/citation score/gi, '');
  return [...rest.matchAll(/.{0,40}scor.{0,40}/gis)].map((m) => m[0]);
}

/** Opens every details element under `root`, as a reader who opened them all would see it. */
export function openDetails(root: ParentNode = document) {
  for (const d of root.querySelectorAll('details')) d.open = true;
}

/**
 * Opens everything on the draft view: the question editor under the Questions covered card,
 * Writing notes, every note group and every details element, so text behind a click is read too.
 */
export function openDraftView() {
  const card = within(screen.getByRole('region', { name: /^Questions covered: / }));
  fireEvent.click(card.getByRole('button', { name: /^(Edit|Add) questions$/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Writing notes/ }));
  const notes = within(screen.getByRole('region', { name: 'Writing notes' }));
  for (const toggle of notes.getAllByRole('button', { expanded: false })) fireEvent.click(toggle);
  openDetails();
}

/** Empties storage, the stores, the pasted inputs and the landing rule between cases. */
export function resetScreens() {
  window.localStorage.clear();
  clearAll();
  clearPasted();
  resetLanding();
}
