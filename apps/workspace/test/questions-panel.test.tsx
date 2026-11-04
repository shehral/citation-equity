import { fanOutSearches } from '@citation-equity/engine';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionList, QuestionsInput } from '@/components/home/questions-panel';
import { getLocalModel, setLocalModel } from '@/lib/local-model';
import { getPastedCited } from '@/lib/pasted';
import { MY_DRAFT_SLUG } from '@/lib/samples';
import { connectLocalModel, suggestFromKeywords, suggestSearches } from '@/lib/search-helper';
import { getSiteInput } from '@/lib/site-questions';
import { loadQuestions, saveDraft, saveQuestions } from '@/lib/storage';
import { clearAll, getSummary } from '@/lib/store';

// The local-model helpers would call Ollama on localhost; the tests decide what they return.
vi.mock('@/lib/search-helper', () => ({
  LOCAL_MODEL: 'llama3.2:3b',
  connectLocalModel: vi.fn(),
  suggestFromKeywords: vi.fn(),
  suggestSearches: vi.fn(),
}));
const connectMock = vi.mocked(connectLocalModel);
const keywordsMock = vi.mocked(suggestFromKeywords);
const searchesMock = vi.mocked(suggestSearches);

const KEYWORDS = [
  'espresso bitter',
  'espresso shot time, 1900',
  'best espresso grinder for beginners, 720',
  'espresso vs drip coffee, 2400',
  'how to dial in espresso',
].join('\n');
const SEARCH_CONSOLE = [
  'Top queries,Clicks,Impressions,CTR,Position',
  'espresso grind size,12,2310,0.52%,11.2',
  'espresso beans,2,"1,500",0.13%,22',
].join('\n');
const GRINDER = 'What is the best espresso grinder for beginners?';

const csv = (text: string, name = 'Queries.csv') => new File([text], name, { type: 'text/csv' });
const box = () => screen.getByRole('textbox', { name: "Your readers' questions" });
const importer = () => screen.getByLabelText('Import CSV');
const list = () => screen.getByRole('list', { name: 'Your questions, ranked' });
const items = () =>
  within(list())
    .getAllByRole('listitem')
    .filter((li) => li.parentElement === list());
const texts = () => items().map((li) => li.querySelector('[data-question]')?.textContent);
const item = (text: string) => {
  const li = items().find((el) => el.querySelector('[data-question]')?.textContent === text);
  if (!li) throw new Error(`no item "${text}"`);
  return within(li);
};
const tick = (text: string) => item(text).getByRole('checkbox', { name: text }) as HTMLInputElement;
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const localAi = () => screen.getByText('More from a local AI').closest('details') as HTMLElement;

/** The input card and the list, as the home lays them out (the step cards go between). */
const renderPanel = (canTryExample = false) =>
  render(
    <>
      <QuestionsInput />
      <QuestionList canTryExample={canTryExample} />
    </>,
  );

const writeText = vi.fn<(text: string) => Promise<void>>();
const fetchSpy = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  clearAll();
  setLocalModel(null);
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  connectMock.mockReset();
  keywordsMock.mockReset();
  searchesMock.mockReset();
});
afterEach(() => {
  cleanup();
  clearAll();
  vi.unstubAllGlobals();
});

describe('the input card', () => {
  it('is one box for questions or keywords, with its hint, the import and a closed local AI block', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: "Your readers' questions" })).toBeTruthy();
    expect(box().getAttribute('placeholder')).toBe(
      'Why does my espresso taste bitter?\nespresso shot time, 1900\nhow to dial in espresso',
    );
    expect(screen.getByText(/^Type questions or paste keywords, one per line\./).id).toBe(
      box().getAttribute('aria-describedby'),
    );
    expect(
      screen.getByText(
        'Type questions or paste keywords, one per line. Add a search volume after a comma.',
      ),
    ).toBeTruthy();
    expect(importer().getAttribute('accept')).toBe('.csv,text/csv');
    expect(
      screen.getByText('A Search Console or Bing Webmaster export. Read here, never uploaded.'),
    ).toBeTruthy();
    expect((localAi() as HTMLDetailsElement).open).toBe(false);
    expect(within(localAi()).getByRole('button', { name: 'Connect local AI' })).toBeTruthy();
  });

  it('starts with an empty list, offering the example only while its button shows', () => {
    const first = renderPanel(true);
    expect(screen.getByText('No questions yet. Type one above, or try the example.')).toBeTruthy();
    first.unmount();
    renderPanel(false);
    expect(screen.getByText('No questions yet. Type one above.')).toBeTruthy();
  });
});

