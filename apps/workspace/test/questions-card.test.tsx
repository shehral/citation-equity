import {
  analyze,
  QUESTION_LABELS,
  type QuestionLineLabels,
  type QuestionReport,
  type QuestionRow,
  TEST_LABEL_TEXT,
  type TestLabel,
} from '@citation-equity/engine';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabelChip } from '@/components/check-chip';
import type { WordingState } from '@/components/draft/fix-card';
import { QuestionsCard } from '@/components/draft/questions-card';
import { labelTooltip } from '@/lib/glossary';
import { initialQuestions, labelsFor } from '@/lib/questions';
import { getSample } from '@/lib/samples';

afterEach(cleanup);

const espresso = getSample('espresso-bitterness');
if (espresso.after === undefined) throw new Error('the espresso example has no after draft');
// The example's pack questions are the reader's own; without questions the page's are measured.
const pack = initialQuestions(espresso);
const packTexts = pack.map((q) => q.text);
const before = analyze(espresso.before, { questions: packTexts }).questions;
const after = analyze(espresso.after, { questions: packTexts }).questions;
const pageReport = analyze(espresso.before).questions;
const readerLabels = pack.map(labelsFor);
const pageLabels = pageReport.rows.map(() => QUESTION_LABELS.page);

/** A row as the engine shapes it, for the cases the samples do not hold. */
function row(question: string, patch: Partial<QuestionRow> = {}): QuestionRow {
  return {
    question,
    words: { found: 2, total: 2, missing: [] },
    wordsRange: { start: 0, end: 10 },
    answer: { question, covered: false, range: { start: 20, end: 30 }, message: 'No section.' },
    answerRange: { start: 30, end: 30 },
    covered: false,
    ...patch,
  };
}
const yours = (rows: QuestionRow[]): QuestionReport => ({
  from: 'yours',
  rows,
  covered: rows.filter((r) => r.covered).length,
});
const pair = (words: TestLabel, answer: TestLabel = words): QuestionLineLabels => ({
  words,
  answer,
});

/**
 * Renders each chip as the draft view will (a LabelChip with its tooltip), marked with the scope
 * and row the card asked for, so the test can tell the card's chips from a row's.
 */
const renderChip = (label: TestLabel, scope: 'card' | 'row', index: number): ReactNode => (
  <span data-scope={scope} data-row={index}>
    <LabelChip label={label} tooltip={labelTooltip(label, { card: scope === 'card' })} />
  </span>
);

interface Props {
  report: QuestionReport;
  rowLabels: QuestionLineLabels[];
  pending?: boolean;
  editorOpen?: boolean;
  canSuggest?: boolean;
  wording?: Record<string, WordingState>;
  withSuggest?: boolean;
}

function renderCard({
  report,
  rowLabels,
  pending = false,
  editorOpen = false,
  canSuggest = false,
  wording = {},
  withSuggest = true,
}: Props) {
  const handlers = {
    onToggleEditor: vi.fn(),
    onShowRange: vi.fn(),
    onSuggestWording: vi.fn(),
  };
  const view = render(
    <QuestionsCard
      report={report}
      rowLabels={rowLabels}
      renderChip={renderChip}
      pending={pending}
      editorOpen={editorOpen}
      onToggleEditor={handlers.onToggleEditor}
      editor={<div data-testid="editor">the question editor</div>}
      onShowRange={handlers.onShowRange}
      canSuggest={canSuggest}
      wording={wording}
      onSuggestWording={withSuggest ? handlers.onSuggestWording : undefined}
    />,
  );
  const card = screen.getByRole('region', { name: /^Questions covered|^No questions yet/ });
  return { ...handlers, view, card, inCard: within(card) };
}

const article = (question: string) => screen.getByRole('article', { name: question });
const cardChips = (card: HTMLElement) =>
  [...card.querySelectorAll('[data-scope="card"]')].map((el) => el.textContent);
const rowChips = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-scope="row"]')].map((c) => c.textContent);

