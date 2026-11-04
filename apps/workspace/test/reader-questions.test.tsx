import { AdapterUnavailableError } from '@citation-equity/bench';
import {
  fanOutSearches,
  generateQuestions,
  type ImportedQuery,
  siteQuestions,
} from '@citation-equity/engine';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderQuestions } from '@/components/draft/reader-questions';
import { SEARCHES_NOTE } from '@/components/questions/searches-behind';
import { suggestWithLocalModel } from '@/lib/question-helper';
import {
  hasQuestion,
  inputKindOf,
  MAX_QUESTIONS,
  mergeQuestions,
  type WorkspaceQuestion,
} from '@/lib/questions';
import { suggestSearches } from '@/lib/search-helper';
import {
  EMPTY_SITE_INPUT,
  getSiteInput,
  type SiteInput,
  setSiteInput,
  siteQuestionsOf,
} from '@/lib/site-questions';
import { clearAll } from '@/lib/store';

// The helper would call a local Ollama; the tests decide what it returns.
vi.mock('@/lib/question-helper', () => ({ suggestWithLocalModel: vi.fn() }));
const askMock = vi.mocked(suggestWithLocalModel);
vi.mock('@/lib/search-helper', () => ({ suggestSearches: vi.fn() }));
const searchesMock = vi.mocked(suggestSearches);

const DRAFT =
  '# Cold brew at home\n\nCold brew is coffee steeped in cold water.\n\n## How to store it\n\nIn the fridge.\n';
const START: WorkspaceQuestion[] = [
  { text: 'Why is my cold brew sour?', source: 'sample-pack' },
  { text: 'How do you store it?', source: 'template' },
];

/** The editor with its list held in state, as the draft view holds it. */
function Harness({
  initial = START,
  localModel = null,
  onChange,
}: {
  initial?: WorkspaceQuestion[];
  localModel?: string | null;
  onChange?: (q: WorkspaceQuestion[]) => void;
}) {
  const [questions, setQuestions] = useState(initial);
  return (
    <ReaderQuestions
      questions={questions}
      markdown={DRAFT}
      localModel={localModel}
      onChange={(q) => {
        setQuestions(q);
        onChange?.(q);
      }}
    />
  );
}

const panel = () => within(document.body);
/** The questions' own rows (each holds its searches, a list of its own). */
const rows = () => {
  const list = panel().getByRole('list', { name: 'Your reader questions' });
  return within(list)
    .getAllByRole('listitem')
    .filter((li) => li.parentElement === list);
};
const inputs = () =>
  panel()
    .queryAllByRole('textbox', { name: /^Question \d/ })
    .map((el) => (el as HTMLInputElement).value);
const addQuestion = (text: string) => {
  const field = panel().getByRole('textbox', { name: 'New question' });
  fireEvent.change(field, { target: { value: text } });
  fireEvent.submit(field);
};

/** The home's list, as the home stores it. */
const homeList = (patch: Partial<SiteInput>) => setSiteInput({ ...EMPTY_SITE_INPUT, ...patch });
const fromList = () => within(panel().getByRole('region', { name: 'From your list' }));
const offered = () =>
  fromList()
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('[data-question]')?.textContent);

const eight = (): WorkspaceQuestion[] =>
  Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ text: `Q${i}?`, source: 'user' as const }));

beforeEach(() => {
  window.localStorage.clear();
  clearAll();
  askMock.mockReset();
  searchesMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearAll();
  window.localStorage.clear();
});

