import {
  type AnalysisResult,
  type AnalyzeOptions,
  analyze,
  CHECK_IDS,
  type CheckId,
  EVIDENCE,
  type QuestionInput,
  type QuestionLineLabels,
  type Suggestion,
  TEST_LABEL_ORDER,
  TEST_LABEL_TEXT,
  TEST_LABELS,
} from '@citation-equity/engine';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftView } from '@/components/draft/draft-view';
import { TOAST_MS } from '@/components/draft/undo-toast';
import { draftSummaryFor } from '@/lib/draft-summary';
import { fixCopy, STALE_MESSAGE } from '@/lib/fix-copy';
import { CHECK_NAMES, labelTooltip } from '@/lib/glossary';
import { setLocalModel } from '@/lib/local-model';
import { clearAll, getActiveSlot, getSummary, MY_POST_SLOT, setActiveSlot } from '@/lib/store';
import { ANALYSIS_DELAY_MS } from '@/lib/use-analysis';
import { proposeWording } from '@/lib/wording-helper';
import { DRAFT, FINDINGS, HEADING_EDIT, PARAGRAPH_ADVISORY, QUOTE_ADVISORY } from './fixtures';

/** What the fake engine proposes and labels; a case may change either, and afterEach resets them. */
const fixture = vi.hoisted(() => ({
  /** The writing notes it proposes wherever their text still sits; null for the three fixtures. */
  notes: null as Suggestion[] | null,
  /** The engine's per-input question labels, which a case may change as an E5 result could. */
  labels: {} as Record<QuestionInput, QuestionLineLabels>,
}));

// The engine proposes the fixture notes wherever their text still sits. The question checks and
// the question report are the real engine's, so the Questions covered card reads the real text.
vi.mock('@citation-equity/engine', async (importOriginal) => {
  const engine = await importOriginal<typeof import('@citation-equity/engine')>();
  const { HEADING_EDIT, QUOTE_ADVISORY, PARAGRAPH_ADVISORY, makeResult } = await import(
    './fixtures'
  );
  Object.assign(fixture.labels, engine.QUESTION_LABELS);
  return {
    ...engine,
    QUESTION_LABELS: fixture.labels,
    analyze: vi.fn((md: string, opts?: AnalyzeOptions) => {
      const real = engine.analyze(md, opts);
      const notes = (fixture.notes ?? [HEADING_EDIT, QUOTE_ADVISORY, PARAGRAPH_ADVISORY]).filter(
        (s) => md.slice(s.range.start, s.range.end) === s.before,
      );
      const fake = makeResult(md, notes);
      return {
        ...fake,
        wordCount: real.wordCount,
        checks: fake.checks.map((c) =>
          engine.QUESTION_CHECKS.includes(c.checkId)
            ? (real.checks.find((r) => r.checkId === c.checkId) ?? c)
            : c,
        ),
        questions: real.questions,
      };
    }),
  };
});

// Only the call that would reach a local server is replaced.
vi.mock('@citation-equity/bench', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@citation-equity/bench')>()),
  probeOllama: vi.fn(),
}));

/** Ranges the view asked the editor to show, and the highlights and selected ranges it last passed. */
const focused = vi.hoisted(() => [] as { start: number; end: number }[]);
const shown = vi.hoisted(() => ({
  highlights: [] as { range: { start: number }; active: boolean }[],
  selectedRanges: undefined as { start: number }[] | undefined,
}));

// CodeMirror needs layout that jsdom lacks; a textarea stands in for it.
vi.mock('@/components/editor/markdown-editor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  type Props = {
    value: string;
    onChange(v: string): void;
    ariaLabel: string;
    highlights: { range: { start: number }; active: boolean }[];
    selectedRanges?: { start: number }[];
  };
  return {
    MarkdownEditor: forwardRef<unknown, Props>(function FakeEditor(
      { value, onChange, ariaLabel, highlights, selectedRanges },
      ref,
    ) {
      shown.highlights = highlights;
      shown.selectedRanges = selectedRanges;
      useImperativeHandle(ref, () => ({
        focusRange: (r: { start: number; end: number }) => focused.push(r),
      }));
      return (
        <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
      );
    }),
  };
});

// The preview's CodeMirror merge view needs layout too; this stand-in keeps Apply and Close,
// and moves focus on close as the real dialog's onCloseAutoFocus does with `returnFocus`.
vi.mock('@/components/editor/merge-preview', () => ({
  MergePreview: ({
    suggestion,
    note,
    onApply,
    onClose,
    returnFocus,
  }: {
    suggestion: Suggestion | null;
    note?: string;
    onApply(s: Suggestion): void;
    onClose(): void;
    returnFocus?(): HTMLElement | null;
  }) =>
    suggestion && (
      <div role="dialog" aria-label="Preview">
        <p>{suggestion.after}</p>
        {note && <p>{note}</p>}
        <p>Nothing changes until you click Apply.</p>
        <button
          type="button"
          onClick={() => {
            onApply(suggestion);
            returnFocus?.()?.focus();
          }}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => {
            onClose();
            returnFocus?.()?.focus();
          }}
        >
          Close
        </button>
      </div>
    ),
}));

vi.mock('@/lib/wording-helper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wording-helper')>()),
  proposeWording: vi.fn(),
}));
vi.mock('@/lib/question-helper', () => ({ suggestWithLocalModel: vi.fn() }));

vi.mock('@/lib/samples', async () => {
  const { DRAFT } = await import('./fixtures');
  const sample = {
    slug: 'fixture',
    title: 'Fixture draft',
    topic: 'coffee',
    packId: 'x',
    before: DRAFT,
  };
  const MY_DRAFT_SLUG = 'my-draft';
  const sampleFor = (slug: string) => (slug === MY_DRAFT_SLUG ? null : sample);
  return {
    SAMPLES: [sample],
    getSample: () => sample,
    MY_DRAFT_SLUG,
    MY_DRAFT_LABEL: 'My draft',
    sampleFor,
    startingText: (slug: string) => sampleFor(slug)?.before ?? '',
    exampleLabel: () => 'Fixture',
  };
});

const engine =
  await vi.importActual<typeof import('@citation-equity/engine')>('@citation-equity/engine');
const analyzeMock = vi.mocked(analyze);
const proposeMock = vi.mocked(proposeWording);
const EDIT = fixCopy(HEADING_EDIT).title;
const QUOTE = fixCopy(QUOTE_ADVISORY).title;
/** The fixture example's questions: none of its own, so the page's own title and topic. */
const PAGE = engine.analyze(DRAFT).questions;

/** A ready edit our tests label Unclear, so it ranks before the No effect heading edit. */
const NUMBERS_EDIT: Suggestion = {
  ...PARAGRAPH_ADVISORY,
  id: 'edit0002',
  checkId: 'statistics',
  kind: 'edit',
  after: 'Bitter shots run past 30 seconds.',
  title: 'Give the number',
};

const editor = () => screen.getByLabelText<HTMLTextAreaElement>('Draft text');
const rail = () => screen.getByRole('complementary', { name: 'Questions and notes' });
const startHere = () => within(screen.getByRole('region', { name: 'Start here' }));
const questionsCard = () =>
  screen.getByRole('region', { name: /^(Questions covered: \d+ of \d+|No questions yet)$/ });
const quickEdit = () => within(screen.getByRole('region', { name: 'Quick edit' }));
/** The Quick edit's card. */
const quick = (title: string) => quickEdit().getByRole('article', { name: title });
const inQuick = (title: string, name: string | RegExp) =>
  within(quick(title)).getByRole('button', { name });
const advance = () => act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));