describe('QuestionsCard on the espresso example, with its pack questions', () => {
  it('reads Questions covered: N of M as a section heading, then the line', () => {
    const { card, inCard } = renderCard({ report: before, rowLabels: readerLabels });
    expect(card.tagName).toBe('SECTION');
    const heading = inCard.getByRole('heading', { level: 3 });
    expect(heading.textContent).toBe('Questions covered: 0 of 4');
    expect(heading.textContent).toMatch(/^Questions covered: \d+ of \d+$/);
    expect(
      inCard.getByText('Each needs its key words up top and a section that answers it.'),
    ).toBeTruthy();
  });

  it("shows the reader's label beside the heading as one chip, with the card's tooltip", () => {
    const { card } = renderCard({ report: before, rowLabels: readerLabels });
    const { words, answer } = QUESTION_LABELS.reader;
    // E5 may move line (b) of the reader's own questions; the card follows the engine's table.
    const expected = words === answer ? [words] : [words, answer];
    expect(cardChips(card)).toEqual(expected.map((l) => TEST_LABEL_TEXT[l]));
    const chip = card.querySelector(`[data-scope="card"] [data-label-chip="${words}"]`);
    expect(chip?.getAttribute('title')).toBe(labelTooltip(words, { card: true }));
    // Every row has the card's pair, so no row carries a chip of its own.
    for (const q of packTexts) expect(rowChips(article(q))).toEqual([]);
  });

  it('lists one article per question, in list order, inside list items', () => {
    renderCard({ report: before, rowLabels: readerLabels });
    const rows = screen.getAllByRole('article');
    expect(rows.map((el) => el.getAttribute('aria-label'))).toEqual(packTexts);
    for (const el of rows) expect(el.parentElement?.tagName).toBe('LI');
    for (const el of rows) expect(within(el).getByText('Not covered yet')).toBeTruthy();
  });

  it("names the missing words, says Words up top when none are missing, and gives the engine's reason verbatim", () => {
    renderCard({ report: before, rowLabels: readerLabels });
    const [first, second] = before.rows;
    if (!first || !second) throw new Error('expected four rows');
    expect(within(article(first.question)).getByText('Words up top')).toBeTruthy();
    expect(within(article(second.question)).getByText('Missing up top: "fix"')).toBeTruthy();
    for (const r of before.rows) {
      const el = within(article(r.question));
      expect(el.getByText('No direct answer yet')).toBeTruthy();
      expect(r.answer.message).not.toBeNull();
      expect(el.getByText(r.answer.message ?? '')).toBeTruthy();
    }
  });

  it('marks a covered question and its answered line on the after draft', () => {
    renderCard({ report: after, rowLabels: readerLabels });
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Questions covered: 1 of 4');
    const covered = within(article('How do I fix bitter espresso?'));
    expect(covered.getByText('Covered')).toBeTruthy();
    expect(covered.getByText('Answered')).toBeTruthy();
    expect(covered.queryByText('No direct answer yet')).toBeNull();
  });

  it("passes each line's range and the question to Show", () => {
    const { onShowRange } = renderCard({ report: before, rowLabels: readerLabels });
    const [first, second] = before.rows;
    if (!first || !second) throw new Error('expected four rows');
    // A met words line has nothing to show.
    expect(
      screen.queryByRole('button', { name: `Show where: words up top, "${first.question}"` }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: `Show where: words up top, "${second.question}"` }),
    );
    expect(onShowRange).toHaveBeenLastCalledWith(second.wordsRange, second.question);
    fireEvent.click(
      screen.getByRole('button', { name: `Show where: answer, "${second.question}"` }),
    );
    expect(onShowRange).toHaveBeenLastCalledWith(second.answer.range, second.question);
  });

  it('shows an answered line too', () => {
    const { onShowRange } = renderCard({ report: after, rowLabels: readerLabels });
    const answered = after.rows.find((r) => r.answer.covered);
    if (!answered) throw new Error('expected an answered row');
    fireEvent.click(
      screen.getByRole('button', { name: `Show where: answer, "${answered.question}"` }),
    );
    expect(onShowRange).toHaveBeenCalledWith(answered.answer.range, answered.question);
  });

  it('offers Suggest wording only with canSuggest, only on unanswered rows, and passes the row', () => {
    renderCard({ report: after, rowLabels: readerLabels });
    expect(screen.queryByRole('button', { name: 'Suggest wording' })).toBeNull();
    cleanup();

    const { onSuggestWording } = renderCard({
      report: after,
      rowLabels: readerLabels,
      canSuggest: true,
    });
    for (const r of after.rows) {
      const button = within(article(r.question)).queryByRole('button', {
        name: 'Suggest wording',
      });
      expect(button === null, r.question).toBe(r.answer.covered);
    }
    const open = after.rows.find((r) => !r.answer.covered);
    if (!open) throw new Error('expected an unanswered row');
    fireEvent.click(
      within(article(open.question)).getByRole('button', { name: 'Suggest wording' }),
    );
    expect(onSuggestWording).toHaveBeenCalledWith(open);
  });

  it('offers no Suggest wording without a handler', () => {
    renderCard({ report: before, rowLabels: readerLabels, canSuggest: true, withSuggest: false });
    expect(screen.queryByRole('button', { name: 'Suggest wording' })).toBeNull();
  });

  it("shows a row's wording state: Writing... while it asks, its message when it fails", () => {
    const [first, second] = before.rows;
    if (!first || !second) throw new Error('expected four rows');
    renderCard({
      report: before,
      rowLabels: readerLabels,
      canSuggest: true,
      wording: {
        [first.question]: { status: 'asking' },
        [second.question]: { status: 'error', message: <p>The local AI is not running.</p> },
      },
    });
    const asking = within(article(first.question)).getByRole('button', { name: 'Writing...' });
    expect((asking as HTMLButtonElement).disabled).toBe(true);
    const failed = within(article(second.question));
    expect(failed.getByRole('status').textContent).toBe('The local AI is not running.');
    expect(failed.getByRole('button', { name: 'Suggest wording' })).toBeTruthy();
  });
});

