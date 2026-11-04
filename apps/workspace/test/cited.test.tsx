import { DEFAULT_SETTINGS, probeOllama, runBench } from '@citation-equity/bench';
import { OFFPAGE_ADVICE, SOURCE_KINDS } from '@citation-equity/engine';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CitedPage, { metadata } from '@/app/cited/page';
import { citedReport, citedSummary } from '@/components/cited/tally';
import { TestPanel } from '@/components/cited/test-panel';
import { localSettings, sampleBench } from '@/lib/bench';
import { selectDraftSlot } from '@/lib/draft-summary';
import { EXAMPLE_ANSWERS, EXAMPLE_SITE, EXAMPLE_SLUG, runExample } from '@/lib/examples';
import { getLocalModel, setLocalModel } from '@/lib/local-model';
import { clearPasted, getLoadedPack, setLoadedPack } from '@/lib/pasted';
import { getSample, MY_DRAFT_SLUG } from '@/lib/samples';
import { saveDraft } from '@/lib/storage';
import { clearAll, getSummary, MY_POST_SLOT, setSummary } from '@/lib/store';
import { BEFORE_REPORT, PACK } from './fixtures/bench';

// Only the two calls that would reach a local server are replaced; the rest of the bench is real.
vi.mock('@citation-equity/bench', async (importOriginal) => {
  const bench = await importOriginal<typeof import('@citation-equity/bench')>();
  return { ...bench, probeOllama: vi.fn(), runBench: vi.fn() };
});
const probeMock = vi.mocked(probeOllama);
const runMock = vi.mocked(runBench);

const EM_DASH = '—';
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

beforeEach(() => {
  clearAll();
  setLocalModel(null);
  probeMock.mockReset();
  runMock.mockReset();
});
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

/** A section of the page by its anchor. */
const anchor = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no #${id} on the page`);
  return el;
};
const testSection = () => anchor('test');

const CAVEAT_TEXT =
  'Content check on a local model over a fixed page set. It does not predict live AI engines.';
const CHANCE_TEXT = 'Small local AI and sample pages, so this could be chance.';
/** The model the example's local run asks for: its recorded run's. */
const exampleModel = () => localSettings(sampleBench(getSample(EXAMPLE_SLUG))).model;

