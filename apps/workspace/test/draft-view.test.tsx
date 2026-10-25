import {
  analyze,
  generateQuestions,
  pageQuestions,
  type Suggestion,
} from '@citation-equity/engine';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftView } from '@/components/draft/draft-view';
import { TOAST_MS } from '@/components/draft/undo-toast';
import { loadBaseline } from '@/lib/baseline';
import { draftSummaryFor } from '@/lib/draft-summary';
import { fixCopy, STALE_MESSAGE } from '@/lib/fix-copy';
import { CHECK_NAMES } from '@/lib/glossary';
import { suggestWithLocalModel } from '@/lib/question-helper';
import { clearAll, getActiveSlot, getSummary, MY_POST_SLOT, setActiveSlot } from '@/lib/store';
import { ANALYSIS_DELAY_MS } from '@/lib/use-analysis';
import { proposeWording } from '@/lib/wording-helper';
import { DRAFT, FINDINGS, HEADING_EDIT, PARAGRAPH_ADVISORY, QUOTE_ADVISORY } from './fixtures';

// The engine is replaced by one that proposes the fixture suggestions wherever their text still
// sits. Applying the heading edit raises the Standard score by 5, so "+N" has something to show.
vi.mock('@citation-equity/engine', async (importOriginal) => {
  const engine = await importOriginal<typeof import('@citation-equity/engine')>();
  const { HEADING_EDIT, QUOTE_ADVISORY, PARAGRAPH_ADVISORY, makeResult } = await import(
    './fixtures'
  );
  return {
    ...engine,
    analyze: vi.fn((md: string) =>
      md.trim() === ''
        ? {
            ...makeResult(md, []),
            wordCount: 0,
            scores: { foundation: null, evidence: null, custom: null },
          }
        : makeResult(
            md,
            [HEADING_EDIT, QUOTE_ADVISORY, PARAGRAPH_ADVISORY].filter(
              (s) => md.slice(s.range.start, s.range.end) === s.before,
            ),
            { foundation: md.includes('turn bitter?') ? 67 : 62, evidence: 48, custom: null },
          ),
    ),
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

const analyzeMock = vi.mocked(analyze);
const proposeMock = vi.mocked(proposeWording);
const EDIT = fixCopy(HEADING_EDIT).title;
const QUOTE = fixCopy(QUOTE_ADVISORY).title;
const PARAGRAPH = fixCopy(PARAGRAPH_ADVISORY, FINDINGS[PARAGRAPH_ADVISORY.id]).title;

const editor = () => screen.getByLabelText<HTMLTextAreaElement>('Draft text');
const startHere = () => within(screen.getByRole('region', { name: 'Start here' }));
const card = (title: string) => startHere().getByRole('article', { name: title });
const inCard = (title: string, name: string | RegExp) =>
  within(card(title)).getByRole('button', { name });
const advance = () => act(() => vi.advanceTimersByTime(ANALYSIS_DELAY_MS + 50));

/** Opens a card's overflow menu and picks one of its items. */
async function pick(title: string, item: 'Done' | 'Skip' | 'Show me') {
  const trigger = inCard(title, /^More actions/);
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const menu = await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name: item }));
}

function preview(title: string) {
  fireEvent.click(inCard(title, 'Preview'));
  return within(screen.getByRole('dialog', { name: 'Preview' }));
}

function applyEdit() {
  fireEvent.click(preview(EDIT).getByRole('button', { name: 'Apply' }));
}

const toast = () => screen.getByRole('status', { name: 'Last action' });

function openSection(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
  return within(screen.getByRole('region', { name }));
}

/** Opens the fix group of a check in All fixes. */
function openGroup(checkId: keyof typeof CHECK_NAMES) {
  const groups = within(screen.getByRole('region', { name: 'All fixes' }));
  fireEvent.click(groups.getByRole('button', { name: new RegExp(`^${CHECK_NAMES[checkId]}`) }));
  return groups;
}

/** The handled row's own Undo for the heading edit, inside its group. */
const undoEditRow = (groups: ReturnType<typeof openGroup>) =>
  groups.getByRole('button', { name: new RegExp(`^Undo: ${EDIT}`) });