describe('the list', () => {
  it('turns pasted keywords into a ranked list with each volume', () => {
    renderPanel();
    type(KEYWORDS);
    expect(texts()).toEqual([
      'Which is better: espresso or drip coffee?',
      'espresso shot time',
      GRINDER,
      'espresso bitter',
      'How to dial in espresso?',
    ]);
    expect(
      item('Which is better: espresso or drip coffee?').getByText(/Volume 2,400/),
    ).toBeTruthy();
    expect(item(GRINDER).getByText(/Keyword: best espresso grinder for beginners/)).toBeTruthy();
    // A keyword no template fits is listed exactly as written.
    expect(item('espresso bitter').queryByText(/Keyword:/)).toBeNull();
    expect(
      screen.getByText(
        '5 questions, ranked by volume. Tick the ones this draft should answer, up to 8.',
      ),
    ).toBeTruthy();
    // Kept in this browser.
    expect(getSiteInput().keywords).toBe(KEYWORDS);
  });

  it('keeps questions typed as questions in your order', () => {
    renderPanel();
    type('Why does my espresso taste bitter?\nHow do I fix bitter espresso?');
    expect(texts()).toEqual([
      'Why does my espresso taste bitter?',
      'How do I fix bitter espresso?',
    ]);
    expect(
      screen.getByText(
        '2 questions, in your order. Tick the ones this draft should answer, up to 8.',
      ),
    ).toBeTruthy();
  });

  it('keeps the list when the view opens again', () => {
    const first = renderPanel();
    type(KEYWORDS);
    first.unmount();
    renderPanel();
    expect((box() as HTMLTextAreaElement).value).toBe(KEYWORDS);
    expect(texts()).toHaveLength(5);
  });

  it('says when the list is cut to its top 50', () => {
    renderPanel();
    type(Array.from({ length: 60 }, (_, i) => `espresso question ${i + 1}?`).join('\n'));
    expect(
      screen.getByText(
        '50 questions, in your order. Showing the top 50. Tick the ones this draft should answer, up to 8.',
      ),
    ).toBeTruthy();
  });
});

describe('Import CSV', () => {
  it('imports a Search Console export and ranks it in', async () => {
    const user = userEvent.setup();
    renderPanel();
    type(KEYWORDS);
    await user.upload(importer(), csv(SEARCH_CONSOLE));
    expect(await screen.findByText('Imported 2 queries from Queries.csv.')).toBeTruthy();
    expect(texts().slice(0, 4)).toEqual([
      'Which is better: espresso or drip coffee?',
      'espresso grind size',
      'espresso shot time',
      'What are espresso beans?',
    ]);
    expect(item('espresso grind size').getByText(/2,310 impressions/)).toBeTruthy();
    expect(item('espresso grind size').getByText('Search Console')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the imported queries' }));
    expect(texts()).toHaveLength(5);
  });

  it('says what is wrong with a file that is not an export', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.upload(importer(), csv('Keyword,Clicks,Impressions\nespresso,1,2', 'other.csv'));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Not a Search Console Queries export',
    );
  });
});

