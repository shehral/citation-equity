import { fanOutSearches } from '@citation-equity/engine';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuestionsPage from '@/app/questions/page';
import { getPastedCited } from '@/lib/pasted';
import { MY_DRAFT_SLUG } from '@/lib/samples';
import { connectLocalModel, suggestFromKeywords, suggestSearches } from '@/lib/search-helper';
import { getSiteInput } from '@/lib/site-questions';
import { loadQuestions } from '@/lib/storage';
import { clearAll } from '@/lib/store';

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

const csv = (text: string, name = 'Queries.csv') => new File([text], name, { type: 'text/csv' });
const box = () => screen.getByRole('textbox', { name: 'Your keywords' });
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
const type = (value: string) => fireEvent.change(box(), { target: { value } });

const writeText = vi.fn<(text: string) => Promise<void>>();
const fetchSpy = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  clearAll();
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

describe('Your questions', () => {
  it('opens on a paste box and an empty list', () => {
    render(<QuestionsPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What do your readers ask?');
    expect(box()).toBeTruthy();
    expect(screen.getByText(/No questions yet/)).toBeTruthy();
  });

  it('turns pasted keywords into a ranked list with each volume', () => {
    render(<QuestionsPage />);
    type(KEYWORDS);
    expect(texts()).toEqual([
      'Which is better: espresso or drip coffee?',
      'espresso shot time',
      'What is the best espresso grinder for beginners?',
      'espresso bitter',
      'How to dial in espresso?',
    ]);
    expect(
      item('Which is better: espresso or drip coffee?').getByText(/Volume 2,400/),
    ).toBeTruthy();
    expect(
      item('What is the best espresso grinder for beginners?').getByText(
        /Keyword: best espresso grinder for beginners/,
      ),
    ).toBeTruthy();
    // A keyword no template fits is listed exactly as written.
    expect(item('espresso bitter').queryByText(/Keyword:/)).toBeNull();
    expect(screen.getByText('5 questions, ranked by volume.')).toBeTruthy();
    // Kept in this browser.
    expect(getSiteInput().keywords).toBe(KEYWORDS);
  });

  it('keeps the list when the view opens again', () => {
    const first = render(<QuestionsPage />);
    type(KEYWORDS);
    first.unmount();
    render(<QuestionsPage />);
    expect((box() as HTMLTextAreaElement).value).toBe(KEYWORDS);
    expect(texts()).toHaveLength(5);
  });

  it('imports a Search Console export with the same importer as the draft, and ranks it in', async () => {
    const user = userEvent.setup();
    render(<QuestionsPage />);
    type(KEYWORDS);
    await user.upload(
      screen.getByLabelText('Import from Search Console or Bing (CSV)'),
      csv(SEARCH_CONSOLE),
    );
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
    render(<QuestionsPage />);
    await user.upload(
      screen.getByLabelText('Import from Search Console or Bing (CSV)'),
      csv('Keyword,Clicks,Impressions\nespresso,1,2', 'other.csv'),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Not a Search Console Queries export',
    );
  });

  it('copies a question', async () => {
    render(<QuestionsPage />);
    type(KEYWORDS);
    fireEvent.click(
      item('What is the best espresso grinder for beginners?').getByRole('button', {
        name: 'Copy "What is the best espresso grinder for beginners?"',
      }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('What is the best espresso grinder for beginners?'),
    );
    expect(
      await item('What is the best espresso grinder for beginners?').findByText('Copied.'),
    ).toBeTruthy();
  });

  it('Use in my draft adds the question to the draft as the author’s own', () => {
    render(<QuestionsPage />);
    type(KEYWORDS);
    const row = item('What is the best espresso grinder for beginners?');
    fireEvent.click(
      row.getByRole('button', {
        name: 'Use in my draft: What is the best espresso grinder for beginners?',
      }),
    );
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([
      { text: 'What is the best espresso grinder for beginners?', source: 'keywords' },
    ]);
    expect(row.getByText(/Added to Reader questions in your draft/)).toBeTruthy();
    // My post has no text yet, so the draft view shows no Reader questions: the note says so.
    expect(row.getByText(/Add some text to your draft to see Reader questions there/)).toBeTruthy();
    expect(row.getByRole('link', { name: 'Open your draft' }).getAttribute('href')).toMatch(
      /^\/draft\/?$/,
    );
    fireEvent.click(
      row.getByRole('button', {
        name: 'Use in my draft: What is the best espresso grinder for beginners?',
      }),
    );
    expect(row.getByText('Already in your draft.')).toBeTruthy();
  });

  it('Ask an AI copies the question, shows the steps and puts it in Who gets cited', async () => {
    render(<QuestionsPage />);
    type(KEYWORDS);
    const row = item('What is the best espresso grinder for beginners?');
    fireEvent.click(
      row.getByRole('button', {
        name: 'Ask an AI: What is the best espresso grinder for beginners?',
      }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('What is the best espresso grinder for beginners?'),
    );
    const steps = await row.findByRole('list', { name: 'Ask an AI' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Paste the question into ChatGPT, Perplexity, Gemini or Copilot.',
      'Copy the answer with its links.',
      'Paste it in Who gets cited, next to the question.',
    ]);
    expect(
      within(steps).getByRole('link', { name: 'Who gets cited' }).getAttribute('href'),
    ).toMatch(/^\/cited\/?$/);
    expect(getPastedCited()?.entries.map((e) => e.question)).toEqual([
      'What is the best espresso grinder for beginners?',
    ]);
  });

  it('lists the searches behind each question, collapsed, with one plain line', () => {
    render(<QuestionsPage />);
    type(KEYWORDS);
    const row = item('What is the best espresso grinder for beginners?');
    const details = row.getByText('Searches behind this question').closest('details');
    expect(details?.open).toBe(false);
    const inside = within(details as HTMLElement);
    expect(
      inside.getByText(
        'Answer engines often search for these before answering. Cover the ones your readers care about.',
      ),
    ).toBeTruthy();
    expect(inside.getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      fanOutSearches('What is the best espresso grinder for beginners?'),
    );
    // Guidance only: no score or check next to them.
    expect(details?.textContent).not.toMatch(/score|check|cited more|\d+%/i);
  });

  it('makes no request while pasting, importing, copying and using questions', async () => {
    render(<QuestionsPage />);
    type(KEYWORDS);
    // fireEvent, not userEvent: userEvent swaps in its own clipboard.
    fireEvent.change(screen.getByLabelText('Import from Search Console or Bing (CSV)'), {
      target: { files: [csv(SEARCH_CONSOLE)] },
    });
    await screen.findByText('Imported 2 queries from Queries.csv.');
    const row = item('What is the best espresso grinder for beginners?');
    fireEvent.click(
      row.getByRole('button', { name: 'Copy "What is the best espresso grinder for beginners?"' }),
    );
    fireEvent.click(
      row.getByRole('button', {
        name: 'Use in my draft: What is the best espresso grinder for beginners?',
      }),
    );
    fireEvent.click(
      row.getByRole('button', {
        name: 'Ask an AI: What is the best espresso grinder for beginners?',
      }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Suggest more/ })).toBeNull();
  });

  it('with a connected local model, suggests more questions and more searches', async () => {
    connectMock.mockResolvedValue('ready');
    keywordsMock.mockResolvedValue(['Does a darker roast taste more bitter?', 'Espresso bitter?']);
    searchesMock.mockResolvedValue(['espresso over extraction', 'espresso grinder reviews']);
    render(<QuestionsPage />);
    type(KEYWORDS);
    fireEvent.click(screen.getByRole('button', { name: 'Connect local AI' }));
    expect(await screen.findByText('Connected to llama3.2:3b.')).toBeTruthy();
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

    const row = item('What is the best espresso grinder for beginners?');
    fireEvent.click(row.getByRole('button', { name: 'Suggest more searches' }));
    expect(await row.findByText('Added 1 search from llama3.2:3b.')).toBeTruthy();
    expect(searchesMock).toHaveBeenCalledWith(
      'What is the best espresso grinder for beginners?',
      'llama3.2:3b',
    );
    expect(row.getByText('espresso over extraction')).toBeTruthy();
  });

  it('tells how to start Ollama when it cannot be reached', async () => {
    connectMock.mockResolvedValue('unreachable');
    render(<QuestionsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect local AI' }));
    expect(await screen.findByText(/Can't reach Ollama/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Suggest more questions' })).toBeNull();
  });

  it('is emptied by Clear my data', () => {
    render(<QuestionsPage />);
    type(KEYWORDS);
    act(() => clearAll());
    expect((box() as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText(/No questions yet/)).toBeTruthy();
  });

  it('says nothing about adding text once the draft has some', () => {
    window.localStorage.setItem('ce:v1:draft:my-draft', '# Espresso\n\nSome text.\n');
    render(<QuestionsPage />);
    type(KEYWORDS);
    const row = item('espresso bitter');
    fireEvent.click(row.getByRole('button', { name: 'Use in my draft: espresso bitter' }));
    expect(row.getByText(/Added to Reader questions in your draft/)).toBeTruthy();
    expect(row.queryByText(/Add some text/)).toBeNull();
  });

  it('gives a model-suggested question a remove control, and the keywords none', async () => {
    connectMock.mockResolvedValue('ready');
    keywordsMock.mockResolvedValue(['Does a darker roast taste more bitter?']);
    render(<QuestionsPage />);
    type(KEYWORDS);
    expect(screen.queryByRole('button', { name: /^Remove "/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect local AI' }));
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
    render(<QuestionsPage />);
    type(Array.from({ length: 60 }, (_, i) => `espresso question ${i + 1}?`).join('\n'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect local AI' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Suggest more questions' }));
    expect(
      await screen.findByText(
        'Added 1 question from llama3.2:3b. It is past the 50 the list shows: remove some keywords to see it.',
      ),
    ).toBeTruthy();
  });
});
