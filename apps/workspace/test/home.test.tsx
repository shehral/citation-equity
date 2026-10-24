import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Home } from '@/components/home/home';
import { resetLanding } from '@/components/home/landing';
import { nextUp } from '@/components/home/next-up';
import { EXAMPLE_SLUG } from '@/lib/examples';
import {
  type CitedSummary,
  clearAll,
  type DraftSummary,
  getActiveSlot,
  getSummary,
  MY_POST_SLOT,
  type SiteSummary,
  setLastView,
  setSummary,
} from '@/lib/store';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn() }),
}));

const AT = '2026-10-24T10:00:00.000Z';
const DRAFT: DraftSummary = {
  slot: 'my-post',
  score: 41,
  baseline: { standard: 35, evidence: 37 },
  openStartHere: 2,
  example: false,
  at: AT,
};
const SITE: SiteSummary = {
  pass: 5,
  warn: 1,
  fail: 1,
  total: 7,
  needsLiveSite: 1,
  example: false,
  at: AT,
};
const CITED: CitedSummary = {
  answers: 3,
  citingYou: 1,
  site: 'example.com',
  topKinds: ['forum', 'wiki'],
  example: false,
  at: AT,
};

/** A link's route. Under Vitest next/link drops the trailing slash that the static build keeps. */
const route = (a: Element) => (a.getAttribute('href') ?? '').replace(/(.)\/(#|$)/, '$1$2');
const tile = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  window.localStorage.clear();
  clearAll();
  resetLanding();
  nav.push.mockReset();
  nav.replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('first visit', () => {
  it('shows the headline, one Try it button and three tiles marked Not checked', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'Get quoted by AI search.',
    );
    expect(screen.getAllByRole('button', { name: 'Try it with an example' })).toHaveLength(1);
    const tiles = [
      ['Your draft', 'Is my post easy for AI to quote?', 'Paste a post', '/draft'],
      ['Your site', 'Can AI read my published page?', 'Check a page', '/site'],
      ['Who gets cited', 'Who does AI cite for my questions?', 'Paste an answer', '/cited'],
    ];
    for (const [name, question, cta, href] of tiles) {
      const t = within(tile(name));
      expect(t.getByText(question)).toBeTruthy();
      expect(t.getByText('Not checked')).toBeTruthy();
      expect(route(t.getByRole('link', { name: new RegExp(`^${cta}`) }))).toBe(href);
    }
    // Next up appears only once something is checked; no combined score anywhere.
    expect(screen.queryByRole('region', { name: 'Next up' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/GEO|\u2014/);
  });

  it('does not redirect when there is no last view', () => {
    render(<Home />);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe('Try it with an example', () => {
  it('fills all three tiles with Example labels and honest statuses', async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Try it with an example' }));

    expect(getActiveSlot()).toBe(EXAMPLE_SLUG);
    expect(screen.queryByRole('button', { name: 'Try it with an example' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'Why does my espresso taste bitter?',
    );
    expect(screen.getByRole('status').textContent).toContain('Example loaded in all three checks.');
    for (const name of ['Your draft', 'Your site', 'Who gets cited']) {
      const t = within(tile(name));
      expect(t.getByText('Example')).toBeTruthy();
      expect(t.queryByText('Not checked')).toBeNull();
    }
    // The espresso example has open Start here fixes, a failing site row and 1 of 3 answers.
    const draft = within(tile('Your draft'));
    expect(draft.getByText('Needs attention')).toBeTruthy();
    expect(tile('Your draft').textContent).toMatch(/\d+ \/ 100/);
    expect(draft.getByText('Start with 3 quick wins')).toBeTruthy();
    const site = within(tile('Your site'));
    expect(site.getByText('Needs attention')).toBeTruthy();
    expect(tile('Your site').textContent).toContain('5 of 7 pass');
    expect(site.getByText('1 fail, 1 warning')).toBeTruthy();
    expect(site.getByText('1 more needs your live site')).toBeTruthy();
    const cited = within(tile('Who gets cited'));
    expect(cited.getByText('Checked')).toBeTruthy();
    expect(tile('Who gets cited').textContent).toContain('1 of 3 answers cite you');
    expect(cited.getByText('Most cited: Forums, Wikipedia')).toBeTruthy();
  });

  it('Use my own post switches the draft tile to My post at once, with no example left', async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Try it with an example' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use my own post' }));
    expect(getActiveSlot()).toBe(MY_POST_SLOT);
    expect(nav.push).toHaveBeenCalledWith('/draft/');
    // My post is empty, so there is nothing to score: the tile is not checked, not the example.
    const draft = within(tile('Your draft'));
    expect(draft.getByText('Not checked')).toBeTruthy();
    expect(draft.queryByText('Example')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain('espresso');
    expect(screen.queryByRole('button', { name: 'Use my own post' })).toBeNull();
  });

  it('Use my own post shows the saved post when there is one', async () => {
    window.localStorage.setItem(
      'ce:v1:draft:my-draft',
      '# My own post\n\nWhy does tea go bitter? Steeping too long pulls out tannins.\n',
    );
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Try it with an example' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use my own post' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My post');
    const draft = within(tile('Your draft'));
    expect(draft.queryByText('Example')).toBeNull();
    expect(tile('Your draft').textContent).toMatch(/\d+ \/ 100/);
    expect(getSummary('draft')).toMatchObject({ slot: MY_POST_SLOT, example: false });
  });

  it('works with browser storage blocked: the tiles fill for this page', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Try it with an example' }));
    expect(within(tile('Your draft')).getByText('Example')).toBeTruthy();
    expect(tile('Your site').textContent).toContain('5 of 7 pass');
    expect(tile('Who gets cited').textContent).toContain('1 of 3 answers cite you');
  });
});

describe('returning user', () => {
  it('shows stored summaries: +N since you started, Checked or Needs attention, Open links', () => {
    setSummary('draft', DRAFT);
    setSummary('site', { ...SITE, warn: 0, fail: 0, pass: 6 });
    setSummary('cited', { ...CITED, citingYou: 0 });
    render(<Home />);
    expect(screen.queryByRole('button', { name: 'Try it with an example' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('My post');
    const draft = within(tile('Your draft'));
    expect(draft.getByText('+6 since you started')).toBeTruthy();
    expect(draft.queryByText('Example')).toBeNull();
    expect(route(draft.getByRole('link', { name: /^Open draft/ }))).toBe('/draft');
    expect(within(tile('Your site')).getByText('Checked')).toBeTruthy();
    const cited = within(tile('Who gets cited'));
    expect(cited.getByText('Needs attention')).toBeTruthy();
    expect(cited.getByText('Not cited yet')).toBeTruthy();
  });

  it('asks for a site instead of saying "Not cited yet" when none was given', () => {
    const { site: _, ...noSite } = { ...CITED, citingYou: 0 };
    setSummary('cited', noSite);
    render(<Home />);
    const cited = tile('Who gets cited');
    expect(within(cited).getByText('Add your site to see if you are cited')).toBeTruthy();
    expect(cited.textContent).not.toContain('Not cited yet');
    expect(cited.textContent).not.toContain('cite you');
    expect(within(cited).getByText('Checked')).toBeTruthy();
  });

  it('asks for a few more answers when fewer than 3 are pasted', () => {
    setSummary('cited', { ...CITED, answers: 1, citingYou: 1 });
    render(<Home />);
    expect(within(tile('Who gets cited')).getByText('Paste a few more answers')).toBeTruthy();
  });

  it('shows no delta when the score has not moved since the first check', () => {
    setSummary('draft', { ...DRAFT, score: 35 });
    render(<Home />);
    expect(screen.queryByText(/since you started/)).toBeNull();
  });

  it('lands on the last view when it is set and not home', () => {
    setLastView('site');
    render(<Home />);
    expect(nav.replace).toHaveBeenCalledWith('/site/');
  });

  it('stays on the home when the last view is home', () => {
    setLastView('home');
    render(<Home />);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('only redirects on landing: coming back to the home later in the visit stays there', () => {
    setLastView('draft');
    const first = render(<Home />);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    first.unmount();
    render(<Home />);
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it('updates when a summary changes while the home is open', () => {
    render(<Home />);
    act(() => setSummary('site', SITE));
    expect(tile('Your site').textContent).toContain('5 of 7 pass');
  });
});

describe('Next up', () => {
  it('deep-links to the Start here fixes while any is open', () => {
    setSummary('draft', DRAFT);
    setSummary('site', SITE);
    render(<Home />);
    const strip = within(screen.getByRole('region', { name: 'Next up' }));
    expect(strip.getByText('Start with 2 quick wins')).toBeTruthy();
    expect(route(strip.getByRole('link', { name: 'Open' }))).toBe('/draft#start-here');
  });

  it('picks one action: open fixes, then a failing site row, then a few more answers', () => {
    const done = { ...DRAFT, openStartHere: 0 };
    expect(nextUp({ draft: DRAFT, site: SITE, cited: CITED })?.href).toBe('/draft/#start-here');
    expect(nextUp({ draft: done, site: SITE, cited: CITED })?.href).toBe('/site/#first-issue');
    const clean = { ...SITE, fail: 0, warn: 1, pass: 6 };
    expect(nextUp({ draft: done, site: clean, cited: { ...CITED, answers: 2 } })).toMatchObject({
      title: 'Paste a few more answers',
      href: '/cited/',
    });
    expect(nextUp({ draft: done, site: clean, cited: null })?.href).toBe('/cited/');
    expect(nextUp({ draft: done, site: clean, cited: CITED })).toBeNull();
    expect(nextUp({ draft: null, site: null, cited: null })).toBeNull();
  });

  it('never calls the example\'s page or draft "your"', () => {
    const done = { ...DRAFT, openStartHere: 0, example: true };
    const site = nextUp({ draft: done, site: { ...SITE, example: true }, cited: CITED });
    expect(site?.detail).toBe('1 check fails on the example page.');
    expect(`${site?.title} ${site?.detail}`).not.toMatch(/\byour\b/i);
    expect(nextUp({ draft: { ...DRAFT, example: true }, site: null, cited: null })?.detail).toBe(
      "The example's top fixes, one at a time.",
    );
    expect(nextUp({ draft: { ...done, example: false }, site: SITE, cited: CITED })?.detail).toBe(
      `${SITE.fail} ${SITE.fail === 1 ? 'check fails' : 'checks fail'} on your page.`,
    );
  });
});
