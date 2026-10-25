// The working screens just get the job done: no study names, no effect sizes, intervals, p values
// or n, no test names (E1, E2, E3), no grade words and no "our test found" sentences. All of that
// lives on /research. Each view is rendered on the real engine with its example loaded and every
// group, section, details and popover it has opened, so text behind a click is checked too.
import {
  EVIDENCE,
  OFFPAGE_ADVICE,
  READINESS_EVIDENCE,
  type SourceRef,
} from '@citation-equity/engine';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CitedPage from '@/app/cited/page';
import SitePage from '@/app/site/page';
import { DraftView } from '@/components/draft/draft-view';
import { Home } from '@/components/home/home';
import { resetLanding } from '@/components/home/landing';
import { AppShell } from '@/components/shell/app-shell';
import { runExample } from '@/lib/examples';
import { clearPasted } from '@/lib/pasted';
import { SAMPLES } from '@/lib/samples';
import { clearAll, setActiveSlot } from '@/lib/store';

const path = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => path.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// CodeMirror needs layout that jsdom lacks; the stand-in holds the draft, which is not checked.
vi.mock('@/components/editor/markdown-editor', async () => {
  const { forwardRef } = await import('react');
  return {
    MarkdownEditor: forwardRef<unknown, { value: string; ariaLabel: string }>(function FakeEditor({
      value,
      ariaLabel,
    }) {
      return <textarea aria-label={ariaLabel} value={value} readOnly />;
    }),
  };
});

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

/** The text on screen, and the chips' tooltips. */
function screenText(): { text: string; titles: string[] } {
  const titles = [...document.querySelectorAll<HTMLElement>('[title]')]
    .filter((el) => /^(Helps|Not scored)$/.test(el.textContent ?? ''))
    .map((el) => el.title);
  return { text: document.body.textContent ?? '', titles };
}

function expectQuiet(where: string) {
  const { text, titles } = screenText();
  for (const [pattern, why] of BANNED) {
    expect(pattern.test(text), `${where}: ${why} in "${text.match(pattern)?.[0]}"`).toBe(false);
  }
  // A chip's tooltip is one plain sentence, without numbers, test names or studies.
  for (const title of titles) {
    expect(title.split(/(?<=\.)\s+/), where).toHaveLength(1);
    expect(title, where).not.toMatch(/\d|\bE[123]\b|\bCI\b|Holm|\bGEO\b/);
  }
}

function shell(children: ReactNode) {
  return render(<AppShell>{children}</AppShell>);
}

/** Opens every closed group, rail section, details element and the score card's popovers. */
async function openEverything() {
  const groups = within(screen.getByRole('region', { name: 'All fixes' }));
  for (const toggle of groups.getAllByRole('button', { expanded: false })) fireEvent.click(toggle);
  for (const name of [/^Reader questions/, /^All \d+ checks/, /^Test it/]) {
    const toggle = screen.getByRole('button', { name });
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Adjust weights' }));
  for (const d of document.querySelectorAll('details')) d.open = true;
}

beforeEach(() => {
  window.localStorage.clear();
  clearAll();
  clearPasted();
  resetLanding();
});
afterEach(() => {
  cleanup();
  clearAll();
  clearPasted();
});

describe('the study-name list', () => {
  it('comes from the evidence registries and names the draft checks’ studies', () => {
    for (const name of ['Aggarwal', 'Puerto', 'Vishwakarma', 'C-SEO Bench', 'What Gets Cited']) {
      expect(STUDY_NAMES, name).toContain(name);
    }
    expect(STUDY_NAMES).not.toContain('Google Search Central');
  });
});

describe('the working screens say nothing about the evidence', () => {
  for (const sample of SAMPLES) {
    it(`the draft view, everything open, on the ${sample.slug} example`, async () => {
      path.current = '/draft/';
      setActiveSlot(sample.slug);
      shell(<DraftView />);
      expect(screen.getByRole('region', { name: 'Start here' })).toBeTruthy();
      await openEverything();
      expectQuiet(`draft (${sample.slug})`);
      // The score card's Why and the Scoring popover, one at a time.
      fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
      expect(await screen.findByRole('link', { name: 'How we tested this' })).toBeTruthy();
      expectQuiet(`draft (${sample.slug}), Why`);
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      fireEvent.click(screen.getByRole('button', { name: 'Scoring' }));
      await screen.findByRole('button', { name: /^Standard · / });
      expectQuiet(`draft (${sample.slug}), Scoring`);
    });
  }

  it('the home, with the example tried', () => {
    path.current = '/';
    act(() => runExample());
    shell(<Home />);
    expectQuiet('home');
  });

  it('Your site, on the example page, every row open', () => {
    path.current = '/site/';
    act(() => runExample());
    shell(<SitePage />);
    expect(screen.getAllByText('Why it matters').length).toBeGreaterThan(0);
    for (const d of document.querySelectorAll('details')) d.open = true;
    expectQuiet('site');
  });

  it('Who gets cited, on the example answers', () => {
    path.current = '/cited/';
    act(() => runExample());
    shell(<CitedPage />);
    expect(screen.getAllByRole('link', { name: /^Learn more/ }).length).toBeGreaterThan(0);
    expectQuiet('cited');
  });

  it('the About dialog', async () => {
    path.current = '/';
    shell(<main />);
    fireEvent.click(within(screen.getByRole('contentinfo')).getByRole('button', { name: 'About' }));
    await screen.findByRole('dialog', { name: 'About' });
    expectQuiet('about');
  });
});