/** Opens the example (the fixture sample) as the More menu would. */
function renderExample() {
  setActiveSlot('fixture');
  return render(<DraftView />);
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
    // The empty My post has no score, so the example's summary does not linger on the home.
    expect(getSummary('draft')).toBeNull();
    expect(editor().value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Use the example instead' }));
    expect(getActiveSlot()).toBe('fixture');
    expect(editor().value).toBe(DRAFT);
  });
});

describe('Draft view, Start here', () => {
  it('ranks scored checks first, the unscored heading edit after them, at most three cards, each with one reason', () => {
    renderExample();
    const cards = startHere().getAllByRole('article');
    expect(cards.length).toBe(3);
    // Question headings is an unscored note, so its ready edit follows the scored advice.
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      QUOTE,
      PARAGRAPH,
      EDIT,
    ]);
    expect(within(card(EDIT)).getByText(fixCopy(HEADING_EDIT).reason)).toBeTruthy();
  });

  it('offers Preview only on an edit card and Show me on advice; Apply only inside the preview', () => {
    renderExample();
    expect(inCard(EDIT, 'Preview')).toBeTruthy();
    expect(within(card(EDIT)).queryByRole('button', { name: 'Show me' })).toBeNull();
    expect(inCard(QUOTE, 'Show me')).toBeTruthy();
    expect(within(card(QUOTE)).queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    const dialog = preview(EDIT);
    expect(dialog.getByText('Nothing changes until you click Apply.')).toBeTruthy();
    expect(editor().value).toBe(DRAFT);
    expect(screen.getAllByRole('button', { name: 'Apply' })).toHaveLength(1);
  });

  it('applies one edit from the preview, then Undo in the toast restores the text', () => {
    renderExample();
    applyEdit();
    expect(editor().value).toContain('## Why does espresso turn bitter?');
    expect(toast().textContent).toContain('Applied');
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(editor().value).toBe(DRAFT);
    expect(card(EDIT)).toBeTruthy();
  });

  it('Done and Skip hide a card, and Undo puts it back', async () => {
    renderExample();
    await pick(QUOTE, 'Done');
    expect(startHere().queryByRole('article', { name: QUOTE })).toBeNull();
    expect(toast().textContent).toContain('Done');
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(card(QUOTE)).toBeTruthy();

    await pick(PARAGRAPH, 'Skip');
    expect(startHere().queryByRole('article', { name: PARAGRAPH })).toBeNull();
    expect(toast().textContent).toContain('Skipped');
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(card(PARAGRAPH)).toBeTruthy();
  });

  it('Show me selects the passage and underlines only that fix', () => {
    renderExample();
    expect(shown.highlights).toEqual([]);
    fireEvent.click(inCard(QUOTE, 'Show me'));
    expect(focused.at(-1)).toEqual(QUOTE_ADVISORY.range);
    expect(shown.highlights.map((h) => [h.range.start, h.active])).toEqual([
      [QUOTE_ADVISORY.range.start, true],
    ]);
  });

  it('carries the Next up anchor on Start here and scrolls to it when the URL asks', () => {
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
      // Once only: later renders (a Skip) do not pull the page back.
      fireEvent.click(inCard(QUOTE, 'Show me'));
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

  it('counts handled fixes', async () => {
    renderExample();
    expect(screen.getByText('0 of 3 handled')).toBeTruthy();
    await pick(QUOTE, 'Skip');
    expect(screen.getByText('1 of 3 handled')).toBeTruthy();
  });
});

describe('Draft view, phone layout', () => {
  const panes = () => screen.getByRole('group', { name: 'Draft or fixes' });
  const paneButton = (name: RegExp) => within(panes()).getByRole('button', { name });
  const bar = () => screen.getByRole('region', { name: 'Selected fix' });
  /** What a phone hides: the editor's paper (the title stays) or the fix rail. */
  const editorColumn = () => editor().parentElement as HTMLElement;
  const rail = () => screen.getByRole('complementary', { name: 'Score and fixes' });

  it('has no switch on an empty draft, so the editor and the empty rail both show', () => {
    render(<DraftView />);
    expect(screen.queryByRole('group', { name: 'Draft or fixes' })).toBeNull();
    expect(editorColumn().className).not.toContain('max-lg:hidden');
    expect(rail().className).not.toContain('max-lg:hidden');
  });

  it('opens a draft with content on Fixes, with the open count, and switches to Draft', () => {
    renderExample();
    const fixes = paneButton(/^Fixes/);
    expect(fixes.getAttribute('aria-pressed')).toBe('true');
    expect(fixes.textContent).toContain('3');
    expect(fixes.textContent).toContain('3 open');
    expect(editorColumn().className).toContain('max-lg:hidden');
    expect(rail().className).not.toContain('max-lg:hidden');

    fireEvent.click(paneButton(/^Draft/));
    expect(paneButton(/^Draft/).getAttribute('aria-pressed')).toBe('true');
    expect(paneButton(/^Fixes/).getAttribute('aria-pressed')).toBe('false');
    expect(editorColumn().className).not.toContain('max-lg:hidden');
    expect(rail().className).toContain('max-lg:hidden');
  });

  it('Show me on advice jumps to the passage and shows a bar with Done and Back to fixes', async () => {
    renderExample();
    expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
    fireEvent.click(inCard(QUOTE, 'Show me'));
    expect(focused.at(-1)).toEqual(QUOTE_ADVISORY.range);
    expect(paneButton(/^Draft/).getAttribute('aria-pressed')).toBe('true');
    expect(within(bar()).getByText(QUOTE)).toBeTruthy();
    expect(within(bar()).queryByRole('button', { name: 'Preview' })).toBeNull();

    fireEvent.click(within(bar()).getByRole('button', { name: 'Done' }));
    expect(startHere().queryByRole('article', { name: QUOTE })).toBeNull();
    expect(toast().textContent).toContain('Done');
    expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
  });

  it("an edit's Show me (in its overflow) offers Preview in the bar, and Apply stays in the preview", async () => {
    renderExample();
    await pick(EDIT, 'Show me');
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
    fireEvent.click(inCard(QUOTE, 'Show me'));
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

  it('shows no fix bar on a desktop layout, and clears a jump when the window widens', () => {
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
      fireEvent.click(inCard(QUOTE, 'Show me'));
      expect(focused.at(-1)).toEqual(QUOTE_ADVISORY.range);
      expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
      // A phone width, a jump, then the window widens past the phone layout.
      mq.matches = false;
      fireEvent.click(paneButton(/^Fixes/));
      fireEvent.click(inCard(QUOTE, 'Show me'));
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

  it('Back to fixes returns to the fix rail and closes the bar', () => {
    renderExample();
    fireEvent.click(inCard(QUOTE, 'Show me'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Back to fixes' }));
    expect(paneButton(/^Fixes/).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Selected fix' })).toBeNull();
    expect(rail().className).not.toContain('max-lg:hidden');
  });

  /** Runs the frame a bar action schedules its focus in. */
  const nextFrame = () =>
    act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  it("Back to fixes moves focus to the card's main button, not to the page", async () => {
    renderExample();
    fireEvent.click(inCard(QUOTE, 'Show me'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Back to fixes' }));
    await nextFrame();
    expect(document.activeElement).toBe(inCard(QUOTE, 'Show me'));
  });

  it("the bar's Done moves focus to the switch's Fixes button", async () => {
    renderExample();
    fireEvent.click(inCard(QUOTE, 'Show me'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Done' }));
    await nextFrame();
    expect(document.activeElement).toBe(paneButton(/^Fixes/));
  });

  for (const close of ['Close', 'Apply'] as const) {
    it(`the bar's Preview returns focus to the switch's Fixes button on ${close}`, async () => {
      renderExample();
      await pick(EDIT, 'Show me');
      fireEvent.click(within(bar()).getByRole('button', { name: 'Preview' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Preview' }));
      fireEvent.click(dialog.getByRole('button', { name: close }));
      expect(document.activeElement).toBe(paneButton(/^Fixes/));
    });
  }

  it("a card's own Preview leaves focus to the dialog's default", () => {
    renderExample();
    const dialog = preview(EDIT);
    const before = document.activeElement;
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(before);
  });

  it('Show in draft from Reader questions also switches to the draft', () => {
    const answered = `${DRAFT}\n## How long should a shot take?\n\nA good espresso shot should take 25 to 30 seconds in total.\n`;
    localStorage.setItem('ce:v1:draft:fixture', answered);
    localStorage.setItem(
      'ce:v1:questions:fixture',
      JSON.stringify([{ text: 'How long should a shot take?', source: 'user' }]),
    );
    vi.useFakeTimers();
    renderExample();
    advance();
    const panel = openSection('Reader questions');
    fireEvent.click(panel.getByRole('button', { name: /Show in draft/ }));
    expect(paneButton(/^Draft/).getAttribute('aria-pressed')).toBe('true');
    expect(within(bar()).getByRole('button', { name: 'Back to fixes' })).toBeTruthy();
    expect(within(bar()).queryByRole('button', { name: 'Done' })).toBeNull();
  });
});

describe('Draft view, groups', () => {
  it('shows one collapsed group per check with its count and at most one chip, and marks nothing on load', () => {
    renderExample();
    const region = screen.getByRole('region', { name: 'All fixes' });
    const groups = within(region);
    const toggle = groups.getByRole('button', { name: 'Quotes say who said them 1' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Only the unscored note's group carries a chip; no grade anywhere.
    const chips = groups.getAllByText(/^(Helps|Not scored)$/);
    expect(chips.map((c) => c.textContent)).toEqual(['Not scored']);
    expect(chips[0]?.closest('li')?.textContent).toContain(CHECK_NAMES['question-headings']);
    expect(region.textContent).not.toMatch(/evidence|Untested/i);
    expect(shown.highlights).toEqual([]);
    expect(shown.selectedRanges ?? []).toEqual([]);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // The editor draws only active highlights, so a group's passages go through selectedRanges.
    expect(shown.highlights).toEqual([]);
    expect(shown.selectedRanges?.map((r) => r.start)).toEqual([QUOTE_ADVISORY.range.start]);
  });

  it('underlines the selected fix as the active highlight, not as a group range', () => {
    renderExample();
    fireEvent.click(openGroup('expert-quotes').getByRole('button', { name: /^Show me/ }));
    expect(shown.highlights).toEqual([
      { range: QUOTE_ADVISORY.range, checkId: 'expert-quotes', active: true },
    ]);
    expect(shown.selectedRanges ?? []).toEqual([]);
  });

  it('lists handled fixes in their group with an Undo that lasts after the toast', async () => {
    renderExample();
    await pick(QUOTE, 'Skip');
    const groups = within(screen.getByRole('region', { name: 'All fixes' }));
    fireEvent.click(groups.getByRole('button', { name: /^Quotes say who said them/ }));
    fireEvent.click(groups.getByRole('button', { name: new RegExp(`^Undo: ${QUOTE}`) }));
    expect(card(QUOTE)).toBeTruthy();
  });

  it("ends an open group on Learn more, linking that check's section of Research", () => {
    renderExample();
    const group = openGroup('expert-quotes');
    const link = group.getByRole('link', { name: `Learn more: ${CHECK_NAMES['expert-quotes']}` });
    expect(link.getAttribute('href')).toMatch(/\/research\/?#check-expert-quotes$/);
  });

  it('renders no bulk action anywhere, with every group and section open', async () => {
    renderExample();
    const groups = within(screen.getByRole('region', { name: 'All fixes' }));
    for (const toggle of groups.getAllByRole('button', { expanded: false })) {
      if (!/evidence|Untested/i.test(toggle.textContent ?? '')) fireEvent.click(toggle);
    }
    for (const name of ['Reader questions', 'All 11 checks', 'Test it']) openSection(name);
    const labels = [...screen.getAllByRole('button'), ...screen.queryAllByRole('menuitem')].map(
      (b) => b.textContent ?? '',
    );
    expect(labels.filter((t) => /\b(all|every)\b/i.test(t) && !/^All 11 checks/.test(t))).toEqual(
      [],
    );
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
  });
});

describe('Draft view, the draft text', () => {
  it('does not persist applied statuses, so a reload never hides a suggestion', async () => {
    const first = renderExample();
    applyEdit();
    await pick(QUOTE, 'Skip');
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
    expect(inCard(EDIT, 'Preview')).toBeTruthy();
  });

  it('marks a fix out of date instead of clobbering an edited range', () => {
    renderExample();
    const at = HEADING_EDIT.range.start + 5;
    const edited = `${DRAFT.slice(0, at)}X${DRAFT.slice(at + 1)}`;
    const dialog = preview(EDIT);
    fireEvent.change(editor(), { target: { value: edited } });
    const callsBefore = analyzeMock.mock.calls.length;
    fireEvent.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(editor().value).toBe(edited);
    expect(analyzeMock.mock.calls.length).toBe(callsBefore + 1);
    expect(analyzeMock.mock.calls.at(-1)?.[0]).toBe(edited);
    expect(screen.getByText('Out of date: the text changed.')).toBeTruthy();
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
    // The mock engine proposes nothing over the edited text, so the applied edit is all there is.
    expect(screen.queryByRole('article', { name: EDIT })).toBeNull();
    expect(screen.getByText('1 of 1 handled')).toBeTruthy();

    // The editor's undo is an ordinary change: the original heading is back.
    fireEvent.change(editor(), { target: { value: DRAFT } });
    advance();

    expect(screen.getByText('0 of 3 handled')).toBeTruthy();
    expect(openGroup('question-headings').queryByRole('button', { name: /^Undo: / })).toBeNull();
    applyEdit();
    expect(editor().value).toContain(HEADING_EDIT.after);
  });

  it('clears Out of date once a fresh analysis finds the same text again', () => {
    vi.useFakeTimers();
    renderExample();
    const at = HEADING_EDIT.range.start + 5;
    const edited = `${DRAFT.slice(0, at)}X${DRAFT.slice(at + 1)}`;
    const dialog = preview(EDIT);
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
    const dialog = preview(EDIT);
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
    fireEvent.click(undoEditRow(openGroup('question-headings')));
    expect(screen.queryByText(/^Cannot undo/)).toBeNull();
    expect(editor().value).toBe(`Intro line.\n\n${DRAFT}`);
  });

  it('says Cannot undo, and keeps the text, when the applied text itself was edited', () => {
    renderExample();
    applyEdit();
    const edited = editor().value.replace('turn bitter?', 'turn sour?');
    fireEvent.change(editor(), { target: { value: edited } });
    fireEvent.click(undoEditRow(openGroup('question-headings')));
    expect(screen.getByText('Cannot undo: the applied text was edited since.')).toBeTruthy();
    expect(editor().value).toBe(edited);
  });

  it('Undo after Reset brings back the applied edits, each with its own Undo', () => {
    renderExample();
    applyEdit();
    const applied = editor().value;
    fireEvent.click(screen.getByRole('button', { name: 'Reset to example' }));
    expect(editor().value).toBe(DRAFT);
    expect(screen.getByText('0 of 3 handled')).toBeTruthy();
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(editor().value).toBe(applied);
    expect(screen.getByText('1 of 3 handled')).toBeTruthy();
    fireEvent.click(undoEditRow(openGroup('question-headings')));
    expect(editor().value).toBe(DRAFT);
  });

  it('keeps done and skipped statuses across a reload', async () => {
    const first = renderExample();
    await pick(QUOTE, 'Skip');
    await pick(PARAGRAPH, 'Done');
    first.unmount();
    render(<DraftView />);
    expect(startHere().queryByRole('article', { name: QUOTE })).toBeNull();
    expect(startHere().queryByRole('article', { name: PARAGRAPH })).toBeNull();
    expect(screen.getByText('2 of 3 handled')).toBeTruthy();
  });

  it('loads, edits and analyzes when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    renderExample();
    await pick(QUOTE, 'Done');
    expect(screen.getByText('1 of 3 handled')).toBeTruthy();
    expect(screen.getByText('62')).toBeTruthy();
    vi.useFakeTimers();
    const edited = `${DRAFT}More text.\n`;
    fireEvent.change(editor(), { target: { value: edited } });
    advance();
    expect(analyzeMock.mock.calls.at(-1)?.[0]).toBe(edited);
    expect(screen.getByText('62')).toBeTruthy();
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
    await pick(QUOTE, 'Skip');
    await pick(PARAGRAPH, 'Done');
    // Another view, then back: the draft view mounts afresh within the same page.
    first.unmount();
    vi.useFakeTimers();
    render(<DraftView />);
    advance();
    expect(editor().value).toBe(DRAFT);
    expect(screen.getByText('2 of 3 handled')).toBeTruthy();
    // The home tile reads the same draft: My post, with one Start here fix open.
    expect(draftSummaryFor(MY_POST_SLOT)).toMatchObject({ slot: MY_POST_SLOT, openStartHere: 1 });
  });

  it('Reset to example can be undone from the toast', async () => {
    renderExample();
    await pick(QUOTE, 'Skip');
    const mine = `${DRAFT}My own paragraph.\n`;
    fireEvent.change(editor(), { target: { value: mine } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to example' }));
    expect(editor().value).toBe(DRAFT);
    expect(card(QUOTE)).toBeTruthy();
    fireEvent.click(within(toast()).getByRole('button', { name: 'Undo' }));
    expect(editor().value).toBe(mine);
    expect(startHere().queryByRole('article', { name: QUOTE })).toBeNull();
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

describe('Draft view, score and baseline', () => {
  it('shows the AI-ready score with its one caveat, and the scoring popover', async () => {
    renderExample();
    const score = within(screen.getByRole('region', { name: 'AI-ready score' }));
    expect(score.getByText('62')).toBeTruthy();
    expect(score.getByText(/A writing checklist, not a forecast\./)).toBeTruthy();
    fireEvent.click(score.getByRole('button', { name: 'Scoring' }));
    const pop = within(await screen.findByRole('dialog'));
    expect(pop.getByRole('button', { name: /^Standard/, pressed: true })).toBeTruthy();
    fireEvent.click(pop.getByRole('button', { name: /^By evidence/ }));
    expect(score.getByText('48')).toBeTruthy();
  });

  it('stores the Standard score for the home tile whatever mode is shown', async () => {
    renderExample();
    expect(getSummary('draft')).toMatchObject({ score: 62, baseline: { standard: 62 } });
    const score = within(screen.getByRole('region', { name: 'AI-ready score' }));
    fireEvent.click(score.getByRole('button', { name: 'Scoring' }));
    const pop = within(await screen.findByRole('dialog'));
    fireEvent.click(pop.getByRole('button', { name: /^By evidence/ }));
    expect(score.getByText('48')).toBeTruthy();
    expect(getSummary('draft')?.score).toBe(62);
    const checks = openSection('All 11 checks');
    fireEvent.click(checks.getByRole('button', { name: 'Adjust weights' }));
    fireEvent.change(checks.getByLabelText('Weight for Lists, not long sentences'), {
      target: { value: '1.5' },
    });
    expect(score.getByText('50')).toBeTruthy();
    expect(getSummary('draft')?.score).toBe(62);
  });

  it('switches to Custom when a weight moves', () => {
    renderExample();
    const checks = openSection('All 11 checks');
    fireEvent.click(checks.getByRole('button', { name: 'Adjust weights' }));
    fireEvent.change(checks.getByLabelText('Weight for Lists, not long sentences'), {
      target: { value: '1.5' },
    });
    // Every fixture check scores 0.5, so any non-zero weights give 50.
    expect(
      within(screen.getByRole('region', { name: 'AI-ready score' })).getByText('50'),
    ).toBeTruthy();
  });

  it('keeps the first score as the baseline and counts real edits since', () => {
    vi.useFakeTimers();
    renderExample();
    expect(loadBaseline('fixture')).toEqual({ standard: 62, evidence: 48 });
    expect(screen.queryByText(/since you started/)).toBeNull();
    expect(getSummary('draft')).toMatchObject({
      slot: 'fixture',
      score: 62,
      baseline: { standard: 62, evidence: 48 },
      openStartHere: 3,
      example: true,
    });
    applyEdit();
    advance();
    expect(screen.getByText('+5 since you started')).toBeTruthy();
    expect(getSummary('draft')).toMatchObject({ score: 67, baseline: { standard: 62 } });
  });

  it('does not move the baseline on Done', async () => {
    renderExample();
    await pick(QUOTE, 'Done');
    expect(loadBaseline('fixture')).toEqual({ standard: 62, evidence: 48 });
  });

  it('resets the baseline on a paste that replaces most of the draft', () => {
    vi.useFakeTimers();
    // My post: on an example, such a paste moves to My post instead (tested above).
    render(<DraftView />);
    fireEvent.change(editor(), { target: { value: DRAFT } });
    advance();
    applyEdit();
    advance();
    expect(screen.getByText('+5 since you started')).toBeTruthy();
    const pasted = `${DRAFT.replace('turns bitter', 'turn bitter?')}`.replace(
      'Bitter shots',
      'Long shots',
    );
    fireEvent.change(editor(), { target: { value: `# Other\n\n${'x '.repeat(80)}` } });
    advance();
    fireEvent.change(editor(), { target: { value: pasted } });
    advance();
    expect(loadBaseline(MY_POST_SLOT)).toEqual({ standard: 67, evidence: 48 });
    expect(screen.queryByText(/since you started/)).toBeNull();
  });

  it('resets the baseline on Reset to example', () => {
    localStorage.setItem('ce:v1:baseline:fixture', JSON.stringify({ standard: 10, evidence: 10 }));
    vi.useFakeTimers();
    renderExample();
    expect(screen.getByText('+52 since you started')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to example' }));
    advance();
    expect(loadBaseline('fixture')).toEqual({ standard: 62, evidence: 48 });
    expect(screen.queryByText(/since you started/)).toBeNull();
  });
});

describe('Draft view, Reader questions', () => {
  const GENERATED = generateQuestions(DRAFT).map((q) => q.text);
  const lastQuestions = () => analyzeMock.mock.calls.at(-1)?.[1]?.questions;

  it('starts collapsed, scores no template question until asked, then analyzes with them', () => {
    vi.useFakeTimers();
    renderExample();
    expect(screen.queryByRole('region', { name: 'Reader questions' })).toBeNull();
    const panel = openSection('Reader questions');
    expect(panel.queryAllByRole('textbox', { name: /^Question \d/ })).toEqual([]);
    fireEvent.click(panel.getByRole('button', { name: 'Suggest from my draft' }));
    advance();
    expect(lastQuestions()).toEqual(GENERATED);
    expect(suggestWithLocalModel).not.toHaveBeenCalled();
    expect(panel.queryByRole('button', { name: /local AI/ })).toBeNull();
  });

  const fields = (panel: ReturnType<typeof openSection>) =>
    panel
      .queryAllByRole('textbox', { name: /^Question \d/ })
      .map((el) => (el as HTMLInputElement).value);
  const addQuestion = (panel: ReturnType<typeof openSection>, text: string) => {
    const field = panel.getByRole('textbox', { name: 'New question' });
    fireEvent.change(field, { target: { value: text } });
    fireEvent.submit(field);
  };

  it("keeps each draft's questions across a reload, even an emptied list", () => {
    const first = renderExample();
    addQuestion(openSection('Reader questions'), 'How long should a shot take?');
    first.unmount();
    expect(JSON.parse(localStorage.getItem('ce:v1:questions:fixture') ?? '[]').at(-1)).toEqual({
      text: 'How long should a shot take?',
      source: 'user',
    });

    const second = render(<DraftView />);
    const panel = openSection('Reader questions');
    fireEvent.click(panel.getByRole('button', { name: 'Suggest from my draft' }));
    expect(fields(panel)[0]).toBe('How long should a shot take?');
    expect(fields(panel).length).toBeGreaterThan(1);
    for (let i = fields(panel).length; i > 0; i--)
      fireEvent.click(panel.getByRole('button', { name: `Remove question ${i}` }));
    second.unmount();
    expect(localStorage.getItem('ce:v1:questions:fixture')).toBe('[]');

    vi.useFakeTimers();
    render(<DraftView />);
    expect(fields(openSection('Reader questions'))).toEqual([]);
    advance();
    expect(lastQuestions()).toEqual([]);
  });

  it('suggests, adds and analyzes questions when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.useFakeTimers();
    renderExample();
    const panel = openSection('Reader questions');
    fireEvent.click(panel.getByRole('button', { name: 'Suggest from my draft' }));
    expect(fields(panel)).toEqual(GENERATED);
    addQuestion(panel, 'How long should a shot take?');
    advance();
    expect(fields(panel).at(-1)).toBe('How long should a shot take?');
    expect(lastQuestions()).toEqual([...GENERATED, 'How long should a shot take?']);
  });

  const pageList = (panel: ReturnType<typeof openSection>) =>
    panel.queryByRole('list', { name: /^Page questions used for/ });

  it("lists the page questions the reader's-words check measures until the author has their own", () => {
    vi.useFakeTimers();
    renderExample();
    advance();
    const panel = openSection('Reader questions');
    const page = pageQuestions(DRAFT).map((q) => q.text);
    expect(page.length).toBeGreaterThan(0);
    const list = pageList(panel);
    expect(
      list &&
        within(list)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
    ).toEqual(page);
    // Generated questions from "Suggest from my draft" do not replace them.
    fireEvent.click(panel.getByRole('button', { name: 'Suggest from my draft' }));
    advance();
    expect(pageList(panel)).not.toBeNull();
    // A question of the author's own does.
    addQuestion(panel, 'How long should a shot take?');
    advance();
    expect(pageList(panel)).toBeNull();
  });

  it('says which questions the draft answers, with Show in draft', () => {
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
    renderExample();
    advance();
    const panel = openSection('Reader questions');
    const rows = panel.getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Answered');
    expect(rows[1]?.textContent).toContain('Not answered yet');
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: /Show in draft/ }));
    const r = focused.at(-1);
    expect(r && answered.slice(r.start, r.end)).toBe('How long should a shot take?');
  });
});

describe('Draft view, local AI', () => {
  it('offers Suggest wording on advice only after Connect local AI, and asks nothing before', async () => {
    const { probeOllama, DEFAULT_SETTINGS } = await import('@citation-equity/bench');
    vi.mocked(probeOllama).mockResolvedValue({ reachable: true, models: [DEFAULT_SETTINGS.model] });
    const proposal: Suggestion = {
      ...PARAGRAPH_ADVISORY,
      kind: 'edit',
      after: 'Bitter espresso shots run long.',
    };
    proposeMock.mockResolvedValue(proposal);
    renderExample();
    expect(screen.queryByRole('button', { name: 'Suggest wording' })).toBeNull();
    const test = openSection('Test it');
    expect(test.getByText('Sends your text only to the AI on this computer.')).toBeTruthy();
    expect(probeOllama).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(test.getByRole('button', { name: 'Connect local AI' }));
    });
    expect(inCard(PARAGRAPH, 'Suggest wording')).toBeTruthy();
    // Collapsing Test it hides it but keeps the connection.
    fireEvent.click(screen.getByRole('button', { name: /^Test it/ }));
    expect(screen.queryByRole('region', { name: 'Test it' })).toBeNull();
    expect(openSection('Test it').getByText(/^Connected to/)).toBeTruthy();
    expect(within(card(QUOTE)).queryByRole('button', { name: 'Suggest wording' })).toBeNull();
    expect(within(card(EDIT)).queryByRole('button', { name: 'Suggest wording' })).toBeNull();
    await act(async () => {
      fireEvent.click(inCard(PARAGRAPH, 'Suggest wording'));
    });
    const dialog = within(screen.getByRole('dialog', { name: 'Preview' }));
    expect(dialog.getByText(proposal.after ?? '-')).toBeTruthy();
    expect(editor().value).toBe(DRAFT);
    fireEvent.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(editor().value).toContain('Bitter espresso shots run long.');
  });
});
