import { analyze, generateQuestions, type Suggestion } from '@citation-equity/engine';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workspace } from '@/components/workspace';
import { suggestWithLocalModel } from '@/lib/question-helper';
import { CIRCULARITY_NOTE } from '@/lib/questions';
import { ANALYSIS_DELAY_MS } from '@/lib/use-analysis';
import { proposeWording } from '@/lib/wording-helper';
import { DRAFT, FINDINGS, HEADING_EDIT, PARAGRAPH_ADVISORY, QUOTE_ADVISORY } from './fixtures';

// The engine's checks are placeholders in this wave, so the engine is replaced
// by one that proposes the fixture suggestions wherever their text still sits.
vi.mock('@citation-equity/engine', async (importOriginal) => {
  const engine = await importOriginal<typeof import('@citation-equity/engine')>();
  const { HEADING_EDIT, QUOTE_ADVISORY, PARAGRAPH_ADVISORY, makeResult } = await import(
    './fixtures'
  );
  return {
    ...engine,
    analyze: vi.fn((md: string) =>
      makeResult(
        md,
        [HEADING_EDIT, QUOTE_ADVISORY, PARAGRAPH_ADVISORY].filter(
          (s) => md.slice(s.range.start, s.range.end) === s.before,
        ),
      ),
    ),
  };
});

/** Ranges the workspace asked the editor to show. */
const focused = vi.hoisted(() => [] as { start: number; end: number }[]);

// CodeMirror needs layout that jsdom lacks; a textarea stands in for it.
vi.mock('@/components/editor/markdown-editor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  type Props = { value: string; onChange(v: string): void; ariaLabel: string };
  return {
    MarkdownEditor: forwardRef<unknown, Props>(function FakeEditor(
      { value, onChange, ariaLabel },
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        focusRange: (r: { start: number; end: number }) => focused.push(r),
      }));
      return (
        <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
      );
    }),
  };
});

// The preview dialog's CodeMirror merge view needs layout too; this stand-in
// shows the proposal and the same per-suggestion Apply.
vi.mock('@/components/editor/merge-preview', () => ({
  MergePreview: ({
    suggestion,
    note,
    onApply,
  }: {
    suggestion: Suggestion | null;
    note?: string;
    onApply(s: Suggestion): void;
  }) =>
    suggestion && (
      <div role="dialog" aria-label="Preview change">
        <p>{suggestion.after}</p>
        {note && <p>{note}</p>}
        <button type="button" onClick={() => onApply(suggestion)}>
          Apply
        </button>
      </div>
    ),
}));

// The wording and question helpers would call a local Ollama; the tests decide what they return.
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
  };
});