/** Opens Writing notes (once) and returns its body. */
function notes() {
  const toggle = screen.getByRole('button', { name: /^Writing notes/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return within(screen.getByRole('region', { name: 'Writing notes' }));
}

const groupToggle = (checkId: CheckId) =>
  notes().getByRole('button', { name: new RegExp(`^${CHECK_NAMES[checkId]}, `) });

/** Opens the group of a check in Writing notes (once) and returns the notes' body. */
function openGroup(checkId: CheckId) {
  const toggle = groupToggle(checkId);
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return notes();
}

/** A note's card, in its open group. */
const note = (s: Suggestion) => openGroup(s.checkId).getByRole('article', { name: titleOf(s) });
const noNote = (s: Suggestion) =>
  openGroup(s.checkId).queryByRole('article', { name: titleOf(s) }) === null;
const inNote = (s: Suggestion, name: string | RegExp) =>
  within(note(s)).getByRole('button', { name });
const titleOf = (s: Suggestion) => fixCopy(s, FINDINGS[s.id]).title;

/** Opens a card's overflow menu and picks one of its items. */
async function pick(card: HTMLElement, item: 'Done' | 'Skip' | 'Show me') {
  const trigger = within(card).getByRole('button', { name: /^More actions/ });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const menu = await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name: item }));
}

function preview(card: HTMLElement) {
  fireEvent.click(within(card).getByRole('button', { name: 'Preview' }));
  return within(screen.getByRole('dialog', { name: 'Preview' }));
}

/** Applies the Quick edit (the heading edit) from its preview. */
function applyEdit() {
  fireEvent.click(preview(quick(EDIT)).getByRole('button', { name: 'Apply' }));
}

const toast = () => screen.getByRole('status', { name: 'Last action' });

/** The handled row's own Undo for the heading edit, inside its group. */
const undoEditRow = () =>
  openGroup('question-headings').getByRole('button', { name: new RegExp(`^Undo: ${EDIT}`) });

/** Opens the example (the fixture sample) as the More menu would. */
function renderExample() {
  setActiveSlot('fixture');
  return render(<DraftView />);
}

/** Renders the view on fake timers and lets the analysis of the loaded draft and list run. */
function renderAnalyzed(slot = 'fixture') {
  vi.useFakeTimers();
  setActiveSlot(slot);
  const view = render(<DraftView />);
  advance();
  return view;
}

/**
 * Saves a question list for a draft, as the question editor or the home would have. The view
 * loads it after its first paint, so the card reads it once the debounced analysis has run.
 */
function saveList(draftKey: string, list: { text: string; source: string; template?: string }[]) {
  localStorage.setItem(`ce:v1:questions:${draftKey}`, JSON.stringify(list));
}

/** The chips under `root`, as [label, tooltip]. */
const chipsIn = (root: Element) =>
  [...root.querySelectorAll<HTMLElement>('[data-label-chip]')].map((el) => [
    el.dataset.labelChip,
    el.title,
  ]);

/** A pair of line labels as the chips that stand for it: one when equal, else both. */
const chipLabels = (pair: QuestionLineLabels) =>
  pair.words === pair.answer ? [pair.words] : [pair.words, pair.answer];

/** Connects the local AI from the rail's local AI row, with a model ready. */
async function connectLocalAI() {
  const { probeOllama, DEFAULT_SETTINGS } = await import('@citation-equity/bench');
  vi.mocked(probeOllama).mockResolvedValue({ reachable: true, models: [DEFAULT_SETTINGS.model] });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Connect local AI' }));
  });
}