describe('/cited: Did it change anything?', () => {
  it('leads with its H1 and lead, and describes the page as Results', () => {
    render(<CitedPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Did it change anything?');
    expect(
      screen.getByText(
        'Test your draft before and after on a local AI, or see who live AI search cites.',
      ),
    ).toBeTruthy();
    expect(metadata.title).toBe('Results | Citation Equity');
    expect(metadata.description).toBe(
      'Test your draft before and after on a local AI, and see which sites AI answers cite. Stays in your browser.',
    );
  });

  it('holds Test before and after (#test), then Who AI search cites (#cited) around Who gets cited', () => {
    render(<CitedPage />);
    const test = testSection();
    const cited = anchor('cited');
    expect(test.tagName).toBe('SECTION');
    expect(cited.tagName).toBe('SECTION');
    expect(screen.getByRole('region', { name: 'Test before and after' })).toBe(test);
    expect(screen.getByRole('region', { name: 'Who AI search cites' })).toBe(cited);
    expect(within(test).getByRole('heading', { level: 2 }).textContent).toBe(
      'Test before and after',
    );
    expect(
      within(test).getByText(
        'Open models answer from fixed sources, so this shows a direction at most.',
      ),
    ).toBeTruthy();
    expect(within(cited).getAllByRole('heading', { level: 2 })[0]?.textContent).toBe(
      'Who AI search cites',
    );
    // Test first, then the cited view, which keeps its own region inside the second section.
    expect(test.compareDocumentPosition(cited) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cited.contains(results())).toBe(true);
    expect(test.contains(results())).toBe(false);
  });

  it('keeps one outline: Who gets cited sits under its h2, its groups under it', () => {
    render(<CitedPage />);
    const cited = anchor('cited');
    expect(
      within(cited)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(['Who AI search cites']);
    expect(within(results()).getByRole('heading', { level: 3 }).textContent).toBe('Who gets cited');
    paste(1, PERPLEXITY);
    fireEvent.change(screen.getByLabelText('Your site'), { target: { value: 'example.com' } });
    const groups = within(results()).getAllByRole('heading', { level: 4 });
    expect(groups.map((h) => h.textContent)).toEqual([
      expect.stringMatching(/^Your site/),
      OFFPAGE_ADVICE.forum.title,
      OFFPAGE_ADVICE.wiki.title,
    ]);
  });

  it("gives the cited view's lead the page lead's size and colour", () => {
    render(<CitedPage />);
    const page = screen.getByText(
      'Test your draft before and after on a local AI, or see who live AI search cites.',
    );
    const lead = screen.getByText(/^AI answers also cite forums/);
    const size = (el: HTMLElement) =>
      [...el.classList].filter((c) => /^text-(xs|sm|base|lg|xl)/.test(c));
    expect(size(lead)).toEqual(size(page));
    expect(lead.classList.contains('text-ink-soft')).toBe(page.classList.contains('text-ink-soft'));
    expect(lead.classList.contains('text-muted-foreground')).toBe(false);
  });

  it("shows the example's recorded result with the chance note and the exact bench caveat", () => {
    runExample();
    render(<CitedPage />);
    const test = testSection();
    const recorded = within(test).getByRole('region', { name: 'Sample result' });
    expect(within(recorded).getByText(/^Cited: \d+% before, \d+% after$/)).toBeTruthy();
    expect(within(recorded).getByText(CHANCE_TEXT)).toBeTruthy();
    expect(within(recorded).getByText(CAVEAT_TEXT)).toBeTruthy();
    expect(within(test).getByRole('button', { name: 'Connect local AI' })).toBeTruthy();
    expect(within(test).queryByText('Paste a draft first.')).toBeNull();
    // Nothing is asked of the local AI before a click.
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("runs the example's saved text, not its starting text, against the example before", async () => {
    const sample = getSample(EXAMPLE_SLUG);
    const edited = `${sample.before}\n\nOne more paragraph the author added.`;
    runExample();
    saveDraft(EXAMPLE_SLUG, edited);
    probeMock.mockResolvedValue({ reachable: true, models: [exampleModel()] });
    // The before run settles; the current one stays in flight, so the test reads its input.
    runMock.mockImplementation((_pack, draft) =>
      draft.id === 'before' ? Promise.resolve(BEFORE_REPORT) : new Promise(() => {}),
    );
    render(<CitedPage />);
    const test = testSection();
    await act(async () => {
      fireEvent.click(within(test).getByRole('button', { name: 'Connect local AI' }));
    });
    await act(async () => {
      fireEvent.click(within(test).getByRole('button', { name: 'Run test' }));
    });
    expect(runMock.mock.calls.map(([, draft]) => [draft.id, draft.markdown])).toEqual([
      ['before', sample.before],
      ['current', edited],
    ]);
  });

  it('tells the other views when Connect local AI finds the model', async () => {
    runExample();
    probeMock.mockResolvedValue({ reachable: true, models: [exampleModel()] });
    render(<CitedPage />);
    await act(async () => {
      fireEvent.click(within(testSection()).getByRole('button', { name: 'Connect local AI' }));
    });
    expect(getLocalModel()).toEqual({ status: 'ready', model: exampleModel() });
  });

  it('offers My post with text a test pack to load', () => {
    saveDraft(MY_DRAFT_SLUG, '# Cold brew at home\n\nSteep coarse grounds overnight.');
    render(<CitedPage />);
    const test = testSection();
    expect(within(test).getByLabelText('Load a test pack')).toBeTruthy();
    expect(within(test).queryByRole('region', { name: 'Sample result' })).toBeNull();
    expect(within(test).queryByText('Paste a draft first.')).toBeNull();
  });

  it('asks for a draft first when the open draft is empty, with a link to it', () => {
    saveDraft(MY_DRAFT_SLUG, '  \n ');
    render(<CitedPage />);
    const test = testSection();
    expect(within(test).getByText('Paste a draft first.')).toBeTruthy();
    expect(within(test).getByRole('link', { name: 'Open draft' }).getAttribute('href')).toMatch(
      /^\/draft\/?$/,
    );
    expect(within(test).queryByLabelText('Load a test pack')).toBeNull();
    expect(within(test).queryByRole('button', { name: 'Connect local AI' })).toBeNull();
  });

  it('asks for a draft when it has no words: only code, front matter or HTML', () => {
    saveDraft(MY_DRAFT_SLUG, '```\nnpm run build\n```\n');
    render(<CitedPage />);
    expect(within(testSection()).getByText('Paste a draft first.')).toBeTruthy();
    expect(within(testSection()).queryByLabelText('Load a test pack')).toBeNull();
  });

  it('prerenders nothing in the panel, then shows the stored draft once the page reads it', async () => {
    saveDraft(MY_DRAFT_SLUG, '# Cold brew at home\n\nSteep coarse grounds overnight.');
    // The server cannot read this browser's draft, so it says nothing rather than "Paste a draft first."
    const html = renderToString(<TestPanel />);
    expect(html).toBe('');
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = html;
    const errors = vi.spyOn(console, 'error');
    const root = await act(async () => hydrateRoot(container, <TestPanel />));
    expect(within(container).getByLabelText('Load a test pack')).toBeTruthy();
    expect(errors).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });

  it('follows the active draft while the page is open', () => {
    runExample();
    render(<CitedPage />);
    expect(within(testSection()).getByRole('region', { name: 'Sample result' })).toBeTruthy();
    act(() => selectDraftSlot(MY_POST_SLOT));
    expect(within(testSection()).getByText('Paste a draft first.')).toBeTruthy();
  });

  it("keeps My post's loaded pack while the author leaves to edit, until Clear my data", async () => {
    const first = '# Cold brew at home\n\nSteep coarse grounds overnight.';
    const second = `${first}\n\nStrain it twice for a cleaner cup.`;
    saveDraft(MY_DRAFT_SLUG, first);
    probeMock.mockResolvedValue({ reachable: true, models: [DEFAULT_SETTINGS.model] });
    runMock.mockImplementation((_pack, draft) =>
      draft.id === 'before' ? Promise.resolve(BEFORE_REPORT) : new Promise(() => {}),
    );
    const view = render(<CitedPage />);
    await act(async () => {
      fireEvent.change(within(testSection()).getByLabelText('Load a test pack'), {
        target: { files: [new File([JSON.stringify(PACK)], 'my-pack.json')] },
      });
    });
    view.unmount();
    // Off to the draft view, an edit, and back: the page mounts afresh.
    saveDraft(MY_DRAFT_SLUG, second);
    render(<CitedPage />);
    const test = testSection();
    expect(test.textContent).toContain('Loaded my-pack.json.');
    await act(async () => {
      fireEvent.click(within(test).getByRole('button', { name: 'Connect local AI' }));
    });
    await act(async () => {
      fireEvent.click(within(test).getByRole('button', { name: 'Run test' }));
    });
    expect(runMock.mock.calls.map(([, draft]) => draft.markdown)).toEqual([first, second]);
    cleanup();
    clearAll();
    saveDraft(MY_DRAFT_SLUG, second);
    render(<CitedPage />);
    expect(testSection().textContent).not.toContain('Loaded my-pack.json');
  });

  it("keeps each draft's loaded pack in page memory, apart, until Clear my data", () => {
    const loaded = {
      name: 'my-pack.json',
      pack: PACK,
      baseline: { label: 'Text at pack load', title: 'Cold brew', markdown: '# Cold brew' },
    };
    setLoadedPack(MY_DRAFT_SLUG, loaded);
    expect(getLoadedPack(MY_DRAFT_SLUG)).toBe(loaded);
    expect(getLoadedPack(EXAMPLE_SLUG)).toBeNull();
    setLoadedPack(MY_DRAFT_SLUG, null);
    expect(getLoadedPack(MY_DRAFT_SLUG)).toBeNull();
    setLoadedPack(MY_DRAFT_SLUG, loaded);
    clearAll();
    expect(getLoadedPack(MY_DRAFT_SLUG)).toBeNull();
    // Never written to browser storage.
    expect(JSON.stringify(window.localStorage)).not.toContain('my-pack');
  });

  it('reads the draft from page memory when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    saveDraft(MY_DRAFT_SLUG, '# Cold brew at home\n\nSteep coarse grounds overnight.');
    render(<CitedPage />);
    expect(within(testSection()).getByLabelText('Load a test pack')).toBeTruthy();
  });
});

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