const analyzeMock = vi.mocked(analyze);
const proposeMock = vi.mocked(proposeWording);
const editor = () => screen.getByLabelText<HTMLTextAreaElement>('Draft in Markdown');
const card = (title: string) => screen.getByRole('article', { name: title }) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  analyzeMock.mockClear();
  proposeMock.mockReset();
  focused.length = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Workspace', () => {
  it('applies an edit with one click and lists it as handled', () => {
    render(<Workspace />);
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    expect(editor().value).toContain('## Why does espresso turn bitter?');
    expect(screen.getByText('Handled (1)')).toBeTruthy();
  });

  it('offers an applied suggestion again when its text comes back, e.g. after Cmd-Z', () => {
    vi.useFakeTimers();
    render(<Workspace />);
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));
    expect(screen.queryByRole('article', { name: HEADING_EDIT.title })).toBeNull();

    // The editor's undo is an ordinary change: the original heading is back.
    fireEvent.change(editor(), { target: { value: DRAFT } });
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));

    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
    expect(screen.queryByText(/^Handled/)).toBeNull();
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    expect(editor().value).toContain('## Why does espresso turn bitter?');
  });

  it('does not persist applied statuses, so a reload never hides a suggestion', () => {
    const first = render(<Workspace />);
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(card(QUOTE_ADVISORY.title)).getByRole('button', { name: 'Ignore' }));
    first.unmount();
    expect(JSON.parse(localStorage.getItem('ce:v1:statuses:fixture') ?? '{}')).toEqual({
      [QUOTE_ADVISORY.id]: 'ignored',
    });

    // An 'applied' saved by an earlier build, with the original text restored.
    localStorage.setItem('ce:v1:draft:fixture', DRAFT);
    localStorage.setItem(
      'ce:v1:statuses:fixture',
      JSON.stringify({ [HEADING_EDIT.id]: 'applied' }),
    );
    render(<Workspace />);
    expect(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' })).toBeTruthy();
  });

  it('marks a suggestion out of date instead of clobbering an edited range (Review Focus 3)', () => {
    render(<Workspace />);
    const at = HEADING_EDIT.range.start + 5;
    const edited = `${DRAFT.slice(0, at)}X${DRAFT.slice(at + 1)}`;
    fireEvent.change(editor(), { target: { value: edited } });
    const callsBefore = analyzeMock.mock.calls.length;

    // Apply before the 250 ms debounce has re-analyzed the edited text.
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));

    expect(editor().value).toBe(edited);
    expect(analyzeMock.mock.calls.length).toBe(callsBefore + 1);
    expect(analyzeMock.mock.calls.at(-1)?.[0]).toBe(edited);
    expect(
      screen.getByText('Out of date. The text changed since this was suggested.', { exact: false }),
    ).toBeTruthy();
  });

  it('keeps ignored and done statuses across a reload', () => {
    const first = render(<Workspace />);
    fireEvent.click(within(card(QUOTE_ADVISORY.title)).getByRole('button', { name: 'Ignore' }));
    fireEvent.click(
      within(card(PARAGRAPH_ADVISORY.title)).getByRole('button', { name: 'Mark done' }),
    );
    expect(screen.queryByRole('article', { name: QUOTE_ADVISORY.title })).toBeNull();
    expect(screen.queryByRole('article', { name: PARAGRAPH_ADVISORY.title })).toBeNull();
    first.unmount();
    expect(JSON.parse(localStorage.getItem('ce:v1:statuses:fixture') ?? '{}')).toEqual({
      [QUOTE_ADVISORY.id]: 'ignored',
      [PARAGRAPH_ADVISORY.id]: 'done',
    });

    render(<Workspace />);
    expect(screen.queryByRole('article', { name: QUOTE_ADVISORY.title })).toBeNull();
    expect(screen.queryByRole('article', { name: PARAGRAPH_ADVISORY.title })).toBeNull();
    expect(screen.getByText('Handled (2)')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`^Undo: ${QUOTE_ADVISORY.title}`) }),
    );
    expect(card(QUOTE_ADVISORY.title)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`^Undo: ${PARAGRAPH_ADVISORY.title}`) }),
    );
    expect(card(PARAGRAPH_ADVISORY.title)).toBeTruthy();
  });

  it('loads, edits and analyzes when localStorage throws (Review Focus 4)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.useFakeTimers();
    render(<Workspace />);
    fireEvent.click(within(card(QUOTE_ADVISORY.title)).getByRole('button', { name: 'Mark done' }));
    expect(screen.getByText('Handled (1)')).toBeTruthy();
    expect(screen.getByText('62')).toBeTruthy();
    const edited = `${DRAFT}More text.\n`;
    fireEvent.change(editor(), { target: { value: edited } });
    expect(editor().value).toContain('More text.');
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));
    // The debounced analysis ran on the edited text, with storage still throwing.
    expect(analyzeMock.mock.calls.at(-1)?.[0]).toBe(edited);
    expect(screen.getByText('62')).toBeTruthy();
  });

  it('switches to Custom when a weight moves and shows the custom score', () => {
    render(<Workspace />);
    fireEvent.change(screen.getByLabelText('Weight for Lists for enumerations'), {
      target: { value: '1.5' },
    });
    expect(screen.getByRole('button', { name: 'Custom', pressed: true })).toBeTruthy();
    expect(screen.getByText('GEO Score, Custom')).toBeTruthy();
    // Every fixture check scores 0.5, so any non-zero weights give 50.
    expect(screen.getByText('50')).toBeTruthy();
  });

  it('undoes an applied edit after the author typed above it', () => {
    render(<Workspace />);
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    const applied = editor().value;
    fireEvent.change(editor(), { target: { value: `Intro line.\n\n${applied}` } });
    fireEvent.click(screen.getByRole('button', { name: /^Undo: / }));
    expect(screen.queryByText('Cannot undo', { exact: false })).toBeNull();
    expect(editor().value).toBe(`Intro line.\n\n${DRAFT}`);
  });

  it('still says Cannot undo when the applied text itself was edited', () => {
    render(<Workspace />);
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    const edited = editor().value.replace('turn bitter?', 'turn sour?');
    fireEvent.change(editor(), { target: { value: edited } });
    fireEvent.click(screen.getByRole('button', { name: /^Undo: / }));
    expect(screen.getByText('Cannot undo: the applied text was edited since.')).toBeTruthy();
    expect(editor().value).toBe(edited);
  });

  it('refuses an Apply right after typing at the end of its heading, before the re-analysis', () => {
    render(<Workspace />);
    const typed = DRAFT.replace(
      '## Why espresso turns bitter',
      '## Why espresso turns bitter fast',
    );
    fireEvent.change(editor(), { target: { value: typed } });
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    expect(editor().value).toBe(typed);
    expect(editor().value).not.toContain('bitter? fast');
    // Refused as out of date, and the analysis re-ran on the typed text at once.
    expect(analyzeMock.mock.calls.at(-1)?.[0]).toBe(typed);
  });

  it('applies at the moved range when the author typed elsewhere within the debounce', () => {
    render(<Workspace />);
    fireEvent.change(editor(), { target: { value: `Intro.\n\n${DRAFT}` } });
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    expect(editor().value).toBe(
      `Intro.\n\n${DRAFT.replace('## Why espresso turns bitter', HEADING_EDIT.after ?? '')}`,
    );
  });

  it('clears Out of date once a fresh analysis finds the same text again', () => {
    vi.useFakeTimers();
    render(<Workspace />);
    const at = HEADING_EDIT.range.start + 5;
    const edited = `${DRAFT.slice(0, at)}X${DRAFT.slice(at + 1)}`;
    fireEvent.change(editor(), { target: { value: edited } });
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));
    expect(screen.getByText(/Out of date/)).toBeTruthy();
    // The author puts the text back: the same suggestion over the same text is valid again.
    fireEvent.change(editor(), { target: { value: DRAFT } });
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));
    expect(screen.queryByText(/Out of date/)).toBeNull();
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    expect(editor().value).toContain(HEADING_EDIT.after);
  });

  it('tells two handled rows apart by the text they are about', () => {
    render(<Workspace />);
    fireEvent.click(within(card(QUOTE_ADVISORY.title)).getByRole('button', { name: 'Ignore' }));
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    const undo = screen.getAllByRole('button', { name: /^Undo: / }).map((b) => b.textContent);
    expect(new Set(undo).size).toBe(2);
    expect(undo.some((t) => t?.includes(HEADING_EDIT.after ?? '-'))).toBe(true);
    expect(undo.some((t) => t?.includes(QUOTE_ADVISORY.before))).toBe(true);
  });

  it("puts the check's finding on a card whose rationale does not say it", () => {
    render(<Workspace />);
    const message = FINDINGS[PARAGRAPH_ADVISORY.id] ?? '';
    expect(card(PARAGRAPH_ADVISORY.title).textContent).toContain(message);
  });

  it('does not save the untouched sample text, so a changed sample reaches returning visitors', () => {
    vi.useFakeTimers();
    render(<Workspace />);
    expect(localStorage.getItem('ce:v1:draft:fixture')).toBeNull();
    fireEvent.change(editor(), { target: { value: `${DRAFT}More.\n` } });
    expect(localStorage.getItem('ce:v1:draft:fixture')).toBe(`${DRAFT}More.\n`);
    fireEvent.change(editor(), { target: { value: DRAFT } });
    expect(localStorage.getItem('ce:v1:draft:fixture')).toBeNull();
  });

  it('Reset draft can be undone with one click until the author types', () => {
    render(<Workspace />);
    fireEvent.click(within(card(QUOTE_ADVISORY.title)).getByRole('button', { name: 'Ignore' }));
    const mine = `${DRAFT}My own paragraph.\n`;
    fireEvent.change(editor(), { target: { value: mine } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset draft' }));
    expect(editor().value).toBe(DRAFT);
    expect(screen.getByText(/Draft reset to the sample/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo reset' }));
    expect(editor().value).toBe(mine);
    expect(screen.queryByRole('article', { name: QUOTE_ADVISORY.title })).toBeNull();
    expect(localStorage.getItem('ce:v1:draft:fixture')).toBe(mine);

    fireEvent.click(screen.getByRole('button', { name: 'Reset draft' }));
    fireEvent.change(editor(), { target: { value: `${DRAFT}x` } });
    expect(screen.queryByRole('button', { name: 'Undo reset' })).toBeNull();
  });

  it('Undo reset brings back the applied edits, each with its Undo', () => {
    render(<Workspace />);
    fireEvent.click(within(card(HEADING_EDIT.title)).getByRole('button', { name: 'Apply' }));
    const applied = editor().value;
    fireEvent.click(screen.getByRole('button', { name: 'Reset draft' }));
    expect(screen.queryByRole('button', { name: /^Undo: / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo reset' }));
    expect(editor().value).toBe(applied);
    fireEvent.click(screen.getByRole('button', { name: /^Undo: / }));
    expect(editor().value).toBe(DRAFT);
  });

  it('has no Apply all control', () => {
    render(<Workspace />);
    expect(screen.queryByRole('button', { name: /apply all/i })).toBeNull();
  });
});

describe('Workspace, local wording helper', () => {
  const SUGGEST = 'Suggest wording (local model)';
  const proposal: Suggestion = {
    ...PARAGRAPH_ADVISORY,
    kind: 'edit',
    after: 'Bitter espresso shots run long.',
  };

  it('offers the helper on advisory cards only, and asks nothing until clicked', () => {
    render(<Workspace />);
    expect(
      within(card(PARAGRAPH_ADVISORY.title)).getByRole('button', { name: SUGGEST }),
    ).toBeTruthy();
    expect(within(card(HEADING_EDIT.title)).queryByRole('button', { name: SUGGEST })).toBeNull();
    expect(proposeMock).not.toHaveBeenCalled();
  });

  it('never offers the helper for a quote, statistic or source: a model would invent one', () => {
    render(<Workspace />);
    expect(within(card(QUOTE_ADVISORY.title)).queryByRole('button', { name: SUGGEST })).toBeNull();
  });

  it('shows the proposal side by side and changes the draft only on Apply', async () => {
    // Loaded here for the same reason as below: a top-level bench import
    // would load the mocked engine from inside its own factory.
    const { DEFAULT_SETTINGS } = await import('@citation-equity/bench');
    proposeMock.mockResolvedValue(proposal);
    render(<Workspace />);
    await act(async () => {
      fireEvent.click(
        within(card(PARAGRAPH_ADVISORY.title)).getByRole('button', { name: SUGGEST }),
      );
    });
    expect(proposeMock).toHaveBeenCalledTimes(1);
    const [s, section, , model] = proposeMock.mock.calls[0];
    expect(s.id).toBe(PARAGRAPH_ADVISORY.id);
    expect(section).toContain('Bitter shots run long.');
    expect(model).toBe(DEFAULT_SETTINGS.model);
    const dialog = screen.getByRole('dialog', { name: 'Preview change' });
    expect(dialog.textContent).toContain(proposal.after);
    expect(dialog.textContent).toContain(DEFAULT_SETTINGS.model);
    expect(editor().value).toBe(DRAFT);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(editor().value).toContain('Bitter espresso shots run long.');
    expect(screen.getByText('Handled (1)')).toBeTruthy();
  });

  it('says how to start Ollama when no local model answers', async () => {
    // Loaded here: a top-level bench import would load the mocked engine
    // from inside its own factory (bench imports the engine) and hang.
    const { AdapterUnavailableError } = await import('@citation-equity/bench');
    proposeMock.mockRejectedValue(new AdapterUnavailableError('Ollama is not reachable'));
    render(<Workspace />);
    await act(async () => {
      fireEvent.click(
        within(card(PARAGRAPH_ADVISORY.title)).getByRole('button', { name: SUGGEST }),
      );
    });
    const text = card(PARAGRAPH_ADVISORY.title).textContent ?? '';
    expect(text).toContain('No local model answered');
    expect(text).toContain('OLLAMA_ORIGINS');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editor().value).toBe(DRAFT);
  });
});

describe('Workspace, target questions', () => {
  const GENERATED = generateQuestions(DRAFT).map((q) => q.text);
  const questionsPanel = () => within(screen.getByRole('region', { name: 'Target questions' }));
  const fields = () =>
    questionsPanel()
      .getAllByRole('textbox', { name: /^Question \d/ })
      .map((el) => (el as HTMLInputElement).value);
  const lastQuestions = () => analyzeMock.mock.calls.at(-1)?.[1]?.questions;
  const addQuestion = (text: string) => {
    const field = questionsPanel().getByRole('textbox', { name: 'New question' });
    fireEvent.change(field, { target: { value: text } });
    fireEvent.submit(field);
  };
  const suggestFromDraft = () =>
    fireEvent.click(questionsPanel().getByRole('button', { name: 'Suggest from my draft' }));

  it('scores no template question until the author asks for them, then analyzes with them', () => {
    expect(GENERATED.length).toBeGreaterThan(0);
    vi.useFakeTimers();
    render(<Workspace />);
    // The fixture draft asks no question in its own headings, so the list starts empty.
    expect(questionsPanel().queryAllByRole('textbox', { name: /^Question \d/ })).toEqual([]);
    expect(lastQuestions() ?? []).toEqual([]);
    suggestFromDraft();
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));
    expect(fields()).toEqual(GENERATED);
    expect(lastQuestions()).toEqual(GENERATED);
    expect(suggestWithLocalModel).not.toHaveBeenCalled();
    // The fixture sample has no pack, so the bench panel offers no local-model check, and
    // the questions panel offers no local-model button.
    expect(questionsPanel().queryByRole('button', { name: /local model/ })).toBeNull();
  });

  it('re-runs the analysis when a question is added or removed', () => {
    vi.useFakeTimers();
    render(<Workspace />);
    suggestFromDraft();
    addQuestion('How long should a shot take?');
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));
    expect(lastQuestions()).toEqual([...GENERATED, 'How long should a shot take?']);

    fireEvent.click(questionsPanel().getByRole('button', { name: 'Remove question 1' }));
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));
    expect(lastQuestions()).toEqual([...GENERATED.slice(1), 'How long should a shot take?']);
  });

  it("keeps each draft's questions across a reload, even an emptied list", () => {
    const first = render(<Workspace />);
    addQuestion('How long should a shot take?');
    first.unmount();
    expect(JSON.parse(localStorage.getItem('ce:v1:questions:fixture') ?? '[]').at(-1)).toEqual({
      text: 'How long should a shot take?',
      source: 'user',
    });
    const second = render(<Workspace />);
    expect(fields().at(-1)).toBe('How long should a shot take?');
    for (let i = fields().length; i > 0; i--)
      fireEvent.click(questionsPanel().getByRole('button', { name: `Remove question ${i}` }));
    second.unmount();

    vi.useFakeTimers();
    render(<Workspace />);
    expect(questionsPanel().queryAllByRole('textbox', { name: /^Question \d/ })).toEqual([]);
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));
    expect(lastQuestions()).toEqual([]);
  });

  it('prefills, adds and analyzes when localStorage throws (Review Focus 4)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.useFakeTimers();
    render(<Workspace />);
    suggestFromDraft();
    expect(fields()).toEqual(GENERATED);
    addQuestion('How long should a shot take?');
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));
    expect(fields().at(-1)).toBe('How long should a shot take?');
    expect(lastQuestions()).toContain('How long should a shot take?');
  });

  it('lists each question as Covered or Not covered on the coverage card, with Show in draft', () => {
    const answered = `${DRAFT}\n## How long should a shot take?\n\nA good espresso shot should take 25 to 30 seconds in total.\n`;
    localStorage.setItem('ce:v1:draft:fixture', answered);
    localStorage.setItem(
      'ce:v1:questions:fixture',
      JSON.stringify([
        { text: 'How long should a shot take?', source: 'user' },
        { text: 'Which bank has the lowest rate?', source: 'user' },
      ]),
    );
    vi.useFakeTimers();
    render(<Workspace />);
    // The saved draft and questions are read after the first render, then analyzed.
    act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));
    const coverageCard = within(screen.getByRole('region', { name: 'Target questions answered' }));
    const rows = coverageCard.getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('How long should a shot take?');
    expect(rows[0]?.textContent).toMatch(/^Covered/);
    expect(rows[1]?.textContent).toContain('Which bank has the lowest rate?');
    expect(rows[1]?.textContent).toMatch(/^Not covered/);
    expect(coverageCard.getByText(CIRCULARITY_NOTE)).toBeTruthy();

    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: /Show in draft/ }));
    const r = focused.at(-1);
    expect(r && answered.slice(r.start, r.end)).toBe('How long should a shot take?');
  });
});