describe('Question editor', () => {
  it('lists each question in its own labelled field, with a source label except for the sample', () => {
    render(<Harness />);
    expect(panel().getByText('What should this page answer? Up to 8.')).toBeTruthy();
    expect(inputs()).toEqual(['Why is my cold brew sour?', 'How do you store it?']);
    const items = rows();
    expect(items[0]?.textContent).not.toContain('Sample pack');
    expect(items[1]?.textContent).toContain('Template');
  });

  it('has no import control, no page questions box and no answered notes', () => {
    const { container } = render(<Harness initial={[]} />);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(panel().queryByText(/Import/)).toBeNull();
    expect(panel().queryByText(/CSV/)).toBeNull();
    expect(panel().queryByRole('region', { name: 'Imported queries' })).toBeNull();
    expect(panel().queryByText(/Page questions used/)).toBeNull();
    expect(panel().queryByText(/answered/i)).toBeNull();
    expect(panel().queryByRole('button', { name: /Show/ })).toBeNull();
    expect(
      panel().getByText('No questions yet. Add one, or suggest some from your draft.'),
    ).toBeTruthy();
  });

  it('edits a question in place, which makes it yours', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(panel().getByRole('textbox', { name: 'Question 2' }), {
      target: { value: 'How long does cold brew keep?' },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      START[0],
      { text: 'How long does cold brew keep?', source: 'user' },
    ]);
    expect(rows()[1]?.textContent).toContain('By you');
  });

  it('never lets an edit empty a question or repeat another, and restores it on leaving', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const second = panel().getByRole('textbox', { name: 'Question 2' }) as HTMLInputElement;
    fireEvent.change(second, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(second.value).toBe('');
    expect(panel().getByRole('status').textContent).toBe('A question cannot be empty.');
    // The same question as the first, but for case and the "?".
    fireEvent.change(second, { target: { value: 'why is my cold brew sour' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(panel().getByRole('status').textContent).toBe('That question is already on the list.');
    fireEvent.blur(second);
    expect(second.value).toBe('How do you store it?');
    expect(panel().queryByRole('status')).toBeNull();
  });

  it('refuses to add a question that differs from one on the list only by its "?"', () => {
    render(<Harness />);
    addQuestion('why is my COLD brew sour');
    expect(inputs()).toEqual(['Why is my cold brew sour?', 'How do you store it?']);
    expect(panel().getByRole('status').textContent).toBe('That question is already on the list.');
  });

  it('adds a question with Enter, as yours, and removes one with its button', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    addQuestion('Is cold brew stronger than coffee?');
    expect(inputs()).toEqual([
      'Why is my cold brew sour?',
      'How do you store it?',
      'Is cold brew stronger than coffee?',
    ]);
    expect(onChange).toHaveBeenLastCalledWith([
      ...START,
      { text: 'Is cold brew stronger than coffee?', source: 'user' },
    ]);
    expect((panel().getByRole('textbox', { name: 'New question' }) as HTMLInputElement).value).toBe(
      '',
    );
    fireEvent.click(panel().getByRole('button', { name: 'Remove question 1' }));
    expect(inputs()).toEqual(['How do you store it?', 'Is cold brew stronger than coffee?']);
    expect(onChange).toHaveBeenLastCalledWith([
      START[1],
      { text: 'Is cold brew stronger than coffee?', source: 'user' },
    ]);
  });

  it('stops at 8 with the limit message, and every way to add is off', () => {
    homeList({ keywords: 'Is cold brew stronger than coffee?' });
    render(<Harness initial={eight()} localModel="llama3.2:3b" />);
    expect(panel().getByText('That is the limit of 8. Remove one to add another.')).toBeTruthy();
    expect(panel().getByRole('textbox', { name: 'New question' })).toHaveProperty('disabled', true);
    expect(panel().getByRole('button', { name: 'From headings' })).toHaveProperty('disabled', true);
    expect(panel().getByRole('button', { name: 'Local AI' })).toHaveProperty('disabled', true);
    expect(
      fromList().getByRole('button', { name: 'Add "Is cold brew stronger than coffee?"' }),
    ).toHaveProperty('disabled', true);
    // One fewer, and the message goes.
    fireEvent.click(panel().getByRole('button', { name: 'Remove question 1' }));
    expect(panel().queryByText(/limit of 8/)).toBeNull();
    expect(
      fromList().getByRole('button', { name: 'Add "Is cold brew stronger than coffee?"' }),
    ).toHaveProperty('disabled', false);
  });

  it('From headings adds the questions the title and headings ask, only the new ones', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const button = panel().getByRole('button', { name: 'From headings' });
    expect(button.getAttribute('title')).toBe('Questions your title and headings already ask.');
    fireEvent.click(button);
    expect(inputs()).toEqual([
      'Why is my cold brew sour?',
      'How do you store it?',
      'What is cold brew?',
      'How does cold brew work?',
    ]);
    const next = onChange.mock.lastCall?.[0] as WorkspaceQuestion[];
    expect(next).toEqual(mergeQuestions(START, generateQuestions(DRAFT, { max: MAX_QUESTIONS })));
    // Made from the page, so they read as the page's own questions.
    expect(next.slice(2).map(inputKindOf)).toEqual(['page', 'page']);
    expect(panel().getByRole('status').textContent).toBe('Added 2 questions from your draft.');
    fireEvent.click(button);
    expect(panel().getByRole('status').textContent).toBe('No new questions from your draft.');
  });

  it('offers Local AI only with a model connected, and asks nothing before', () => {
    render(<Harness />);
    expect(panel().queryByRole('button', { name: 'Local AI' })).toBeNull();
    expect(panel().queryByText(/local model/i)).toBeNull();
    expect(askMock).not.toHaveBeenCalled();
    cleanup();
    render(<Harness localModel="llama3.2:3b" />);
    expect(panel().getByRole('button', { name: 'Local AI' })).toBeTruthy();
    expect(askMock).not.toHaveBeenCalled();
  });

  it('adds the local model questions on a click of Local AI, labelled as such', async () => {
    askMock.mockResolvedValue([
      { text: 'Is cold brew stronger than coffee?', source: 'local-model' },
      { text: 'How do you store it?', source: 'local-model' },
    ]);
    render(<Harness localModel="llama3.2:3b" />);
    await act(async () => {
      fireEvent.click(panel().getByRole('button', { name: 'Local AI' }));
    });
    expect(askMock).toHaveBeenCalledWith(DRAFT, 'llama3.2:3b');
    expect(inputs()).toEqual([
      'Why is my cold brew sour?',
      'How do you store it?',
      'Is cold brew stronger than coffee?',
    ]);
    expect(rows()[2]?.textContent).toContain('Local model');
    expect(panel().getByRole('status').textContent).toBe('Added 1 question from llama3.2:3b.');
  });

  it('shows Asking... while the local model runs, and keeps edits made meanwhile', async () => {
    let answer: (q: WorkspaceQuestion[]) => void = () => {};
    askMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    render(<Harness localModel="llama3.2:3b" />);
    fireEvent.click(panel().getByRole('button', { name: 'Local AI' }));
    expect(panel().getByRole('button', { name: 'Asking...' })).toHaveProperty('disabled', true);
    fireEvent.change(panel().getByRole('textbox', { name: 'Question 1' }), {
      target: { value: 'Why is cold brew sweet?' },
    });
    await act(async () => {
      answer([{ text: 'Is cold brew stronger than coffee?', source: 'local-model' }]);
    });
    expect(inputs()).toEqual([
      'Why is cold brew sweet?',
      'How do you store it?',
      'Is cold brew stronger than coffee?',
    ]);
    expect(panel().getByRole('button', { name: 'Local AI' })).toHaveProperty('disabled', false);
  });

  it('says how to start Ollama when the local model does not answer', async () => {
    askMock.mockImplementation(async () => {
      throw new AdapterUnavailableError('Ollama is not reachable');
    });
    render(<Harness localModel="llama3.2:3b" />);
    await act(async () => {
      fireEvent.click(panel().getByRole('button', { name: 'Local AI' }));
    });
    expect(panel().getByRole('status').textContent).toContain("Can't reach Ollama");
    expect(inputs()).toHaveLength(2);
  });

  it('shows the searches behind each question, collapsed, with one plain line', () => {
    render(<Harness />);
    const details = rows()[0]?.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Searches behind this question');
    expect(details.textContent).toContain(SEARCHES_NOTE);
    expect(
      within(details)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(fanOutSearches('Why is my cold brew sour?'));
    expect(panel().queryByRole('button', { name: 'Suggest more searches' })).toBeNull();
  });

  it('a label for questions from Your questions', () => {
    render(<Harness initial={[{ text: 'Why is espresso bitter?', source: 'keywords' }]} />);
    expect(rows()[0]?.textContent).toContain('Your keywords');
  });

  it('with the local model connected, suggests more searches, sending only the question', async () => {
    searchesMock.mockResolvedValue(['cold brew sour taste', 'cold brew sour causes']);
    render(<Harness localModel="llama3.2:3b" />);
    const row = within(rows()[0] as HTMLElement);
    await act(async () => {
      fireEvent.click(row.getByRole('button', { name: 'Suggest more searches' }));
    });
    expect(searchesMock).toHaveBeenCalledWith('Why is my cold brew sour?', 'llama3.2:3b');
    expect(row.getByText('cold brew sour taste')).toBeTruthy();
  });
});

describe('Question editor, From your list', () => {
  /** Twelve questions typed on the home, each kept as written. */
  const TWELVE = Array.from({ length: 12 }, (_, i) => `Why is cold brew batch ${i + 1} sour?`);

  it('says the list is empty, with a link to Your questions', () => {
    render(<Harness />);
    const section = fromList();
    expect(section.getByRole('heading', { name: 'From your list' })).toBeTruthy();
    expect(section.getByText(/^Your list is empty\./)).toBeTruthy();
    const link = section.getByRole('link', { name: 'Your questions' });
    expect(link.getAttribute('href')).toBe('/');
    expect(section.queryAllByRole('listitem')).toEqual([]);
  });

  it('lists up to 10 of the home list, in its order, leaving out the ones on this draft', () => {
    homeList({ keywords: ['why is my cold brew SOUR', ...TWELVE].join('\n') });
    render(<Harness />);
    // "Why is my cold brew sour?" is on the draft already (case and "?" aside).
    expect(offered()).toEqual(TWELVE.slice(0, 10));
  });

  it('adds one question per click, with its source and template, and lists the next', () => {
    homeList({ keywords: ['espresso beans', ...TWELVE].join('\n') });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(offered()[0]).toBe('What are espresso beans?');
    fireEvent.click(fromList().getByRole('button', { name: 'Add "What are espresso beans?"' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([
      ...START,
      { text: 'What are espresso beans?', source: 'keywords', template: 'what-is' },
    ]);
    // A keyword turned into a question is a keyword guess, never the reader's own.
    expect(inputKindOf(onChange.mock.lastCall?.[0].at(-1))).toBe('keyword');
    expect(inputs().at(-1)).toBe('What are espresso beans?');
    expect(rows().at(-1)?.textContent).toContain('Your keywords');
    // It leaves the offer, and the next one of the list takes its place.
    expect(offered()).toEqual(TWELVE.slice(0, 10));
    fireEvent.click(fromList().getByRole('button', { name: `Add "${TWELVE[0]}"` }));
    expect(onChange.mock.lastCall?.[0].at(-1)).toEqual({
      text: TWELVE[0],
      source: 'keywords',
      template: 'as-written',
    });
    expect(inputKindOf(onChange.mock.lastCall?.[0].at(-1))).toBe('reader');
    expect(offered()).toEqual(TWELVE.slice(1, 11));
  });

  it("keeps an export's and a local model's own source", () => {
    const queries: ImportedQuery[] = [
      { text: 'espresso grind size', source: 'search-console', impressions: 2310 },
    ];
    homeList({
      imported: { name: 'Queries.csv', queries },
      suggested: ['Is crema a sign of fresh beans?'],
    });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const [query, model] = siteQuestions({
      queries,
      suggested: ['Is crema a sign of fresh beans?'],
    });
    expect(offered()).toEqual([query?.text, model?.text]);
    fireEvent.click(fromList().getByRole('button', { name: `Add "${query?.text}"` }));
    expect(onChange.mock.lastCall?.[0].at(-1)).toEqual({
      text: query?.text,
      source: 'search-console',
      template: query?.template,
    });
    fireEvent.click(fromList().getByRole('button', { name: `Add "${model?.text}"` }));
    expect(onChange.mock.lastCall?.[0].at(-1)).toEqual({
      text: model?.text,
      source: 'local-model',
      template: 'as-written',
    });
    expect(inputKindOf(onChange.mock.lastCall?.[0].at(-1))).toBe('local-model');
  });

  it('offers the list the home shows, built from its keywords, imports and suggestions', () => {
    homeList({
      keywords: ['why is my cold brew sour', ...TWELVE.slice(0, 4)].join('\n'),
      imported: {
        name: 'Queries.csv',
        queries: [{ text: 'espresso grind size', source: 'search-console', impressions: 2310 }],
      },
      suggested: ['Is crema a sign of fresh beans?'],
    });
    render(<Harness />);
    const home = siteQuestionsOf(getSiteInput());
    expect(new Set(home.map((q) => q.source))).toEqual(
      new Set(['keywords', 'search-console', 'local-model']),
    );
    // The same list, less the one this draft already has.
    expect(home).toHaveLength(7);
    expect(offered()).toEqual(home.map((q) => q.text).filter((t) => !hasQuestion(START, t)));
    expect(offered()).toHaveLength(6);
  });

  it('follows the home list as it changes', () => {
    render(<Harness />);
    expect(offered()).toEqual([]);
    act(() => homeList({ keywords: 'Is cold brew stronger than coffee?' }));
    expect(offered()).toEqual(['Is cold brew stronger than coffee?']);
    act(() => homeList({}));
    expect(fromList().getByText(/^Your list is empty\./)).toBeTruthy();
  });

  it('says so when every question on the list is on this draft', () => {
    homeList({ keywords: 'Why is my cold brew sour?' });
    render(<Harness />);
    expect(offered()).toEqual([]);
    expect(fromList().queryByText(/Your list is empty/)).toBeNull();
    expect(fromList().getByText(/^Every question on your list is on this draft\./)).toBeTruthy();
    expect(fromList().getByRole('link', { name: 'Your questions' }).getAttribute('href')).toBe('/');
  });

  it('moves focus to the next Add button after an add, then to the heading', () => {
    homeList({ keywords: TWELVE.slice(0, 2).join('\n') });
    render(<Harness />);
    const first = fromList().getByRole('button', { name: `Add "${TWELVE[0]}"` });
    first.focus();
    fireEvent.click(first);
    expect(document.activeElement).toBe(
      fromList().getByRole('button', { name: `Add "${TWELVE[1]}"` }),
    );
    fireEvent.click(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(
      fromList().getByRole('heading', { name: 'From your list' }),
    );
  });
});

describe('Question editor, storage blocked', () => {
  it('adds from headings, from the list and by typing when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    // The home's list lives in memory for the page's lifetime.
    homeList({ keywords: 'Is cold brew stronger than coffee?' });
    render(<Harness initial={[]} />);
    fireEvent.click(panel().getByRole('button', { name: 'From headings' }));
    const headings = generateQuestions(DRAFT, { max: MAX_QUESTIONS }).map((q) => q.text);
    expect(inputs()).toEqual(headings);
    fireEvent.click(
      fromList().getByRole('button', { name: 'Add "Is cold brew stronger than coffee?"' }),
    );
    addQuestion('How long does cold brew keep?');
    expect(inputs()).toEqual([
      ...headings,
      'Is cold brew stronger than coffee?',
      'How long does cold brew keep?',
    ]);
    fireEvent.click(panel().getByRole('button', { name: 'Remove question 1' }));
    expect(inputs()).toEqual([
      ...headings.slice(1),
      'Is cold brew stronger than coffee?',
      'How long does cold brew keep?',
    ]);
  });
});