describe('a tick per question', () => {
  it('adds the question to the open draft with its template, and unticking removes it', () => {
    saveDraft(MY_DRAFT_SLUG, '# Espresso notes\n\nSome notes on pulling espresso at home.\n');
    renderPanel();
    type(KEYWORDS);
    expect(tick(GRINDER).checked).toBe(false);
    fireEvent.click(tick(GRINDER));
    expect(tick(GRINDER).checked).toBe(true);
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([
      { text: GRINDER, source: 'keywords', template: 'best' },
    ]);
    // The draft summary follows at once: the one listed question is measured.
    expect(getSummary('draft')).toMatchObject({ total: 1, fromPage: false });

    fireEvent.click(tick(GRINDER));
    expect(tick(GRINDER).checked).toBe(false);
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([]);
    expect(getSummary('draft')).toMatchObject({ fromPage: true });
  });

  it('shows a question already on the draft ticked', () => {
    saveQuestions(MY_DRAFT_SLUG, [{ text: 'espresso bitter?', source: 'user' }]);
    renderPanel();
    type(KEYWORDS);
    expect(tick('espresso bitter').checked).toBe(true);
    expect(tick(GRINDER).checked).toBe(false);
  });

  it('keeps an import its own source', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.upload(importer(), csv(SEARCH_CONSOLE));
    await screen.findByText('Imported 2 queries from Queries.csv.');
    fireEvent.click(tick('espresso grind size'));
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([
      { text: 'espresso grind size', source: 'search-console', template: 'kept' },
    ]);
  });

  it('refuses a ninth question with a note, and the box stays unticked', () => {
    saveQuestions(
      MY_DRAFT_SLUG,
      Array.from({ length: 8 }, (_, i) => ({
        text: `Question ${i + 1}?`,
        source: 'user' as const,
      })),
    );
    renderPanel();
    type(KEYWORDS);
    fireEvent.click(tick(GRINDER));
    expect(tick(GRINDER).checked).toBe(false);
    expect(item(GRINDER).getByRole('status').textContent).toBe(
      'A draft holds 8 questions. Untick one first.',
    );
    expect(loadQuestions(MY_DRAFT_SLUG)).toHaveLength(8);
  });
});