beforeEach(() => {
  localStorage.clear();
  clearAll();
  analyzeMock.mockClear();
  proposeMock.mockReset();
  focused.length = 0;
});
afterEach(() => {
  cleanup();
  clearAll();
  setLocalModel(null);
  fixture.notes = null;
  Object.assign(fixture.labels, engine.QUESTION_LABELS);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Draft view, first paint', () => {
  it('opens a new visitor on the empty My post, never the example', () => {
    render(<DraftView />);
    expect(editor().value).toBe('');
    expect(analyzeMock.mock.calls.every(([md]) => md === '')).toBe(true);
    expect(screen.getByText('No content yet')).toBeTruthy();
  });

  it('prerenders the empty My post, with no example text in the HTML', () => {
    setActiveSlot('fixture');
    const html = renderToString(<DraftView />);
    expect(html).not.toContain('Espresso');
    expect(html).not.toContain(EDIT);
  });

  it('analyzes a loaded draft and its questions at once, not after the typing debounce', () => {
    localStorage.setItem('ce:v1:draft:my-draft', DRAFT);
    saveList('my-draft', [{ text: 'Why does espresso turn bitter?', source: 'user' }]);
    vi.useFakeTimers();
    render(<DraftView />);
    // No timer has run: the card already reads the saved draft and its one question.
    expect(within(questionsCard()).getByRole('heading', { level: 3 }).textContent).toBe(
      'Questions covered: 0 of 1',
    );
    expect(screen.queryByRole('heading', { name: 'No questions yet' })).toBeNull();
  });

  it('opens the example the store names, and follows a later change (the More menu)', () => {
    renderExample();
    expect(editor().value).toBe(DRAFT);
    expect(analyzeMock.mock.calls[0]?.[0]).toBe(DRAFT);
    act(() => setActiveSlot(MY_POST_SLOT));
    expect(editor().value).toBe('');
  });

  it('switches between the example and My post from the view itself', () => {
    renderExample();
    expect(getSummary('draft')).toMatchObject({ slot: 'fixture', example: true });
    fireEvent.click(screen.getByRole('button', { name: 'Paste my post' }));
    expect(getActiveSlot()).toBe(MY_POST_SLOT);
    // The empty My post has nothing to measure, so the example's summary does not linger.
    expect(getSummary('draft')).toBeNull();
    expect(editor().value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Use the example instead' }));
    expect(getActiveSlot()).toBe('fixture');
    expect(editor().value).toBe(DRAFT);
  });
});

describe('Draft view, the rail', () => {
  it('runs Start here (the card, then the Quick edit), Writing notes, the Test it link, the local AI row', () => {
    renderExample();
    const section = screen.getByRole('region', { name: 'Start here' });
    expect(section.id).toBe('start-here');
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe('Start here');
    expect(
      startHere()
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([`Questions covered: ${PAGE.covered} of ${PAGE.rows.length}`, 'Quick edit', EDIT]);
    const order = [
      section,
      screen.getByRole('button', { name: /^Writing notes/ }),
      screen.getByRole('link', { name: 'Test it' }),
      screen.getByRole('button', { name: 'Connect local AI' }),
    ];
    for (const el of order) expect(rail().contains(el)).toBe(true);
    for (const [a, b] of order.slice(1).map((el, i) => [order[i], el] as const)) {
      expect((a as Node).compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it('shows no score, weights, baseline or handled count, with everything open', async () => {
    renderExample();
    applyEdit();
    await pick(note(QUOTE_ADVISORY), 'Skip');
    for (const toggle of notes().getAllByRole('button', { expanded: false }))
      fireEvent.click(toggle);
    fireEvent.click(within(questionsCard()).getByRole('button', { name: 'Add questions' }));
    const text = document.body.textContent ?? '';
    for (const gone of ['AI-ready', 'Scoring', 'Adjust weights', 'since you started', 'All fixes'])
      expect(text).not.toContain(gone);
    expect(text).not.toMatch(/\d+ of \d+ handled/);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('ce:v1:baseline:'))).toEqual([]);
  });

  it('links to Did it change anything with Test it, and holds no Test it section', () => {
    renderExample();
    expect(rail().textContent).toContain('Did it change anything?');
    expect(screen.getByRole('link', { name: 'Test it' }).getAttribute('href')).toMatch(
      /\/cited\/?#test$/,
    );
    expect(screen.queryByRole('button', { name: /^Test it/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Test it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run test' })).toBeNull();
  });

  it('carries the Start here anchor and scrolls to it when the URL asks', () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    window.history.replaceState(null, '', '#start-here');
    try {
      renderExample();
      const section = screen.getByRole('region', { name: 'Start here' });
      expect(section.id).toBe('start-here');
      expect(scrolled).toEqual([section]);
      // Once only: later renders (a Show) do not pull the page back.
      fireEvent.click(
        within(questionsCard()).getByRole('button', {
          name: `Show where: answer, "${PAGE.rows[0]?.question}"`,
        }),
      );
      expect(scrolled).toHaveLength(1);
    } finally {
      window.history.replaceState(null, '', window.location.pathname);
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('does not scroll to Start here without the anchor in the URL', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      renderExample();
      expect(screen.getByRole('region', { name: 'Start here' }).id).toBe('start-here');
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('says what shows up here on an empty draft, and how many questions are waiting', () => {
    render(<DraftView />);
    expect(screen.getByText('No content yet')).toBeTruthy();
    expect(
      screen.getByText('Paste or type your post. Your questions and notes show up here.'),
    ).toBeTruthy();
    expect(screen.queryByText(/waiting\.$/)).toBeNull();
    cleanup();
    saveList(
      'my-draft',
      [
        'Why does espresso turn bitter?',
        'How long should a shot take?',
        'What grind is best?',
        'Is a darker roast more bitter?',
      ].map((text) => ({ text, source: 'user' })),
    );
    render(<DraftView />);
    expect(screen.getByText('4 questions are waiting.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use the example instead' })).toBeTruthy();
    cleanup();
    saveList('my-draft', [{ text: 'How long should a shot take?', source: 'user' }]);
    render(<DraftView />);
    expect(screen.getByText('1 question is waiting.')).toBeTruthy();
  });
});

describe('Draft view, Questions covered', () => {
  it("measures the page's own questions when the draft has none, each with its two lines", () => {
    renderExample();
    const card = within(questionsCard());
    expect(PAGE.from).toBe('page');
    expect(card.getByRole('heading', { level: 3 }).textContent).toBe(
      `Questions covered: ${PAGE.covered} of ${PAGE.rows.length}`,
    );
    expect(card.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(
      PAGE.rows.map((r) => r.question),
    );
    expect(card.getByText("From your title. Add your readers' own.")).toBeTruthy();
    for (const row of PAGE.rows) {
      const message = row.answer.message;
      if (message !== null) expect(card.getAllByText(message).length).toBeGreaterThan(0);
    }
  });

  it('selects the range a card row points at when its Show is pressed', () => {
    renderExample();
    const [first] = PAGE.rows;
    if (!first) throw new Error('no page question');
    fireEvent.click(
      within(questionsCard()).getByRole('button', {
        name: `Show where: answer, "${first.question}"`,
      }),
    );
    expect(focused.at(-1)).toEqual(first.answer.range);
    // The Show selects the passage only: no fix is active, nothing is underlined.
    expect(shown.highlights).toEqual([]);
  });

  it("chips the example's pack questions with the reader's label, and the card tooltip", () => {
    saveList('fixture', [
      { text: 'Why does espresso turn bitter?', source: 'sample-pack' },
      { text: 'How long should a shot take?', source: 'sample-pack' },
    ]);
    renderAnalyzed();
    const pair = engine.QUESTION_LABELS.reader;
    expect(chipsIn(questionsCard())).toEqual(
      chipLabels(pair).map((label) => [
        label,
        labelTooltip(label, { card: true, input: 'reader' }),
      ]),
    );
    expect(questionsCard().textContent).toContain(TEST_LABEL_TEXT[pair.words]);
    expect(within(questionsCard()).getByRole('button', { name: 'Edit questions' })).toBeTruthy();
  });

  it('chips a My post on the page fallback Not tested, saying the question came from the page', () => {
    localStorage.setItem('ce:v1:draft:my-draft', DRAFT);
    renderAnalyzed(MY_POST_SLOT);
    const pair = engine.QUESTION_LABELS.page;
    expect(chipsIn(questionsCard())).toEqual(
      chipLabels(pair).map((label) => [label, labelTooltip(label, { card: true, input: 'page' })]),
    );
    expect(pair).toEqual({ words: 'not-tested', answer: 'not-tested' });
    expect(within(questionsCard()).getByRole('button', { name: 'Add questions' })).toBeTruthy();
  });

  it("gives a keyword question its own chip in a list of the reader's own", () => {
    saveList('fixture', [
      { text: 'Why does espresso turn bitter?', source: 'user' },
      { text: 'espresso shot time', source: 'keywords' },
    ]);
    renderAnalyzed();
    const card = questionsCard();
    const keyword = within(card).getByRole('article', { name: 'espresso shot time' });
    const [readerChips, keywordChips] = [
      engine.QUESTION_LABELS.reader,
      engine.QUESTION_LABELS.keyword,
    ];
    expect(chipsIn(keyword).map(([label]) => label)).toEqual(
      readerChips.words === keywordChips.words && readerChips.answer === keywordChips.answer
        ? []
        : chipLabels(keywordChips),
    );
    expect(chipsIn(keyword)[0]?.[1]).toBe(labelTooltip(keywordChips.words, { input: 'keyword' }));
  });

  it('finds each row by its question, never by its place, while the analysis catches up', () => {
    saveList('fixture', [
      { text: 'Why does espresso turn bitter?', source: 'user' },
      { text: 'espresso shot time', source: 'keywords' },
      { text: 'How long should a shot take?', source: 'user' },
    ]);
    renderAnalyzed();
    fireEvent.click(within(questionsCard()).getByRole('button', { name: 'Edit questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove question 2' }));
    // The analysis still shows the removed keyword question; it is not on the list, so it reads
    // Not tested rather than taking the next question's label.
    const removed = within(questionsCard()).getByRole('article', { name: 'espresso shot time' });
    expect(chipsIn(removed).map(([label]) => label)).toEqual(['not-tested']);
    const last = within(questionsCard()).getByRole('article', {
      name: 'How long should a shot take?',
    });
    expect(chipsIn(last)).toEqual([]);
    advance();
    expect(
      within(questionsCard()).queryByRole('article', { name: 'espresso shot time' }),
    ).toBeNull();
  });

  it('shows two line chips when the labels differ, and only the answer chip on a row with no key words', () => {
    fixture.labels.reader = { words: 'helped', answer: 'may-help-less' };
    saveList('fixture', [
      { text: 'How long should a shot take?', source: 'user' },
      { text: 'How does it work?', source: 'user' },
    ]);
    renderAnalyzed();
    const card = questionsCard();
    const noWords = within(card).getByRole('article', { name: 'How does it work?' });
    const first = within(card).getByRole('article', { name: 'How long should a shot take?' });
    // The card's chips stand for the first row; the row with no key words shows its answer's.
    expect(chipsIn(first)).toEqual([]);
    expect(
      chipsIn(card)
        .slice(0, 2)
        .map(([label]) => label),
    ).toEqual(['helped', 'may-help-less']);
    expect(chipsIn(noWords).map(([label]) => label)).toEqual(['may-help-less']);
    // It has no words line at all: neither "Words up top" nor "Missing up top".
    expect(noWords.textContent).not.toMatch(/up top/);
  });

  it('Edit questions opens a region holding the question editor, and closes it again', () => {
    saveList('fixture', [{ text: 'Why does espresso turn bitter?', source: 'user' }]);
    renderAnalyzed();
    const toggle = within(questionsCard()).getByRole('button', { name: 'Edit questions' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'New question' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const region = within(questionsCard()).getByRole('region', { name: 'Edit questions' });
    expect(within(region).getByRole('textbox', { name: 'New question' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole('textbox', { name: 'New question' })).toBeNull();
  });

  it('Add questions opens the editor on the page fallback too', () => {
    renderExample();
    fireEvent.click(within(questionsCard()).getByRole('button', { name: 'Add questions' }));
    const region = within(questionsCard()).getByRole('region', { name: 'Add questions' });
    expect(within(region).getByRole('textbox', { name: 'New question' })).toBeTruthy();
  });

  it("offers Suggest wording on the draft's own questions after Connect local AI, rewriting the answer passage", async () => {
    saveList('fixture', [{ text: 'Why does espresso turn bitter?', source: 'user' }]);
    proposeMock.mockImplementation(async (s) => ({
      ...s,
      kind: 'edit',
      after: 'Espresso turns bitter when the shot runs long and pulls out too much.',
    }));
    renderAnalyzed();
    expect(screen.queryByRole('button', { name: 'Suggest wording' })).toBeNull();
    await connectLocalAI();
    const row = within(questionsCard()).getByRole('article', {
      name: 'Why does espresso turn bitter?',
    });
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Suggest wording' }));
    });
    const report = engine.analyze(DRAFT, {
      questions: ['Why does espresso turn bitter?'],
    }).questions;
    const range = report.rows[0]?.answerRange;
    if (!range) throw new Error('no answer range');
    const [asked] = proposeMock.mock.calls.at(-1) ?? [];
    expect(asked).toMatchObject({
      checkId: 'question-coverage',
      kind: 'advisory',
      range,
      before: DRAFT.slice(range.start, range.end),
      title: 'Answer "Why does espresso turn bitter?" directly',
    });
    const dialog = within(screen.getByRole('dialog', { name: 'Preview' }));
    expect(editor().value).toBe(DRAFT);
    fireEvent.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(editor().value).toBe(
      DRAFT.replace(
        'Bitter shots run long.',
        'Espresso turns bitter when the shot runs long and pulls out too much.',
      ),
    );
    // Undo in the toast puts the sentence back.
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(editor().value).toBe(DRAFT);
  });

  it('offers Suggest wording on each unanswered page question after Connect local AI', async () => {
    renderExample();
    expect(within(questionsCard()).queryAllByRole('button', { name: 'Suggest wording' })).toEqual(
      [],
    );
    await connectLocalAI();
    // The answer check measures the page's own questions too, so each unanswered one has advice.
    const open = PAGE.rows.filter((r) => !r.answer.covered).map((r) => r.question);
    expect(open.length).toBeGreaterThan(0);
    const offered = within(questionsCard())
      .getAllByRole('article')
      .filter((a) => within(a).queryByRole('button', { name: 'Suggest wording' }) !== null)
      .map((a) => a.getAttribute('aria-label'));
    expect(offered).toEqual(open);
    // The notes still offer it.
    expect(inNote(PARAGRAPH_ADVISORY, 'Suggest wording')).toBeTruthy();
  });

  it('writes the answer as a paragraph of its own under a heading with no prose', async () => {
    const md =
      '# Espresso\n\n## How long should a shot take?\n\n## Grind\n\nGrind fine for an even shot every time.\n';
    localStorage.setItem('ce:v1:draft:my-draft', md);
    saveList('my-draft', [{ text: 'How long should a shot take?', source: 'user' }]);
    proposeMock.mockImplementation(async (s) => ({
      ...s,
      kind: 'edit',
      after: 'A shot should take about half a minute.',
    }));
    renderAnalyzed(MY_POST_SLOT);
    await connectLocalAI();
    await act(async () => {
      fireEvent.click(within(questionsCard()).getByRole('button', { name: 'Suggest wording' }));
    });
    expect(proposeMock.mock.calls.at(-1)?.[0]).toMatchObject({ before: '' });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Preview' })).getByRole('button', {
        name: 'Apply',
      }),
    );
    expect(editor().value).toBe(
      '# Espresso\n\n## How long should a shot take?\n\nA shot should take about half a minute.\n\n## Grind\n\nGrind fine for an even shot every time.\n',
    );
  });

  /** A My post whose question matches a heading with no prose under it, saved with its list. */
  function saveShotDraft(md: string) {
    localStorage.setItem('ce:v1:draft:my-draft', md);
    saveList('my-draft', [{ text: 'How long should a shot take?', source: 'user' }]);
  }

  /** Holds the local AI's answer until `answer()`, so a case can type while it works. */
  function holdAnswer(after: string) {
    let answer = () => {};
    proposeMock.mockImplementation(
      (s) =>
        new Promise<Suggestion>((resolve) => {
          answer = () => resolve({ ...s, kind: 'edit', after });
        }),
    );
    return () => act(async () => answer());
  }

  const SHOT =
    '# Espresso\n\n## How long should a shot take?\n\n## Grind\n\nGrind fine for an even shot every time.\n';
  const SHOT_ANSWERED = SHOT.replace(
    'take?\n\n',
    'take?\n\nA shot should take about half a minute.\n\n',
  );
  const applyPreview = () =>
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Preview' })).getByRole('button', {
        name: 'Apply',
      }),
    );

  it('moves the answer through text typed above its spot while the local AI works', async () => {
    saveShotDraft(SHOT);
    const answer = holdAnswer('A shot should take about half a minute.');
    renderAnalyzed(MY_POST_SLOT);
    await connectLocalAI();
    await act(async () => {
      fireEvent.click(within(questionsCard()).getByRole('button', { name: 'Suggest wording' }));
    });
    // The author types at the top while the model works, and the analysis catches up.
    fireEvent.change(editor(), { target: { value: `Intro. ${SHOT}` } });
    advance();
    await answer();
    applyPreview();
    expect(editor().value).toBe(`Intro. ${SHOT_ANSWERED}`);
  });

  it('refuses the answer as out of date when the author wrote at its spot meanwhile', async () => {
    saveShotDraft(SHOT);
    const answer = holdAnswer('A shot should take about half a minute.');
    renderAnalyzed(MY_POST_SLOT);
    await connectLocalAI();
    await act(async () => {
      fireEvent.click(within(questionsCard()).getByRole('button', { name: 'Suggest wording' }));
    });
    const typed = SHOT.replace('take?\n\n', 'take?\n\nAbout 30 seconds.\n\n');
    fireEvent.change(editor(), { target: { value: typed } });
    advance();
    await answer();
    applyPreview();
    expect(editor().value).toBe(typed);
    expect(screen.getByText(STALE_MESSAGE)).toBeTruthy();
  });

  it("lets an answer on an empty spot use its section's facts, and refuses one that adds a figure", async () => {
    const md =
      '# Espresso\n\n## How long should a shot take?\n\n- 25 to 30 seconds\n- Stop at 40 g\n\n## Grind\n\nGrind fine for an even shot every time.\n';
    saveShotDraft(md);
    // The real helper, with only the model's reply faked.
    const helper =
      await vi.importActual<typeof import('@/lib/wording-helper')>('@/lib/wording-helper');
    let reply = 'A shot should take 20 seconds.';
    proposeMock.mockImplementation((s, section, _adapter, model) =>
      helper.proposeWording(s, section, { name: 'fake', generate: async () => reply }, model),
    );
    renderAnalyzed(MY_POST_SLOT);
    await connectLocalAI();
    const row = () =>
      within(questionsCard()).getByRole('article', { name: 'How long should a shot take?' });
    await act(async () => {
      fireEvent.click(within(row()).getByRole('button', { name: 'Suggest wording' }));
    });
    expect(within(row()).getByRole('status').textContent).toMatch(/added a number/);
    expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeNull();

    reply = 'A shot should take 25 to 30 seconds.';
    await act(async () => {
      fireEvent.click(within(row()).getByRole('button', { name: 'Suggest wording' }));
    });
    applyPreview();
    expect(editor().value).toBe(
      md.replace('take?\n\n', 'take?\n\nA shot should take 25 to 30 seconds.\n\n'),
    );
  });

  it('shows a local AI failure in the row where Suggest wording ran', async () => {
    saveList('fixture', [{ text: 'Why does espresso turn bitter?', source: 'user' }]);
    proposeMock.mockRejectedValue(new Error('the model stopped'));
    renderAnalyzed();
    await connectLocalAI();
    const row = () =>
      within(questionsCard()).getByRole('article', { name: 'Why does espresso turn bitter?' });
    await act(async () => {
      fireEvent.click(within(row()).getByRole('button', { name: 'Suggest wording' }));
    });
    expect(within(row()).getByRole('status').textContent).toContain('the model stopped');
    expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeNull();
  });
});

describe('Draft view, Quick edit', () => {
  it('holds the first ready edit with its label chip; Preview only, Apply only inside the preview', () => {
    renderExample();
    const card = quick(EDIT);
    const label = TEST_LABELS['question-headings'];
    expect(chipsIn(card)).toEqual([
      [label, labelTooltip(label, { e1: EVIDENCE['question-headings'].e1.label })],
    ]);
    expect(within(card).getByText(fixCopy(HEADING_EDIT).reason)).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Show me' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    const dialog = preview(card);
    expect(dialog.getByText('Nothing changes until you click Apply.')).toBeTruthy();
    expect(editor().value).toBe(DRAFT);
    expect(screen.getAllByRole('button', { name: 'Apply' })).toHaveLength(1);
  });

  it('applies from the preview, then Undo in the toast restores the text', () => {
    renderExample();
    applyEdit();
    expect(editor().value).toContain('## Why does espresso turn bitter?');
    expect(toast().textContent).toContain('Applied');
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(editor().value).toBe(DRAFT);
    expect(quick(EDIT)).toBeTruthy();
  });

  it('brings up the next ready edit after Apply, Done or Skip', async () => {
    fixture.notes = [HEADING_EDIT, QUOTE_ADVISORY, PARAGRAPH_ADVISORY, NUMBERS_EDIT];
    renderExample();
    const NUMBERS = titleOf(NUMBERS_EDIT);
    // The Unclear edit ranks before the No effect one.
    expect(
      quickEdit()
        .getAllByRole('article')
        .map((a) => a.getAttribute('data-fix')),
    ).toEqual([NUMBERS_EDIT.id]);
    fireEvent.click(preview(quick(NUMBERS)).getByRole('button', { name: 'Apply' }));
    expect(editor().value).toContain('Bitter shots run past 30 seconds.');
    expect(quick(EDIT)).toBeTruthy();
    await pick(quick(EDIT), 'Done');
    expect(screen.queryByRole('region', { name: 'Quick edit' })).toBeNull();
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    await pick(quick(EDIT), 'Skip');
    expect(screen.queryByRole('region', { name: 'Quick edit' })).toBeNull();
  });

  it('is not shown when the draft has no ready edit', () => {
    fixture.notes = [QUOTE_ADVISORY, PARAGRAPH_ADVISORY];
    renderExample();
    expect(screen.getByRole('region', { name: 'Start here' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Quick edit' })).toBeNull();
    expect(startHere().queryByRole('button', { name: 'Preview' })).toBeNull();
    // The advice is still in Writing notes.
    expect(note(QUOTE_ADVISORY)).toBeTruthy();
  });
});

describe('Draft view, phone layout', () => {
  const panes = () => screen.getByRole('group', { name: 'Draft or questions' });
  const paneButton = (name: RegExp) => within(panes()).getByRole('button', { name });
  const bar = () => screen.getByRole('region', { name: 'Selected fix' });
  const back = () => within(bar()).getByRole('button', { name: 'Back to questions and notes' });
  /** What a phone hides: the editor's paper (the title stays) or the rail. */
  const editorColumn = () => editor().parentElement as HTMLElement;
  const notCovered = PAGE.rows.length - PAGE.covered;

  it('has no switch on an empty draft, so the editor and the empty rail both show', () => {
    render(<DraftView />);
    expect(screen.queryByRole('group', { name: 'Draft or questions' })).toBeNull();
    expect(editorColumn().className).not.toContain('max-lg:hidden');
    expect(rail().className).not.toContain('max-lg:hidden');
  });

  it('opens a draft with content on Questions, with the not-covered count, and switches to Draft', () => {
    renderExample();
    expect(notCovered).toBeGreaterThan(0);
    const questions = paneButton(/^Questions/);
    expect(questions.getAttribute('aria-pressed')).toBe('true');
    expect(questions.textContent).toBe(`Questions${notCovered}, ${notCovered} not covered`);
    expect(editorColumn().className).toContain('max-lg:hidden');
    expect(rail().className).not.toContain('max-lg:hidden');

    fireEvent.click(paneButton(/^Draft/));
    expect(paneButton(/^Draft/).getAttribute('aria-pressed')).toBe('true');
    expect(paneButton(/^Questions/).getAttribute('aria-pressed')).toBe('false');
    expect(editorColumn().className).not.toContain('max-lg:hidden');
    expect(rail().className).toContain('max-lg:hidden');
  });

  it('shows no badge once every question is covered', () => {
    const md =
      '# Espresso\n\n## How long should a shot take?\n\nA good espresso shot should take 25 to 30 seconds in total.\n';
    expect(
      engine.analyze(md, { questions: ['How long should a shot take?'] }).questions.covered,
    ).toBe(1);
    localStorage.setItem('ce:v1:draft:my-draft', md);
    saveList('my-draft', [{ text: 'How long should a shot take?', source: 'user' }]);
    renderAnalyzed(MY_POST_SLOT);
    expect(paneButton(/^Questions/).textContent).toBe('Questions');
  });

  it('a Show from a card row switches to the draft, with the question in the bar and only Back', async () => {
    renderExample();
    const [first] = PAGE.rows;
    if (!first) throw new Error('no page question');
    fireEvent.click(
      within(questionsCard()).getByRole('button', {
        name: `Show where: answer, "${first.question}"`,
      }),
    );
    expect(focused.at(-1)).toEqual(first.answer.range);
    expect(paneButton(/^Draft/).getAttribute('aria-pressed')).toBe('true');
    expect(within(bar()).getByText(first.question)).toBeTruthy();
    expect(within(bar()).getAllByRole('button')).toEqual([back()]);
    expect(back().textContent).toBe('Back');
    fireEvent.click(back());
    await nextFrame();
    expect(paneButton(/^Questions/).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
    expect(document.activeElement).toBe(paneButton(/^Questions/));
  });

  it('Show me on a note jumps to the passage and shows a bar with Done and Back', () => {
    renderExample();
    expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
    fireEvent.click(inNote(QUOTE_ADVISORY, 'Show me'));
    expect(focused.at(-1)).toEqual(QUOTE_ADVISORY.range);
    expect(paneButton(/^Draft/).getAttribute('aria-pressed')).toBe('true');
    expect(within(bar()).getByText(QUOTE)).toBeTruthy();
    expect(within(bar()).queryByRole('button', { name: 'Preview' })).toBeNull();

    fireEvent.click(within(bar()).getByRole('button', { name: 'Done' }));
    expect(noNote(QUOTE_ADVISORY)).toBe(true);
    expect(toast().textContent).toContain('Done');
    expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
  });

  it("the Quick edit's Show me (in its overflow) offers Preview in the bar, and Apply stays in the preview", async () => {
    renderExample();
    await pick(quick(EDIT), 'Show me');
    expect(focused.at(-1)).toEqual(HEADING_EDIT.range);
    expect(within(bar()).queryByRole('button', { name: 'Done' })).toBeNull();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Preview' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Preview' }));
    expect(editor().value).toBe(DRAFT);
    fireEvent.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(editor().value).toContain('## Why does espresso turn bitter?');
    expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
  });

  it('closes the bar, never empty, when the jumped fix leaves the list', () => {
    renderExample();
    fireEvent.click(inNote(QUOTE_ADVISORY, 'Show me'));
    expect(within(bar()).getByText(QUOTE)).toBeTruthy();
    // Rewording the passage fixes it: the next analysis no longer proposes that fix.
    vi.useFakeTimers();
    const { start, end } = QUOTE_ADVISORY.range;
    fireEvent.change(editor(), {
      target: { value: `${DRAFT.slice(0, start)}Reworded.${DRAFT.slice(end)}` },
    });
    advance();
    expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
  });

  it('shows no bar on a desktop layout, and clears a jump when the window widens', () => {
    const listeners = new Set<() => void>();
    const mq = {
      matches: true,
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    };
    const matchMedia = vi.fn(() => mq);
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      renderExample();
      fireEvent.click(inNote(QUOTE_ADVISORY, 'Show me'));
      expect(focused.at(-1)).toEqual(QUOTE_ADVISORY.range);
      expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
      // A phone width, a jump, then the window widens past the phone layout.
      mq.matches = false;
      fireEvent.click(paneButton(/^Questions/));
      fireEvent.click(inNote(QUOTE_ADVISORY, 'Show me'));
      expect(bar()).toBeTruthy();
      mq.matches = true;
      act(() => {
        for (const f of listeners) f();
      });
      expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Back returns to the rail and closes the bar', () => {
    renderExample();
    fireEvent.click(inNote(QUOTE_ADVISORY, 'Show me'));
    fireEvent.click(back());
    expect(paneButton(/^Questions/).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
    expect(rail().className).not.toContain('max-lg:hidden');
  });

  /** Runs the frame a bar action schedules its focus in. */
  const nextFrame = () =>
    act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  it("Back moves focus to the card's main button, not to the page", async () => {
    renderExample();
    fireEvent.click(inNote(QUOTE_ADVISORY, 'Show me'));
    fireEvent.click(back());
    await nextFrame();
    expect(document.activeElement).toBe(inNote(QUOTE_ADVISORY, 'Show me'));
  });

  it("the bar's Done moves focus to the switch's Questions button", async () => {
    renderExample();
    fireEvent.click(inNote(QUOTE_ADVISORY, 'Show me'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Done' }));
    await nextFrame();
    expect(document.activeElement).toBe(paneButton(/^Questions/));
  });

  for (const close of ['Close', 'Apply'] as const) {
    it(`the bar's Preview returns focus to the switch's Questions button on ${close}`, async () => {
      renderExample();
      await pick(quick(EDIT), 'Show me');
      fireEvent.click(within(bar()).getByRole('button', { name: 'Preview' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Preview' }));
      fireEvent.click(dialog.getByRole('button', { name: close }));
      expect(document.activeElement).toBe(paneButton(/^Questions/));
    });
  }

  it("a card's own Preview leaves focus to the dialog's default", () => {
    renderExample();
    const dialog = preview(quick(EDIT));
    const before = document.activeElement;
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(before);
  });
});

describe('Draft view, Writing notes', () => {
  /** Note checks in the order Writing notes lists them: by label, then registry order. */
  const inLabelOrder = (ids: CheckId[]) =>
    [...ids].sort(
      (a, b) =>
        TEST_LABEL_ORDER.indexOf(TEST_LABELS[a]) - TEST_LABEL_ORDER.indexOf(TEST_LABELS[b]) ||
        CHECK_IDS.indexOf(a) - CHECK_IDS.indexOf(b),
    );
  const FIXTURE_CHECKS = inLabelOrder([
    HEADING_EDIT.checkId,
    QUOTE_ADVISORY.checkId,
    PARAGRAPH_ADVISORY.checkId,
  ]);

  it('is collapsed by default, with the open notes count, and marks nothing on load', () => {
    renderExample();
    const toggle = screen.getByRole('button', { name: /^Writing notes/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('3');
    expect(screen.queryByRole('region', { name: 'Writing notes' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'All fixes' })).toBeNull();
    expect(shown.highlights).toEqual([]);
    expect(shown.selectedRanges ?? []).toEqual([]);
  });

  it('opened, says each note carries a label, then lists the groups in label order with their chips', () => {
    renderExample();
    const body = notes();
    expect(body.getByText('Each note carries a label from our tests.')).toBeTruthy();
    expect(
      body
        .getAllByRole('button', { name: /, (\d+ notes?|done)$/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(FIXTURE_CHECKS.map((id) => `${CHECK_NAMES[id]}, 1 note`));
    const region = screen.getByRole('region', { name: 'Writing notes' });
    expect(chipsIn(region)).toEqual(
      FIXTURE_CHECKS.map((id) => [
        TEST_LABELS[id],
        labelTooltip(TEST_LABELS[id], { e1: EVIDENCE[id].e1.label }),
      ]),
    );
    expect(region.textContent).not.toMatch(/evidence|Untested/i);
  });

  it('opens a group and underlines its passages', () => {
    renderExample();
    const toggle = groupToggle('expert-quotes');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // The editor draws only active highlights, so a group's passages go through selectedRanges.
    expect(shown.highlights).toEqual([]);
    expect(shown.selectedRanges?.map((r) => r.start)).toEqual([QUOTE_ADVISORY.range.start]);
  });

  it('underlines the selected note as the active highlight, not as a group range', () => {
    renderExample();
    fireEvent.click(inNote(QUOTE_ADVISORY, 'Show me'));
    expect(shown.highlights).toEqual([
      { range: QUOTE_ADVISORY.range, checkId: 'expert-quotes', active: true },
    ]);
    expect(shown.selectedRanges ?? []).toEqual([]);
  });

  it('offers Preview on an edit note and Show me on advice', () => {
    renderExample();
    expect(within(note(HEADING_EDIT)).getByRole('button', { name: 'Preview' })).toBeTruthy();
    expect(within(note(HEADING_EDIT)).queryByRole('button', { name: 'Show me' })).toBeNull();
    expect(inNote(QUOTE_ADVISORY, 'Show me')).toBeTruthy();
    expect(within(note(QUOTE_ADVISORY)).queryByRole('button', { name: 'Preview' })).toBeNull();
  });

  it('Done and Skip hide a note, and Undo puts it back', async () => {
    renderExample();
    await pick(note(QUOTE_ADVISORY), 'Done');
    expect(noNote(QUOTE_ADVISORY)).toBe(true);
    expect(groupToggle('expert-quotes').getAttribute('aria-label')).toBe(
      `${CHECK_NAMES['expert-quotes']}, done`,
    );
    expect(toast().textContent).toContain('Done');
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(note(QUOTE_ADVISORY)).toBeTruthy();

    await pick(note(PARAGRAPH_ADVISORY), 'Skip');
    expect(noNote(PARAGRAPH_ADVISORY)).toBe(true);
    expect(toast().textContent).toContain('Skipped');
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(note(PARAGRAPH_ADVISORY)).toBeTruthy();
  });

  it('lists handled notes in their group with an Undo that lasts after the toast', async () => {
    renderExample();
    await pick(note(QUOTE_ADVISORY), 'Skip');
    fireEvent.click(
      openGroup('expert-quotes').getByRole('button', { name: new RegExp(`^Undo: ${QUOTE}`) }),
    );
    expect(note(QUOTE_ADVISORY)).toBeTruthy();
  });

  it("ends an open group on Learn more, linking that check's section of Research", () => {
    renderExample();
    const group = openGroup('expert-quotes');
    const link = group.getByRole('link', { name: `Learn more: ${CHECK_NAMES['expert-quotes']}` });
    expect(link.getAttribute('href')).toMatch(/\/research\/?#check-expert-quotes$/);
  });

  it('renders no bulk action anywhere, with every group and the editor open', () => {
    renderExample();
    for (const toggle of notes().getAllByRole('button', { expanded: false }))
      fireEvent.click(toggle);
    fireEvent.click(within(questionsCard()).getByRole('button', { name: 'Add questions' }));
    const labels = [...screen.getAllByRole('button'), ...screen.queryAllByRole('menuitem')].map(
      (b) => b.textContent ?? '',
    );
    expect(labels.filter((t) => /\b(all|every)\b/i.test(t))).toEqual([]);
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
  });
});

describe('Draft view, the draft text', () => {
  it('does not persist applied statuses, so a reload never hides a suggestion', async () => {
    const first = renderExample();
    applyEdit();
    await pick(note(QUOTE_ADVISORY), 'Skip');
    first.unmount();
    expect(JSON.parse(localStorage.getItem('ce:v1:statuses:fixture') ?? '{}')).toEqual({
      [QUOTE_ADVISORY.id]: 'ignored',
    });
    localStorage.setItem('ce:v1:draft:fixture', DRAFT);
    localStorage.setItem(
      'ce:v1:statuses:fixture',
      JSON.stringify({ [HEADING_EDIT.id]: 'applied' }),
    );
    render(<DraftView />);
    expect(inQuick(EDIT, 'Preview')).toBeTruthy();
  });

  it('marks a fix out of date instead of clobbering an edited range', () => {
    renderExample();
    const at = HEADING_EDIT.range.start + 5;
    const edited = `${DRAFT.slice(0, at)}X${DRAFT.slice(at + 1)}`;
    const dialog = preview(quick(EDIT));
    fireEvent.change(editor(), { target: { value: edited } });
    const callsBefore = analyzeMock.mock.calls.length;
    fireEvent.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(editor().value).toBe(edited);
    expect(analyzeMock.mock.calls.length).toBe(callsBefore + 1);
    expect(analyzeMock.mock.calls.at(-1)?.[0]).toBe(edited);
    expect(screen.getByText('Out of date: the text changed.')).toBeTruthy();
  });

  it('marks a note out of date when Apply from its group finds its text edited; Dismiss clears it', () => {
    renderExample();
    const at = HEADING_EDIT.range.start + 5;
    const edited = `${DRAFT.slice(0, at)}X${DRAFT.slice(at + 1)}`;
    const dialog = preview(note(HEADING_EDIT));
    fireEvent.change(editor(), { target: { value: edited } });
    fireEvent.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(editor().value).toBe(edited);
    const line = screen.getByText(STALE_MESSAGE).closest('p') as HTMLElement;
    fireEvent.click(within(line).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(STALE_MESSAGE)).toBeNull();
  });

  it('applies at the moved range when the author typed elsewhere within the debounce', () => {
    renderExample();
    fireEvent.change(editor(), { target: { value: `Intro.\n\n${DRAFT}` } });
    applyEdit();
    expect(editor().value).toBe(
      `Intro.\n\n${DRAFT.replace('## Why espresso turns bitter', HEADING_EDIT.after ?? '')}`,
    );
  });

  it('offers an applied fix again when its text comes back, e.g. after Cmd-Z', () => {
    vi.useFakeTimers();
    renderExample();
    applyEdit();
    advance();
    // The fake engine proposes nothing over the edited text: no ready edit, one handled row.
    expect(screen.queryByRole('region', { name: 'Quick edit' })).toBeNull();
    expect(undoEditRow()).toBeTruthy();

    // The editor's undo is an ordinary change: the original heading is back.
    fireEvent.change(editor(), { target: { value: DRAFT } });
    advance();

    expect(openGroup('question-headings').queryByRole('button', { name: /^Undo: / })).toBeNull();
    applyEdit();
    expect(editor().value).toContain(HEADING_EDIT.after);
  });

  it('clears Out of date once a fresh analysis finds the same text again', () => {
    vi.useFakeTimers();
    renderExample();
    const at = HEADING_EDIT.range.start + 5;
    const edited = `${DRAFT.slice(0, at)}X${DRAFT.slice(at + 1)}`;
    const dialog = preview(quick(EDIT));
    fireEvent.change(editor(), { target: { value: edited } });
    fireEvent.click(dialog.getByRole('button', { name: 'Apply' }));
    advance();
    expect(screen.getByText(STALE_MESSAGE)).toBeTruthy();

    // The author puts the text back: the same fix over the same text is valid again.
    fireEvent.change(editor(), { target: { value: DRAFT } });
    advance();
    expect(screen.queryAllByText(STALE_MESSAGE)).toEqual([]);
    applyEdit();
    expect(editor().value).toContain(HEADING_EDIT.after);
  });

  it('refuses an Apply right after typing at the end of its heading, before the re-analysis', () => {
    renderExample();
    const typed = DRAFT.replace(
      '## Why espresso turns bitter',
      '## Why espresso turns bitter fast',
    );
    const dialog = preview(quick(EDIT));
    // Typed within the debounce: the last analysis still has the old range.
    fireEvent.change(editor(), { target: { value: typed } });
    fireEvent.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(editor().value).toBe(typed);
    expect(editor().value).not.toContain('bitter? fast');
    // Refused as out of date, and the analysis re-ran on the typed text at once.
    expect(analyzeMock.mock.calls.at(-1)?.[0]).toBe(typed);
  });

  it('undoes an applied edit from its row after the author typed above it', () => {
    renderExample();
    applyEdit();
    const applied = editor().value;
    fireEvent.change(editor(), { target: { value: `Intro line.\n\n${applied}` } });
    fireEvent.click(undoEditRow());
    expect(screen.queryByText(/^Cannot undo/)).toBeNull();
    expect(editor().value).toBe(`Intro line.\n\n${DRAFT}`);
  });

  it('says Cannot undo, and keeps the text, when the applied text itself was edited', () => {
    renderExample();
    applyEdit();
    const edited = editor().value.replace('turn bitter?', 'turn sour?');
    fireEvent.change(editor(), { target: { value: edited } });
    fireEvent.click(undoEditRow());
    expect(screen.getByText('Cannot undo: the applied text was edited since.')).toBeTruthy();
    expect(editor().value).toBe(edited);
  });

  it('Undo after Reset brings back the applied edits, each with its own Undo', () => {
    renderExample();
    applyEdit();
    const applied = editor().value;
    fireEvent.click(screen.getByRole('button', { name: 'Reset to example' }));
    expect(editor().value).toBe(DRAFT);
    expect(quick(EDIT)).toBeTruthy();
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(editor().value).toBe(applied);
    fireEvent.click(undoEditRow());
    expect(editor().value).toBe(DRAFT);
  });

  it('keeps done and skipped statuses across a reload', async () => {
    const first = renderExample();
    await pick(note(QUOTE_ADVISORY), 'Skip');
    await pick(note(PARAGRAPH_ADVISORY), 'Done');
    first.unmount();
    render(<DraftView />);
    expect(noNote(QUOTE_ADVISORY)).toBe(true);
    expect(noNote(PARAGRAPH_ADVISORY)).toBe(true);
    expect(screen.getByRole('button', { name: /^Writing notes/ }).textContent).toContain('1');
  });

  it('loads, edits and analyzes when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    renderExample();
    await pick(note(QUOTE_ADVISORY), 'Done');
    expect(noNote(QUOTE_ADVISORY)).toBe(true);
    expect(questionsCard()).toBeTruthy();
    vi.useFakeTimers();
    const edited = `${DRAFT}More text.\n`;
    fireEvent.change(editor(), { target: { value: edited } });
    advance();
    expect(analyzeMock.mock.calls.at(-1)?.[0]).toBe(edited);
    expect(noNote(QUOTE_ADVISORY)).toBe(true);
  });

  it('keeps the draft, Done and Skip across leaving the view while storage is blocked', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const first = render(<DraftView />);
    vi.useFakeTimers();
    fireEvent.change(editor(), { target: { value: DRAFT } });
    advance();
    vi.useRealTimers();
    await pick(note(QUOTE_ADVISORY), 'Skip');
    await pick(note(PARAGRAPH_ADVISORY), 'Done');
    // Another view, then back: the draft view mounts afresh within the same page.
    first.unmount();
    vi.useFakeTimers();
    render(<DraftView />);
    advance();
    expect(editor().value).toBe(DRAFT);
    expect(noNote(QUOTE_ADVISORY)).toBe(true);
    expect(noNote(PARAGRAPH_ADVISORY)).toBe(true);
    // The home's step card reads the same draft: My post, measured on its page questions.
    expect(draftSummaryFor(MY_POST_SLOT)).toMatchObject({ slot: MY_POST_SLOT, fromPage: true });
  });

  it('Reset to example can be undone from the toast', async () => {
    renderExample();
    await pick(note(QUOTE_ADVISORY), 'Skip');
    const mine = `${DRAFT}My own paragraph.\n`;
    fireEvent.change(editor(), { target: { value: mine } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to example' }));
    expect(editor().value).toBe(DRAFT);
    expect(note(QUOTE_ADVISORY)).toBeTruthy();
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(editor().value).toBe(mine);
    expect(noNote(QUOTE_ADVISORY)).toBe(true);
  });

  it('does not save the untouched example text', () => {
    renderExample();
    expect(localStorage.getItem('ce:v1:draft:fixture')).toBeNull();
    fireEvent.change(editor(), { target: { value: `${DRAFT}More.\n` } });
    expect(localStorage.getItem('ce:v1:draft:fixture')).toBe(`${DRAFT}More.\n`);
  });

  it('moves a paste over most of the example to My post, leaving the example intact', () => {
    renderExample();
    const own = '# Road bikes\n\n## How do I pick a frame size?\n\nPick a frame by your inseam.\n';
    fireEvent.change(editor(), { target: { value: own } });
    expect(getActiveSlot()).toBe(MY_POST_SLOT);
    expect(editor().value).toBe(own);
    expect(screen.queryByText('This is an example post.')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your draft' })).toBeTruthy();
    expect(within(toast()).getByText('Moved to My post.')).toBeTruthy();
    expect(localStorage.getItem('ce:v1:draft:my-draft')).toBe(own);
    expect(localStorage.getItem('ce:v1:draft:fixture')).toBeNull();
    // The home tile follows: My post, not labelled Example.
    expect(getSummary('draft')).toMatchObject({ slot: MY_POST_SLOT, example: false });
    // Back on the example, Reset to example leaves My post alone.
    act(() => setActiveSlot('fixture'));
    expect(editor().value).toBe(DRAFT);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to example' }));
    expect(localStorage.getItem('ce:v1:draft:my-draft')).toBe(own);
  });

  it('undoes a move to My post: My post as it was, back on the example', () => {
    localStorage.setItem('ce:v1:draft:my-draft', 'An earlier post of mine.');
    renderExample();
    fireEvent.change(editor(), { target: { value: 'A different post entirely.' } });
    expect(getActiveSlot()).toBe(MY_POST_SLOT);
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(getActiveSlot()).toBe('fixture');
    expect(editor().value).toBe(DRAFT);
    expect(localStorage.getItem('ce:v1:draft:my-draft')).toBe('An earlier post of mine.');
  });

  it('keeps the toast up when a move to My post replaced earlier My post text', () => {
    vi.useFakeTimers();
    localStorage.setItem('ce:v1:draft:my-draft', 'An earlier post of mine.');
    renderExample();
    fireEvent.change(editor(), { target: { value: 'A different post entirely.' } });
    act(() => vi.advanceTimersByTime(TOAST_MS * 3));
    expect(within(toast()).getByText('Moved to My post, replacing its earlier text.')).toBeTruthy();
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(localStorage.getItem('ce:v1:draft:my-draft')).toBe('An earlier post of mine.');
  });

  it('clearing the example keeps it in the example and leaves My post alone', () => {
    localStorage.setItem('ce:v1:draft:my-draft', 'An earlier post of mine.');
    renderExample();
    fireEvent.change(editor(), { target: { value: '' } });
    expect(getActiveSlot()).toBe('fixture');
    expect(localStorage.getItem('ce:v1:draft:my-draft')).toBe('An earlier post of mine.');
  });

  it('drops the move toast once My post is edited, so Undo cannot discard the edit', () => {
    localStorage.setItem('ce:v1:draft:my-draft', 'An earlier post of mine.');
    renderExample();
    fireEvent.change(editor(), { target: { value: 'A different post entirely.' } });
    expect(within(toast()).getByText('Moved to My post, replacing its earlier text.')).toBeTruthy();
    fireEvent.change(editor(), { target: { value: 'A different post entirely. Edited.' } });
    expect(screen.queryByRole('status', { name: 'Last action' })).toBeNull();
    expect(localStorage.getItem('ce:v1:draft:my-draft')).toBe('A different post entirely. Edited.');
  });

  it('keeps small edits to the example in the example', () => {
    renderExample();
    fireEvent.change(editor(), { target: { value: `${DRAFT}One more line.\n` } });
    expect(getActiveSlot()).toBe('fixture');
    expect(localStorage.getItem('ce:v1:draft:fixture')).toBe(`${DRAFT}One more line.\n`);
  });

  it("keeps the author's own post in its own slot", () => {
    render(<DraftView />);
    const own = '# Road bikes\n\n## How do I pick a frame size?\n\nPick a frame by your inseam.\n';
    fireEvent.change(editor(), { target: { value: own } });
    expect(localStorage.getItem('ce:v1:draft:my-draft')).toBe(own);
    act(() => setActiveSlot('fixture'));
    expect(editor().value).toBe(DRAFT);
    act(() => setActiveSlot(MY_POST_SLOT));
    expect(editor().value).toBe(own);
  });
});

describe('Draft view, the draft summary', () => {
  it("writes the draft summary from the analysis's question report", () => {
    const fixtureAnalyze = analyzeMock.getMockImplementation();
    if (!fixtureAnalyze) throw new Error('no analyze mock');
    // Three questions measured, two covered.
    const [row] = PAGE.rows;
    if (!row) throw new Error('no page question');
    const rows: AnalysisResult['questions']['rows'] = ['One?', 'Two?', 'Three?'].map(
      (question) => ({ ...row, question }),
    );
    analyzeMock.mockImplementation((md, opts) => ({
      ...fixtureAnalyze(md, opts),
      questions: { from: 'yours', rows, covered: 2 },
    }));
    try {
      const view = renderExample();
      expect(getSummary('draft')).toEqual({
        slot: 'fixture',
        covered: 2,
        total: 3,
        fromPage: false,
        example: true,
        at: expect.any(String),
      });
      view.unmount();
    } finally {
      analyzeMock.mockImplementation(fixtureAnalyze);
    }
  });

  it('stores questions covered and total for the home, never a score, and no baseline', () => {
    renderExample();
    const stored = getSummary('draft');
    expect(stored).toEqual({
      slot: 'fixture',
      covered: PAGE.covered,
      total: PAGE.rows.length,
      fromPage: true,
      example: true,
      at: expect.any(String),
    });
    applyEdit();
    expect(getSummary('draft')).not.toHaveProperty('score');
    expect(Object.keys(localStorage).some((k) => k.startsWith('ce:v1:baseline:'))).toBe(false);
  });
});

describe('Draft view, local AI', () => {
  it('connects from the local AI row only on its click, saying where the text goes', async () => {
    const { probeOllama, DEFAULT_SETTINGS } = await import('@citation-equity/bench');
    renderExample();
    expect(rail().textContent).toContain('Local AI (optional)');
    const button = screen.getByRole('button', { name: 'Connect local AI' });
    expect(button.getAttribute('title')).toBe('Sends your text only to the AI on this computer.');
    expect(probeOllama).not.toHaveBeenCalled();
    await connectLocalAI();
    expect(probeOllama).toHaveBeenCalledTimes(1);
    expect(screen.getByText(`Connected to ${DEFAULT_SETTINGS.model}.`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect local AI' })).toBeNull();
    // The connection is the page's, so another draft keeps it.
    act(() => setActiveSlot(MY_POST_SLOT));
    act(() => setActiveSlot('fixture'));
    expect(screen.getByText(`Connected to ${DEFAULT_SETTINGS.model}.`)).toBeTruthy();
  });

  it('says what to do when the local AI is not running or lacks the model', async () => {
    const { probeOllama, DEFAULT_SETTINGS } = await import('@citation-equity/bench');
    vi.mocked(probeOllama).mockResolvedValue({ reachable: false, models: [] });
    renderExample();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect local AI' }));
    });
    expect(screen.getByText("Can't reach Ollama. Start it with the command below.")).toBeTruthy();
    vi.mocked(probeOllama).mockResolvedValue({ reachable: true, models: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(
      screen.getByText(`Ollama is on, but ${DEFAULT_SETTINGS.model} isn't installed. Run:`),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Suggest wording' })).toBeNull();
  });

  it('offers Suggest wording on advice notes only after Connect local AI, and asks nothing before', async () => {
    const proposal: Suggestion = {
      ...PARAGRAPH_ADVISORY,
      kind: 'edit',
      after: 'Bitter espresso shots run long.',
    };
    proposeMock.mockResolvedValue(proposal);
    renderExample();
    expect(
      within(note(PARAGRAPH_ADVISORY)).queryByRole('button', { name: 'Suggest wording' }),
    ).toBeNull();
    await connectLocalAI();
    expect(inNote(PARAGRAPH_ADVISORY, 'Suggest wording')).toBeTruthy();
    expect(
      within(note(QUOTE_ADVISORY)).queryByRole('button', { name: 'Suggest wording' }),
    ).toBeNull();
    expect(
      within(note(HEADING_EDIT)).queryByRole('button', { name: 'Suggest wording' }),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(inNote(PARAGRAPH_ADVISORY, 'Suggest wording'));
    });
    const dialog = within(screen.getByRole('dialog', { name: 'Preview' }));
    expect(dialog.getByText(proposal.after ?? '-')).toBeTruthy();
    expect(editor().value).toBe(DRAFT);
    fireEvent.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(editor().value).toContain('Bitter espresso shots run long.');
  });

  it("unlocks the question editor's local AI button too", async () => {
    saveList('fixture', [{ text: 'Why does espresso turn bitter?', source: 'user' }]);
    renderAnalyzed();
    fireEvent.click(within(questionsCard()).getByRole('button', { name: 'Edit questions' }));
    const editorRegion = () =>
      within(within(questionsCard()).getByRole('region', { name: 'Edit questions' }));
    expect(editorRegion().queryByRole('button', { name: /local AI/i })).toBeNull();
    await connectLocalAI();
    expect(editorRegion().getByRole('button', { name: /local AI/i })).toBeTruthy();
  });
});