describe('Workspace, My draft', () => {
  const OWN = '# Road bikes\n\n## How do I pick a frame size?\n\nPick a frame by your inseam.\n';
  const pick = (value: string) =>
    fireEvent.change(screen.getByRole('combobox', { name: 'Draft' }), { target: { value } });
  const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
  const questionsPanel = () => within(screen.getByRole('region', { name: 'Target questions' }));
  const bench = () => within(screen.getByRole('region', { name: 'Citation test bench' }));

  it("holds the author's own text with its own title, questions, bench view and storage", () => {
    render(<Workspace />);
    pick('my-draft');
    expect(editor().value).toBe('');
    expect(heading()).toBe('My draft');
    // No sample questions carried over, and the bench shows the custom-draft view.
    expect(questionsPanel().queryAllByRole('textbox', { name: /^Question \d/ })).toEqual([]);
    expect(bench().getByText(/needs a pack/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear draft' })).toBeTruthy();

    fireEvent.change(editor(), { target: { value: OWN } });
    expect(heading()).toBe('Road bikes');
    expect(localStorage.getItem('ce:v1:draft:my-draft')).toBe(OWN);
    expect(localStorage.getItem('ce:v1:draft:fixture')).toBeNull();
    fireEvent.click(questionsPanel().getByRole('button', { name: 'Suggest from my draft' }));
    const fields = questionsPanel()
      .getAllByRole('textbox', { name: /^Question \d/ })
      .map((el) => (el as HTMLInputElement).value);
    expect(fields).toContain('How do I pick a frame size?');
    expect(fields.join(' ')).not.toMatch(/espresso/i);

    pick('fixture');
    expect(editor().value).toBe(DRAFT);
    expect(heading()).toBe('Fixture draft');
    pick('my-draft');
    expect(editor().value).toBe(OWN);
  });
});
