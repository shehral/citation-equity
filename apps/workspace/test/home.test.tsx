import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Home } from '@/components/home/home';
import { resetLanding } from '@/components/home/landing';
import { selectDraftSlot } from '@/lib/draft-summary';
import { EXAMPLE_SLUG } from '@/lib/examples';
import { MY_DRAFT_SLUG } from '@/lib/samples';
import { loadQuestions, saveDraft, saveQuestions } from '@/lib/storage';
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
  covered: 1,
  total: 4,
  fromPage: false,
  example: false,
  at: AT,
};
const SITE: SiteSummary = {
  blockers: ['crawler-access'],
  checks: [],
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
/** The espresso example's four questions, in its pack's order. */
const EXAMPLE_QUESTIONS = [
  'Why does my espresso taste bitter?',
  'How do I fix bitter espresso?',
  'What water temperature should I use for espresso?',
  'How long should an espresso shot take?',
];
const MY_TEXT = '# Espresso notes\n\nSome notes on pulling espresso at home.\n';

/** A link's route. Under Vitest next/link drops the trailing slash that the static build keeps. */
const route = (a: Element) => (a.getAttribute('href') ?? '').replace(/(.)\/(#|$)/, '$1$2');
const card = (name: string) =>
  within(screen.getByRole('region', { name: 'Next steps' })).getByRole('region', { name });
const banner = () => screen.queryByRole('region', { name: 'Blocker' });
const box = () => screen.getByRole('textbox', { name: "Your readers' questions" });
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const list = () => screen.getByRole('list', { name: 'Your questions, ranked' });
const rows = () =>
  within(list())
    .getAllByRole('listitem')
    .filter((li) => li.parentElement === list());
const texts = () => rows().map((li) => li.querySelector('[data-question]')?.textContent);
const tick = (text: string) => screen.getByRole('checkbox', { name: text }) as HTMLInputElement;
const ticked = () => rows().map((li) => (li.querySelector('input') as HTMLInputElement).checked);
const strip = () => screen.queryByText('This is the example.');
const tryIt = () => screen.queryByRole('button', { name: 'Try it with an example' });

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
  it('asks what readers will ask, offers the example and shows three steps not checked', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'What will your readers ask?',
    );
    expect(
      screen.getByText(
        'Start from their questions. Then check your draft answers them and AI search can reach it.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Try it with an example' })).toHaveLength(1);
    expect(screen.getByText('or type your own below')).toBeTruthy();
    expect(strip()).toBeNull();
    expect(banner()).toBeNull();
    for (const name of ['Your draft', 'Your site', 'Results']) {
      expect(within(card(name)).getByText('Not checked')).toBeTruthy();
    }
    expect(screen.getByText('No questions yet. Type one above, or try the example.')).toBeTruthy();
    // No score, no tiles out of 100 and no Next up.
    expect(document.body.textContent).not.toMatch(/Next up|\/ 100|score|GEO|—/i);
  });

  it('puts the input card, then the step cards, then the list (the phone order)', () => {
    render(<Home />);
    const order = [
      screen.getByRole('heading', { level: 1 }),
      screen.getByRole('region', { name: "Your readers' questions" }),
      screen.getByRole('region', { name: 'Next steps' }),
      screen.getByRole('heading', { name: 'Your questions' }),
    ];
    for (const [a, b] of order.slice(0, -1).map((el, i) => [el, order[i + 1]] as const)) {
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('keeps the step cards beside the list from lg, scrolling inside the column when it is taller than the screen', () => {
    render(<Home />);
    const column = screen.getByRole('region', { name: 'Next steps' }).parentElement as HTMLElement;
    for (const cls of [
      'lg:sticky',
      'lg:top-20',
      'lg:max-h-[calc(100dvh-6rem)]',
      'lg:overflow-y-auto',
    ])
      expect(column.classList.contains(cls), cls).toBe(true);
    // Sticky on every screen height: the column scrolls instead of being cut off.
    expect(column.className).not.toMatch(/min-height/);
    // The scroll box clips at its padding, so the cards' focus ring keeps room inside it.
    for (const cls of ['lg:p-1', 'lg:-m-1']) expect(column.classList.contains(cls), cls).toBe(true);
  });

  it('hides Try it once a question is typed', () => {
    render(<Home />);
    type('Why does my espresso taste bitter?');
    expect(tryIt()).toBeNull();
    expect(screen.queryByText('or type your own below')).toBeNull();
  });

  it('does not redirect when there is no last view', () => {
    render(<Home />);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe('Try it with an example', () => {
  it('opens the example: the strip, the banner, three Example cards and its questions ticked', async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Try it with an example' }));

    expect(getActiveSlot()).toBe(EXAMPLE_SLUG);
    expect(nav.push).not.toHaveBeenCalled();
    expect(tryIt()).toBeNull();
    // The H1 stays, and takes the focus from the button that went away.
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('What will your readers ask?');
    expect(document.activeElement).toBe(h1);
    expect(screen.getByText('Example loaded.').getAttribute('role')).toBe('status');
    expect(strip()?.parentElement?.textContent).toBe(
      'This is the example. Type your own questions to replace it.',
    );
    expect(screen.getByRole('button', { name: 'Start fresh' })).toBeTruthy();

    const b = within(banner() as HTMLElement);
    expect(b.getByText('A blocker on the example page')).toBeTruthy();
    expect(b.getByText('Its robots.txt blocks a crawler AI search needs.')).toBeTruthy();
    expect(route(b.getByRole('link', { name: 'See blockers' }))).toBe('/site#first-issue');

    for (const name of ['Your draft', 'Your site', 'Results']) {
      expect(within(card(name)).getByText('Example')).toBeTruthy();
    }
    expect(card('Your draft').textContent).toContain('0 of 4 covered');
    expect(within(card('Your draft')).getByText('Needs attention')).toBeTruthy();
    expect(within(card('Your site')).getByText('1 blocker')).toBeTruthy();
    expect(within(card('Your site')).getByText('AI crawlers allowed')).toBeTruthy();
    expect(card('Results').textContent).toContain('1 of 3 live answers cite you');

    // The box is empty, so the list is the example draft's own questions, each ticked.
    expect(texts()).toEqual(EXAMPLE_QUESTIONS);
    expect(ticked()).toEqual([true, true, true, true]);
    for (const li of rows()) expect(within(li).getByText('Example')).toBeTruthy();
    expect(
      screen.getByText(
        '4 questions, in your order. Tick the ones this draft should answer, up to 8.',
      ),
    ).toBeTruthy();
  });

  it('Start fresh selects My post and forgets the example on the home, staying there', async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Try it with an example' }));
    // A result of the visitor's own, pasted after the example, stays.
    act(() => setSummary('cited', CITED));
    await userEvent.click(screen.getByRole('button', { name: 'Start fresh' }));

    expect(getActiveSlot()).toBe(MY_POST_SLOT);
    expect(nav.push).not.toHaveBeenCalled();
    expect(getSummary('draft')).toBeNull();
    expect(getSummary('site')).toBeNull();
    expect(getSummary('cited')).toEqual(CITED);
    expect(strip()).toBeNull();
    expect(banner()).toBeNull();
    expect(screen.queryByText('Example')).toBeNull();
    expect(within(card('Your draft')).getByText('Not checked')).toBeTruthy();
    expect(within(card('Your site')).getByText('Not checked')).toBeTruthy();
    expect(card('Results').textContent).toContain('1 of 3 live answers cite you');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    // My post has no questions yet.
    expect(screen.getByText('No questions yet. Type one above.')).toBeTruthy();
  });

  it('typing while the example is open starts fresh first, so the example keeps its questions', async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Try it with an example' }));
    type('Why do my shots run fast?\nespresso shot time, 1900');

    expect(getActiveSlot()).toBe(MY_POST_SLOT);
    expect(strip()).toBeNull();
    expect(screen.queryByText('Example')).toBeNull();
    expect(getSummary('site')).toBeNull();
    expect(getSummary('cited')).toBeNull();
    // The typed questions list unticked; the example's own list was never touched.
    expect(texts()).toEqual(['espresso shot time', 'Why do my shots run fast?']);
    expect(ticked()).toEqual([false, false]);
    expect(loadQuestions(EXAMPLE_SLUG)).toBeNull();

    fireEvent.click(tick('Why do my shots run fast?'));
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([
      { text: 'Why do my shots run fast?', source: 'keywords', template: 'as-written' },
    ]);
    expect(loadQuestions(EXAMPLE_SLUG)).toBeNull();
  });

  it('importing while the example is open starts fresh first too', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await user.click(screen.getByRole('button', { name: 'Try it with an example' }));
    const file = new File(
      ['Top queries,Clicks,Impressions,CTR,Position\nespresso grind size,12,2310,0.52%,11.2'],
      'Queries.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByLabelText('Import CSV'), file);
    await screen.findByText('Imported 1 query from Queries.csv.');
    expect(getActiveSlot()).toBe(MY_POST_SLOT);
    expect(strip()).toBeNull();
    expect(texts()).toEqual(['espresso grind size']);
  });

  it("ticking a typed question while the example is open starts fresh first, so it never joins the example's list", () => {
    render(<Home />);
    type('Why do my shots run fast?\nHow do I fix bitter espresso?');
    // The example opened from More > Examples, with the visitor's questions still in the box.
    act(() => selectDraftSlot(EXAMPLE_SLUG));
    expect(strip()).not.toBeNull();
    // On the example's list already, so ticked.
    expect(ticked()).toEqual([false, true]);

    fireEvent.click(tick('Why do my shots run fast?'));
    expect(getActiveSlot()).toBe(MY_POST_SLOT);
    expect(strip()).toBeNull();
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([
      { text: 'Why do my shots run fast?', source: 'keywords', template: 'as-written' },
    ]);
    expect(loadQuestions(EXAMPLE_SLUG)).toBeNull();
    expect(ticked()).toEqual([true, false]);

    // Unticking one on the example's list starts fresh too, and leaves that list as it was.
    act(() => selectDraftSlot(EXAMPLE_SLUG));
    fireEvent.click(tick('How do I fix bitter espresso?'));
    expect(getActiveSlot()).toBe(MY_POST_SLOT);
    expect(loadQuestions(EXAMPLE_SLUG)).toBeNull();
    expect(tick('How do I fix bitter espresso?').checked).toBe(false);
  });

  it('works with browser storage blocked: the example, typing and ticks last for this page', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Try it with an example' }));
    expect(within(card('Your draft')).getByText('Example')).toBeTruthy();
    expect(card('Your draft').textContent).toContain('0 of 4 covered');
    expect(card('Your site').textContent).toContain('1 blocker');
    expect(card('Results').textContent).toContain('1 of 3 live answers cite you');
    expect(ticked()).toEqual([true, true, true, true]);

    type('Why do my shots run fast?');
    expect(getActiveSlot()).toBe(MY_POST_SLOT);
    fireEvent.click(tick('Why do my shots run fast?'));
    expect(tick('Why do my shots run fast?').checked).toBe(true);
    expect(loadQuestions(MY_DRAFT_SLUG)).toHaveLength(1);
  });
});

describe('ticks and the draft card', () => {
  it('ticking adds to the open draft and unticking removes, with the draft card following', () => {
    saveDraft(MY_DRAFT_SLUG, MY_TEXT);
    render(<Home />);
    type('Why does my espresso taste bitter?\nHow do I fix bitter espresso?');
    expect(ticked()).toEqual([false, false]);

    fireEvent.click(tick('How do I fix bitter espresso?'));
    expect(ticked()).toEqual([false, true]);
    expect(getSummary('draft')).toMatchObject({ slot: MY_POST_SLOT, total: 1, fromPage: false });
    expect(card('Your draft').textContent).toMatch(/\d of 1 covered/);

    fireEvent.click(tick('Why does my espresso taste bitter?'));
    expect(card('Your draft').textContent).toMatch(/\d of 2 covered/);

    fireEvent.click(tick('How do I fix bitter espresso?'));
    expect(ticked()).toEqual([true, false]);
    expect(loadQuestions(MY_DRAFT_SLUG)?.map((q) => q.text)).toEqual([
      'Why does my espresso taste bitter?',
    ]);
    expect(card('Your draft').textContent).toMatch(/\d of 1 covered/);
  });

  it('a full draft says so under the question, and its box stays unticked', () => {
    saveQuestions(
      MY_DRAFT_SLUG,
      Array.from({ length: 8 }, (_, i) => ({
        text: `Question ${i + 1}?`,
        source: 'user' as const,
      })),
    );
    render(<Home />);
    type('Why does my espresso taste bitter?');
    fireEvent.click(tick('Why does my espresso taste bitter?'));
    expect(tick('Why does my espresso taste bitter?').checked).toBe(false);
    expect(screen.getByText('A draft holds 8 questions. Untick one first.')).toBeTruthy();
    expect(loadQuestions(MY_DRAFT_SLUG)).toHaveLength(8);
  });
});

describe('the list from the open draft', () => {
  it("shows a draft's own questions, ticked, while the box is empty", () => {
    saveQuestions(MY_DRAFT_SLUG, [
      { text: 'Why do my shots run fast?', source: 'user' },
      { text: 'Is a darker roast more bitter?', source: 'user' },
    ]);
    render(<Home />);
    expect(texts()).toEqual(['Why do my shots run fast?', 'Is a darker roast more bitter?']);
    expect(ticked()).toEqual([true, true]);
    expect(screen.queryByText('Example')).toBeNull();
  });

  it('keeps an unticked row in place, unticked, until the box changes', () => {
    saveDraft(MY_DRAFT_SLUG, MY_TEXT);
    saveQuestions(MY_DRAFT_SLUG, [
      { text: 'Why do my shots run fast?', source: 'user' },
      { text: 'Is a darker roast more bitter?', source: 'user' },
    ]);
    render(<Home />);
    fireEvent.click(tick('Why do my shots run fast?'));
    expect(texts()).toEqual(['Why do my shots run fast?', 'Is a darker roast more bitter?']);
    expect(ticked()).toEqual([false, true]);
    expect(loadQuestions(MY_DRAFT_SLUG)?.map((q) => q.text)).toEqual([
      'Is a darker roast more bitter?',
    ]);
    expect(getSummary('draft')).toMatchObject({ total: 1 });

    // Ticking it again puts it back.
    fireEvent.click(tick('Why do my shots run fast?'));
    expect(ticked()).toEqual([true, true]);
    fireEvent.click(tick('Why do my shots run fast?'));

    // Typing replaces the list with the box's own; emptying the box shows the draft's again.
    type('espresso bitter');
    expect(texts()).toEqual(['espresso bitter']);
    type('');
    expect(texts()).toEqual(['Is a darker roast more bitter?']);
  });

  it("keeps the example's unticked row too, and the draft card follows", async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Try it with an example' }));
    fireEvent.click(tick('How do I fix bitter espresso?'));
    expect(texts()).toEqual(EXAMPLE_QUESTIONS);
    expect(ticked()).toEqual([true, false, true, true]);
    expect(card('Your draft').textContent).toContain('0 of 3 covered');
  });
});