describe('QuestionsCard chips', () => {
  it('shows one Not tested chip on the page fallback, with From your title and Add questions', () => {
    expect(pageReport.from).toBe('page');
    expect(pageReport.rows.length).toBeGreaterThan(0);
    const { card, inCard, onToggleEditor } = renderCard({
      report: pageReport,
      rowLabels: pageLabels,
    });
    expect(cardChips(card)).toEqual([TEST_LABEL_TEXT['not-tested']]);
    expect(card.querySelectorAll('[data-scope="row"]')).toHaveLength(0);
    expect(inCard.getByText("From your title. Add your readers' own.")).toBeTruthy();
    expect(inCard.queryByRole('button', { name: 'Edit questions' })).toBeNull();
    const add = inCard.getByRole('button', { name: 'Add questions' });
    expect(add.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(add);
    expect(onToggleEditor).toHaveBeenCalledTimes(1);
  });

  it("a mixed list: rows whose pair differs from the first row's carry their own chip after the question", () => {
    const report = yours([row('Why is it bitter?'), row('espresso shot time'), row('Is it sour?')]);
    const { card } = renderCard({
      report,
      rowLabels: [pair('helped'), pair('not-tested'), pair('helped')],
    });
    expect(cardChips(card)).toEqual([TEST_LABEL_TEXT.helped]);
    expect(rowChips(article('Why is it bitter?'))).toEqual([]);
    expect(rowChips(article('Is it sour?'))).toEqual([]);
    const keyword = article('espresso shot time');
    expect(rowChips(keyword)).toEqual([TEST_LABEL_TEXT['not-tested']]);
    const chip = keyword.querySelector('[data-scope="row"]');
    expect(chip?.getAttribute('data-row')).toBe('1');
    const question = within(keyword).getByText('espresso shot time');
    expect(question.compareDocumentPosition(chip as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('differing line labels: two chips under the heading, Words up top and Answered', () => {
    const report = yours([row('Why is it bitter?'), row('Is it sour?'), row('How long?')]);
    const { card, inCard } = renderCard({
      report,
      rowLabels: [pair('not-tested', 'helped'), pair('not-tested', 'helped'), pair('helped')],
    });
    const chips = [...card.querySelectorAll('[data-scope="card"]')];
    expect(chips.map((c) => c.parentElement?.textContent)).toEqual([
      `Words up top ${TEST_LABEL_TEXT['not-tested']}`,
      `Answered ${TEST_LABEL_TEXT.helped}`,
    ]);
    // Under the heading, not beside it.
    const heading = inCard.getByRole('heading', { level: 3 });
    expect(heading.parentElement?.contains(chips[0] as Node)).toBe(false);
    expect(
      heading.compareDocumentPosition(chips[0] as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // The second row matches the card; the third differs and shows its one chip.
    expect(rowChips(article('Is it sour?'))).toEqual([]);
    expect(rowChips(article('How long?'))).toEqual([TEST_LABEL_TEXT.helped]);
  });

  it("marks the card's own chips, and only those, with one container hook", () => {
    const report = yours([row('Why is it bitter?'), row('How long?')]);
    for (const rowLabels of [
      [pair('helped'), pair('not-tested')],
      [pair('not-tested', 'helped'), pair('helped')],
    ]) {
      const { card, view } = renderCard({ report, rowLabels });
      const hooked = [...card.querySelectorAll('[data-card-chips] [data-scope]')];
      expect(hooked.length).toBeGreaterThan(0);
      expect(hooked).toEqual([...card.querySelectorAll('[data-scope="card"]')]);
      view.unmount();
    }
  });

  it('a row whose two labels differ shows both, each named by its line', () => {
    const report = yours([row('Why is it bitter?'), row('espresso shot time')]);
    renderCard({ report, rowLabels: [pair('helped'), pair('not-tested', 'helped')] });
    const chips = [...article('espresso shot time').querySelectorAll('[data-scope="row"]')];
    expect(chips.map((c) => c.parentElement?.textContent)).toEqual([
      `Words up top ${TEST_LABEL_TEXT['not-tested']}`,
      `Answered ${TEST_LABEL_TEXT.helped}`,
    ]);
  });
});

describe('QuestionsCard lines', () => {
  it('names at most three missing words, then "and N more"', () => {
    const words = (missing: string[]) => ({ found: 0, total: missing.length, missing });
    const report = yours([
      row('three', { words: words(['grind', 'water', 'time']) }),
      row('four', { words: words(['grind', 'water', 'time', 'dose']) }),
      row('five', { words: words(['grind', 'water', 'time', 'dose', 'ratio']) }),
    ]);
    renderCard({ report, rowLabels: report.rows.map(() => pair('helped')) });
    expect(
      within(article('three')).getByText('Missing up top: "grind", "water", "time"'),
    ).toBeTruthy();
    expect(
      within(article('four')).getByText('Missing up top: "grind", "water", "time" and 1 more'),
    ).toBeTruthy();
    expect(
      within(article('five')).getByText('Missing up top: "grind", "water", "time" and 2 more'),
    ).toBeTruthy();
  });

  it('shows only the answer line for a question with no key words to look for', () => {
    const report = yours([row('How does it work?', { words: null })]);
    renderCard({ report, rowLabels: [pair('helped')] });
    const el = within(article('How does it work?'));
    expect(el.queryByText(/up top/)).toBeNull();
    expect(el.queryByRole('button', { name: /words up top/ })).toBeNull();
    expect(el.getByText('No direct answer yet')).toBeTruthy();
  });
});

describe('QuestionsCard footer, editor and states', () => {
  it('toggles the editor under the list with Edit questions', () => {
    const { inCard, onToggleEditor, view } = renderCard({
      report: before,
      rowLabels: readerLabels,
    });
    expect(inCard.queryByText("From your title. Add your readers' own.")).toBeNull();
    const toggle = inCard.getByRole('button', { name: 'Edit questions' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('editor')).toBeNull();
    fireEvent.click(toggle);
    expect(onToggleEditor).toHaveBeenCalledTimes(1);

    view.rerender(
      <QuestionsCard
        report={before}
        rowLabels={readerLabels}
        renderChip={renderChip}
        pending={false}
        editorOpen
        onToggleEditor={onToggleEditor}
        editor={<div data-testid="editor">the question editor</div>}
        onShowRange={vi.fn()}
        canSuggest={false}
        wording={{}}
      />,
    );
    const open = inCard.getByRole('button', { name: 'Edit questions' });
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const region = inCard.getByRole('region', { name: 'Edit questions' });
    expect(open.getAttribute('aria-controls')).toBe(region.id);
    expect(within(region).getByTestId('editor')).toBeTruthy();
    // Under the list.
    const list = inCard.getByRole('list');
    expect(list.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('with no questions at all: No questions yet, the line, the editor open, no chip', () => {
    const report: QuestionReport = { from: 'page', rows: [], covered: 0 };
    const { card, inCard } = renderCard({ report, rowLabels: [] });
    expect(inCard.getByRole('heading', { level: 3 }).textContent).toBe('No questions yet');
    expect(inCard.getByText('Add the questions your readers ask.')).toBeTruthy();
    expect(inCard.queryByText(/Questions covered/)).toBeNull();
    expect(inCard.queryByText(/From your title/)).toBeNull();
    expect(inCard.queryByRole('list')).toBeNull();
    expect(inCard.queryAllByRole('button')).toHaveLength(0);
    expect(card.querySelectorAll('[data-label-chip]')).toHaveLength(0);
    const region = inCard.getByRole('region', { name: 'Add the questions your readers ask.' });
    expect(within(region).getByTestId('editor')).toBeTruthy();
  });

  it('says Updating to screen readers while the analysis trails the editor', () => {
    const { card, view } = renderCard({ report: before, rowLabels: readerLabels });
    const live = card.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('');
    view.rerender(
      <QuestionsCard
        report={before}
        rowLabels={readerLabels}
        renderChip={renderChip}
        pending
        editorOpen={false}
        onToggleEditor={vi.fn()}
        editor={null}
        onShowRange={vi.fn()}
        canSuggest={false}
        wording={{}}
      />,
    );
    expect(card.querySelector('[aria-live="polite"]')?.textContent).toBe('Updating');
    expect(live?.className).toContain('sr-only');
  });
});
