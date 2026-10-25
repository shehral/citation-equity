import { OFFPAGE_ADVICE, SOURCE_KINDS } from '@citation-equity/engine';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CitedPage from '@/app/cited/page';
import { citedReport, citedSummary } from '@/components/cited/tally';
import { EXAMPLE_ANSWERS, EXAMPLE_SITE, runExample } from '@/lib/examples';
import { clearPasted } from '@/lib/pasted';
import { clearAll, getSummary, setSummary } from '@/lib/store';

const EM_DASH = '—';
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

beforeEach(() => clearAll());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PERPLEXITY = `Espresso tastes bitter when it over-extracts [1][2].

Sources
1. https://www.reddit.com/r/espresso/comments/abc/bitter/
2. [Espresso](https://en.wikipedia.org/wiki/Espresso_(drink))
3. https://www.example.com/espresso`;

/** One link of each of the nine kinds. */
const NINE_KINDS = [
  'https://reddit.com',
  'https://wikipedia.org',
  'https://youtube.com',
  'https://g2.com',
  'https://reuters.com',
  'https://nih.gov',
  'https://linkedin.com',
  'https://amazon.com',
  'https://blog.example.org',
].join(' ');

const answerBox = (n: number) =>
  screen.getByLabelText(`The answer, with its links (question ${n})`);
const paste = (n: number, value: string) => fireEvent.change(answerBox(n), { target: { value } });
const results = () => screen.getByRole('region', { name: 'Who gets cited' });
/** The result groups, in page order, by their accessible names. */
const groupNames = () =>
  within(results())
    .queryAllByRole('region')
    .map((r) => r.getAttribute('aria-label') ?? '');