describe('per question', () => {
  it('copies a question', async () => {
    renderPanel();
    type(KEYWORDS);
    fireEvent.click(item(GRINDER).getByRole('button', { name: `Copy "${GRINDER}"` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(GRINDER));
    expect(await item(GRINDER).findByText('Copied.')).toBeTruthy();
  });

  it('Ask AI copies the question, shows the steps and puts it in Results', async () => {
    renderPanel();
    type(KEYWORDS);
    const row = item(GRINDER);
    const ask = row.getByRole('button', { name: `Ask AI: ${GRINDER}` });
    expect(ask.textContent).toBe('Ask AI');
    fireEvent.click(ask);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(GRINDER));
    const steps = await row.findByRole('list', { name: 'Ask AI' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Paste the question into ChatGPT, Perplexity, Gemini or Copilot.',
      'Copy the answer with its links.',
      'Paste it in Results, next to the question.',
    ]);
    expect(within(steps).getByRole('link', { name: 'Results' }).getAttribute('href')).toMatch(
      /^\/cited\/?$/,
    );
    expect(getPastedCited()?.entries.map((e) => e.question)).toEqual([GRINDER]);
  });

  it('lists the searches behind each question, collapsed, with one plain line', () => {
    renderPanel();
    type(KEYWORDS);
    const details = item(GRINDER).getByText('Searches behind this question').closest('details');
    expect(details?.open).toBe(false);
    const inside = within(details as HTMLElement);
    expect(
      inside.getByText(
        'Answer engines often search for these before answering. Cover the ones your readers care about.',
      ),
    ).toBeTruthy();
    expect(inside.getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      fanOutSearches(GRINDER),
    );
    // Guidance only: no score or check next to them.
    expect(details?.textContent).not.toMatch(/score|check|cited more|\d+%/i);
  });

  it('makes no request while typing, importing, ticking, copying and asking', async () => {
    renderPanel();
    type(KEYWORDS);
    // fireEvent, not userEvent: userEvent swaps in its own clipboard.
    fireEvent.change(importer(), { target: { files: [csv(SEARCH_CONSOLE)] } });
    await screen.findByText('Imported 2 queries from Queries.csv.');
    const row = item(GRINDER);
    fireEvent.click(row.getByRole('button', { name: `Copy "${GRINDER}"` }));
    fireEvent.click(tick(GRINDER));
    fireEvent.click(row.getByRole('button', { name: `Ask AI: ${GRINDER}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Suggest more/ })).toBeNull();
  });

  it('is emptied by Clear my data', () => {
    renderPanel();
    type(KEYWORDS);
    act(() => clearAll());
    expect((box() as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText(/No questions yet/)).toBeTruthy();
  });
});

describe('More from a local AI', () => {
  it('with a connected local model, suggests more questions and more searches', async () => {
    connectMock.mockResolvedValue('ready');
    keywordsMock.mockResolvedValue(['Does a darker roast taste more bitter?', 'Espresso bitter?']);
    searchesMock.mockResolvedValue(['espresso over extraction', 'espresso grinder reviews']);
    renderPanel();
    type(KEYWORDS);
    fireEvent.click(within(localAi()).getByRole('button', { name: 'Connect local AI' }));
    expect(await within(localAi()).findByText('Connected to llama3.2:3b.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest more questions' }));
    expect(await screen.findByText('Added 1 question from llama3.2:3b.')).toBeTruthy();
    // Only the keywords are sent: no volumes.
    expect(keywordsMock).toHaveBeenCalledWith(
      [
        'espresso vs drip coffee',
        'espresso shot time',
        'best espresso grinder for beginners',
        'espresso bitter',
        'how to dial in espresso',
      ],
      'llama3.2:3b',
    );
    expect(texts().at(-1)).toBe('Does a darker roast taste more bitter?');
    expect(item('Does a darker roast taste more bitter?').getByText('Local model')).toBeTruthy();

    const row = item(GRINDER);
    fireEvent.click(row.getByRole('button', { name: 'Suggest more searches' }));
    expect(await row.findByText('Added 1 search from llama3.2:3b.')).toBeTruthy();
    expect(searchesMock).toHaveBeenCalledWith(GRINDER, 'llama3.2:3b');
    expect(row.getByText('espresso over extraction')).toBeTruthy();
  });

  it('reads the shared connection: a model connected elsewhere is ready here', () => {
    setLocalModel('llama3.2:3b');
    renderPanel();
    expect(within(localAi()).getByText('Connected to llama3.2:3b.')).toBeTruthy();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('tells how to start Ollama when it cannot be reached', async () => {
    connectMock.mockResolvedValue('unreachable');
    renderPanel();
    fireEvent.click(within(localAi()).getByRole('button', { name: 'Connect local AI' }));
    expect(await within(localAi()).findByText(/Can't reach Ollama/)).toBeTruthy();
    expect(within(localAi()).getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Suggest more questions' })).toBeNull();
  });

  it('says so when the model stops answering, and Try again connects afresh', async () => {
    connectMock.mockResolvedValue('ready');
    keywordsMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPanel();
    type(KEYWORDS);
    fireEvent.click(within(localAi()).getByRole('button', { name: 'Connect local AI' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Suggest more questions' }));
    expect(await within(localAi()).findByText(/Can't reach Ollama/)).toBeTruthy();
    fireEvent.click(within(localAi()).getByRole('button', { name: 'Try again' }));
    expect(await within(localAi()).findByText('Connected to llama3.2:3b.')).toBeTruthy();
    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('stops offering the model on every row once it stops answering, here and in the other views', async () => {
    connectMock.mockResolvedValue('ready');
    keywordsMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPanel();
    type(KEYWORDS);
    fireEvent.click(within(localAi()).getByRole('button', { name: 'Connect local AI' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Suggest more questions' }));
    expect(item(GRINDER).getByRole('button', { name: 'Suggest more searches' })).toBeTruthy();
    expect(await within(localAi()).findByText(/Can't reach Ollama/)).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: 'Suggest more searches' })).toEqual([]);
    // The page's one connection says so too, so the draft's helpers lock with it.
    expect(getLocalModel()).toEqual({ status: 'unreachable', model: 'llama3.2:3b' });
  });

  it('gives a model-suggested question a remove control, and the keywords none', async () => {
    connectMock.mockResolvedValue('ready');
    keywordsMock.mockResolvedValue(['Does a darker roast taste more bitter?']);
    renderPanel();
    type(KEYWORDS);
    expect(screen.queryByRole('button', { name: /^Remove "/ })).toBeNull();
    fireEvent.click(within(localAi()).getByRole('button', { name: 'Connect local AI' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Suggest more questions' }));
    await screen.findByText('Added 1 question from llama3.2:3b.');
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove "Does a darker roast taste more bitter?"' }),
    );
    expect(texts()).not.toContain('Does a darker roast taste more bitter?');
    expect(getSiteInput().suggested).toEqual([]);
  });

  it('says when suggested questions fall past the 50 the list shows', async () => {
    connectMock.mockResolvedValue('ready');
    keywordsMock.mockResolvedValue(['Does a darker roast taste more bitter?']);
    renderPanel();
    type(Array.from({ length: 60 }, (_, i) => `espresso question ${i + 1}?`).join('\n'));
    fireEvent.click(within(localAi()).getByRole('button', { name: 'Connect local AI' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Suggest more questions' }));
    expect(
      await screen.findByText(
        'Added 1 question from llama3.2:3b. It is past the 50 the list shows: remove some keywords to see it.',
      ),
    ).toBeTruthy();
  });
});