describe('the banner and the step cards', () => {
  it('names two blockers on your own page, and links to the first', () => {
    setSummary('site', { ...SITE, blockers: ['crawler-access', 'indexing-directives'] });
    render(<Home />);
    const b = within(banner() as HTMLElement);
    expect(b.getByText('2 blockers on your page')).toBeTruthy();
    expect(route(b.getByRole('link', { name: 'See blockers' }))).toBe('/site#first-issue');
    expect(within(card('Your site')).getByText('2 blockers')).toBeTruthy();
  });

  it('shows no banner when the site check found no blocker', () => {
    setSummary('site', { ...SITE, blockers: [], checks: ['renders-without-js'] });
    render(<Home />);
    expect(banner()).toBeNull();
    expect(within(card('Your site')).getByText('No blockers found')).toBeTruthy();
    expect(within(card('Your site')).getByText('Checked')).toBeTruthy();
  });

  it('fills the cards from the stored summaries, without Try it or the strip', () => {
    setSummary('draft', DRAFT);
    setSummary('site', SITE);
    setSummary('cited', CITED);
    render(<Home />);
    expect(tryIt()).toBeNull();
    expect(strip()).toBeNull();
    expect(screen.getByText('No questions yet. Type one above.')).toBeTruthy();
    expect(card('Your draft').textContent).toContain('1 of 4 covered');
    expect(route(within(card('Your draft')).getByRole('link', { name: /^Open draft/ }))).toBe(
      '/draft#start-here',
    );
    expect(within(card('Your site')).getByText('1 blocker')).toBeTruthy();
    expect(within(card('Your site')).getByText('1 more needs your live site')).toBeTruthy();
    expect(card('Results').textContent).toContain('1 of 3 live answers cite you');
    expect(within(banner() as HTMLElement).getByText('A blocker on your page')).toBeTruthy();
  });

  it('updates when a summary changes while the home is open', () => {
    render(<Home />);
    act(() => setSummary('site', SITE));
    expect(card('Your site').textContent).toContain('1 blocker');
    expect(banner()).toBeTruthy();
  });
});

describe('landing', () => {
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

  it("stays on the home when an older build's last view was Your questions", () => {
    window.localStorage.setItem('ce:v1:last-view', 'questions');
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

  it('keeps a visit that started at /questions/ on the home', () => {
    setLastView('draft');
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { name: 'http://localhost:3000/questions/' } as PerformanceEntry,
    ]);
    render(<Home />);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