describe('/cited', () => {
  it('shows three numbered steps and a plain empty state before anything is pasted', () => {
    render(<CitedPage />);
    const steps = screen.getByRole('list', { name: 'How it works' });
    expect(steps.tagName).toBe('OL');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    expect(results().textContent).toContain('Paste an answer above to see which sites it cites.');
    expect(groupNames()).toEqual([]);
    expect(getSummary('cited')).toBeNull();
  });

  it("puts the user's own site first, then the other sites grouped by kind", () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<CitedPage />);
    fireEvent.change(screen.getByLabelText('Question 1'), {
      target: { value: 'Why does espresso taste bitter?' },
    });
    paste(1, PERPLEXITY);
    fireEvent.change(screen.getByLabelText('Your site'), { target: { value: 'example.com' } });

    expect(groupNames()).toEqual([
      'Your site',
      OFFPAGE_ADVICE.forum.title,
      OFFPAGE_ADVICE.wiki.title,
    ]);
    const own = within(results()).getByRole('region', { name: 'Your site' });
    expect(within(own).getByRole('row', { name: /example\.com/ }).textContent).toContain('1 of 1');
    const forums = within(results()).getByRole('region', { name: OFFPAGE_ADVICE.forum.title });
    const row = within(forums).getByRole('row', { name: /reddit\.com/ });
    expect(row.textContent).toContain('1 of 1');
    expect(row.textContent).toContain('Why does espresso taste bitter?');
    // The own site is counted apart, never among the other sites.
    expect(within(forums).queryByRole('row', { name: /example\.com/ })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('counts answers, not links, and says how often the own site is cited', () => {
    render(<CitedPage />);
    fireEvent.change(screen.getByLabelText('Your site'), { target: { value: 'example.com' } });
    paste(1, PERPLEXITY);
    expect(results().textContent).toContain('Your site: cited in 1 of 1 answers.');
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    paste(2, 'See https://reddit.com/r/x and https://old.reddit.com/r/y');
    expect(results().textContent).toContain('Your site: cited in 1 of 2 answers.');
    const forums = within(results()).getByRole('region', { name: OFFPAGE_ADVICE.forum.title });
    expect(within(forums).getByRole('row', { name: /reddit\.com/ }).textContent).toContain(
      '2 of 2',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove question 2' }));
    expect(screen.queryByLabelText('The answer, with its links (question 2)')).toBeNull();
    expect(results().textContent).toContain('Your site: cited in 1 of 1 answers.');
  });

  it('asks for your site when none is given', () => {
    render(<CitedPage />);
    paste(1, PERPLEXITY);
    expect(results().textContent).toContain('Add your site above to see if it is cited.');
    expect(groupNames()[0]).toBe(OFFPAGE_ADVICE.forum.title);
  });

  it('says "Paste a few more answers" while fewer than 3 answers are pasted', () => {
    render(<CitedPage />);
    paste(1, PERPLEXITY);
    expect(results().textContent).toContain('Paste a few more answers.');
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    paste(2, 'https://reddit.com/r/x');
    expect(results().textContent).toContain('Paste a few more answers.');
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    paste(3, 'https://youtube.com/watch?v=1');
    expect(results().textContent).not.toContain('Paste a few more answers.');
  });

  it('gives each kind one Do line and one Avoid line, and Learn more links its Research section', () => {
    render(<CitedPage />);
    paste(1, PERPLEXITY);
    for (const kind of ['forum', 'wiki'] as const) {
      const card = OFFPAGE_ADVICE[kind];
      const group = within(results()).getByRole('region', { name: card.title });
      expect(within(group).getByText(card.short.do)).toBeTruthy();
      expect(within(group).getByText(card.short.avoid)).toBeTruthy();
      // The studies and the grade live on /research, not here.
      expect(group.querySelector('details')).toBeNull();
      expect(group.textContent).not.toMatch(/evidence|Untested/i);
      for (const s of card.evidence.sources) expect(group.textContent).not.toContain(s.citation);
      const more = within(group).getByRole('link', { name: `Learn more: ${card.title}` });
      expect(more.getAttribute('href')).toMatch(new RegExp(`/research/?#offpage-${kind}$`));
    }
    expect(
      within(results()).queryByRole('region', { name: OFFPAGE_ADVICE.commerce.title }),
    ).toBeNull();
  });

  it('stores a CitedSummary of what was pasted', () => {
    render(<CitedPage />);
    fireEvent.change(screen.getByLabelText('Your site'), { target: { value: 'example.com' } });
    paste(1, PERPLEXITY);
    expect(getSummary('cited')).toMatchObject({
      answers: 1,
      citingYou: 1,
      topKinds: ['forum', 'wiki'],
      example: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    paste(2, 'https://youtube.com/watch?v=1');
    expect(getSummary('cited')).toMatchObject({
      answers: 2,
      citingYou: 1,
      topKinds: ['forum', 'wiki', 'video'],
    });
  });

  it('shows a stored summary with "Paste again to see details" when nothing is in memory', () => {
    setSummary('cited', {
      answers: 3,
      citingYou: 1,
      site: 'example.com',
      topKinds: ['forum'],
      example: false,
      at: '2026-10-24T00:00:00.000Z',
    });
    render(<CitedPage />);
    const text = results().textContent ?? '';
    expect(text).toContain('Your site: cited in 1 of 3 answers.');
    expect(text).toContain('Paste again to see details');
    expect(text).not.toContain('Example');
    expect(text).not.toContain('Paste an answer above');
  });

  it("shows the example's answers and groups while the stored summary is the example's", () => {
    runExample();
    render(<CitedPage />);
    const text = results().textContent ?? '';
    expect(text).toContain('Your site: cited in 1 of 3 answers.');
    expect(text).toContain('Example');
    expect(text).not.toContain('Paste again to see details');
    expect(groupNames()[0]).toBe('Your site');
    expect(groupNames()).toContain(OFFPAGE_ADVICE.forum.title);
    expect((answerBox(1) as HTMLTextAreaElement).value).toBe(EXAMPLE_ANSWERS[0]?.answer);
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Your site' }).value).toBe(
      EXAMPLE_SITE,
    );
    // Re-derived, never stored: the summary stays the example's, and nothing else is written.
    expect(getSummary('cited')?.example).toBe(true);
    expect(JSON.stringify(window.localStorage)).not.toContain('reddit');
  });

  it('keeps pasted answers across a view switch, but not across a reload', () => {
    const first = render(<CitedPage />);
    paste(1, PERPLEXITY);
    fireEvent.change(screen.getByLabelText('Your site'), { target: { value: 'example.com' } });
    first.unmount();
    // Another view and back: the view mounts afresh within the same page.
    const second = render(<CitedPage />);
    expect((answerBox(1) as HTMLTextAreaElement).value).toBe(PERPLEXITY);
    expect(groupNames()).toContain(OFFPAGE_ADVICE.forum.title);
    expect(results().textContent).not.toContain('Paste again to see details');
    second.unmount();
    clearPasted(); // what a reload does to page memory
    render(<CitedPage />);
    expect((answerBox(1) as HTMLTextAreaElement).value).toBe('');
    expect(results().textContent).toContain('Paste again to see details');
  });

  it('stores that no site was given, and on reload asks for one instead of saying "cited in 0"', () => {
    const first = render(<CitedPage />);
    paste(1, PERPLEXITY);
    expect(getSummary('cited')).toMatchObject({ answers: 1, citingYou: 0 });
    expect(getSummary('cited')).not.toHaveProperty('site');
    first.unmount();
    clearPasted(); // a reload forgets page memory
    render(<CitedPage />);
    const text = results().textContent ?? '';
    expect(text).toContain('Add your site above to see if it is cited.');
    expect(text).not.toContain('Your site: cited in');
    expect(text).toContain('Paste again to see details');
  });

  it('stores the site once one is entered, and keeps the headline on reload', () => {
    const first = render(<CitedPage />);
    paste(1, PERPLEXITY);
    fireEvent.change(screen.getByLabelText('Your site'), { target: { value: 'example.com' } });
    expect(getSummary('cited')).toMatchObject({ citingYou: 1, site: 'example.com' });
    first.unmount();
    render(<CitedPage />);
    expect(results().textContent).toContain('Your site: cited in 1 of 1 answers.');
  });

  it('still tallies when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<CitedPage />);
    fireEvent.change(screen.getByLabelText('Your site'), { target: { value: 'example.com' } });
    paste(1, PERPLEXITY);
    expect(results().textContent).toContain('Your site: cited in 1 of 1 answers.');
  });

  it('keeps every kind short, plain and free of the retired words', () => {
    render(<CitedPage />);
    paste(1, NINE_KINDS);
    expect(groupNames()).toHaveLength(9);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toMatch(new RegExp(['contra', 'dicted'].join(''), 'i'));
    expect(text).not.toMatch(/\bGEO\b/);
    expect(text).not.toContain('ce sources');
    expect(text).not.toMatch(/never posts/i);
  });
});

describe('Do and Avoid lines', () => {
  it("show the engine's short lines for every kind, 20 words or fewer", () => {
    render(<CitedPage />);
    paste(1, NINE_KINDS);
    for (const kind of SOURCE_KINDS) {
      const card = OFFPAGE_ADVICE[kind];
      const group = within(results()).getByRole('region', { name: card.title });
      const lines = [...group.querySelectorAll('dd')].map((dd) => dd.textContent);
      expect(lines, kind).toEqual([card.short.do, card.short.avoid]);
      expect(words(card.short.do), `${kind} do`).toBeLessThanOrEqual(20);
      expect(words(card.short.avoid), `${kind} avoid`).toBeLessThanOrEqual(20);
      expect(`${card.short.do} ${card.short.avoid}`).not.toContain(EM_DASH);
    }
  });
});

describe('citedReport and citedSummary', () => {
  it('tallies entries without an answer as nothing and labels unnamed questions', () => {
    const report = citedReport(
      [
        { question: '', answer: 'https://reddit.com/r/a' },
        { question: 'Q2', answer: '   ' },
      ],
      '',
    );
    expect(report.answers).toBe(1);
    expect(report.groups[0]?.domains[0]?.questions).toEqual(['Question 1']);
    expect(citedSummary(report, '2026-10-24T00:00:00.000Z')).toEqual({
      answers: 1,
      citingYou: 0,
      topKinds: ['forum'],
      example: false,
      at: '2026-10-24T00:00:00.000Z',
    });
    expect(citedSummary(citedReport([], 'https://www.example.com/post'), 'x').site).toBe(
      'example.com',
    );
  });
});
