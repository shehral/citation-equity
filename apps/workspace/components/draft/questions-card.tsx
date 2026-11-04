'use client';

import {
  namedWords,
  type QuestionLineLabels,
  type QuestionReport,
  type QuestionRow,
  type Range,
  type TestLabel,
} from '@citation-equity/engine';
import { Check, Circle, CircleCheck, LocateFixed, WandSparkles } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WordingState } from './fix-card';

/**
 * The most missing words a line names, as many as the reader-words advice names, so the line
 * never reads as a list to paste in.
 */

type ChipScope = 'card' | 'row';

interface QuestionsCardProps {
  /** The engine's question report for the analyzed draft. */
  report: QuestionReport;
  /** Each row's two line labels (words up top, answered), in the report's row order. */
  rowLabels: QuestionLineLabels[];
  /**
   * Renders one label chip. `scope` says whether it stands for the card (the first row's pair,
   * beside or under the heading) or for one row; `row` is the index of the row whose label it
   * is (0 for the card's), so the chip can say which question our tests did not use.
   */
  renderChip(label: TestLabel, scope: ChipScope, row: number): ReactNode;
  /** True while the analysis trails the editor. */
  pending: boolean;
  editorOpen: boolean;
  onToggleEditor(): void;
  /** The question editor, shown under the list while open (always when there are no questions). */
  editor: ReactNode;
  /** Selects `range` in the draft, for the line of `question` whose Show was pressed. */
  onShowRange(range: Range, question: string): void;
  /** True when Suggest wording may be offered on an unanswered row (a local model connected). */
  canSuggest: boolean;
  /** The wording helper's state per row, keyed by the row's question. */
  wording: Record<string, WordingState>;
  /** Rewrites the row's `answerRange` with the local model; nothing changes before Apply. */
  onSuggestWording?(row: QuestionRow): void;
}

const samePair = (a: QuestionLineLabels, b: QuestionLineLabels) =>
  a.words === b.words && a.answer === b.answer;

/** `Missing up top: "fix"`, naming at most the engine's MAX_NAMED words, then how many more. */
function missingLine(missing: string[]): string {
  return `Missing up top: ${namedWords(missing)}`;
}

/**
 * A pair of labels as chips: one when the two lines agree, else one per line, each named by its
 * line, so a chip never stands for a line it does not describe.
 */
function Chips({
  labels,
  scope,
  row,
  renderChip,
}: {
  labels: QuestionLineLabels;
  scope: ChipScope;
  row: number;
  renderChip: QuestionsCardProps['renderChip'];
}) {
  if (labels.words === labels.answer) return <>{renderChip(labels.words, scope, row)}</>;
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <span>Words up top</span> {renderChip(labels.words, scope, row)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span>Answered</span> {renderChip(labels.answer, scope, row)}
      </span>
    </>
  );
}

/** One line of a row: met or not, its words, and Show when it points at a passage. */
function Line({
  met,
  text,
  showName,
  onShow,
  children,
}: {
  met: boolean;
  text: string;
  /** The Show button's accessible name; no button without it. */
  showName?: string;
  onShow?(): void;
  children?: ReactNode;
}) {
  const Icon = met ? Check : Circle;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <Icon
          aria-hidden="true"
          className={cn('size-3.5 shrink-0', met ? 'text-done' : 'text-ink-faint')}
        />
        <span className={cn('min-w-0 flex-1', met && 'text-ink-soft')}>{text}</span>
        {showName !== undefined && (
          <Button type="button" size="xs" variant="outline" aria-label={showName} onClick={onShow}>
            <LocateFixed aria-hidden="true" />
            Show
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

function QuestionItem({
  row,
  index,
  chips,
  renderChip,
  onShowRange,
  canSuggest,
  wording,
  onSuggestWording,
}: {
  row: QuestionRow;
  index: number;
  /** The row's own labels, when they differ from the card's; null otherwise. */
  chips: QuestionLineLabels | null;
} & Pick<QuestionsCardProps, 'renderChip' | 'onShowRange' | 'canSuggest' | 'onSuggestWording'> & {
    wording?: WordingState;
  }) {
  const { question, words, answer } = row;
  const asking = wording?.status === 'asking';
  const RowIcon = row.covered ? CircleCheck : Circle;
  return (
    <article aria-label={question} className="space-y-1.5">
      <div className="flex items-start gap-2">
        <RowIcon
          aria-hidden="true"
          className={cn('mt-0.5 size-4 shrink-0', row.covered ? 'text-done' : 'text-ink-faint')}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <span className="sr-only">{row.covered ? 'Covered' : 'Not covered yet'}</span>
          <p className="font-medium text-sm leading-snug">{question}</p>
          {chips !== null && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-soft text-xs">
              <Chips labels={chips} scope="row" row={index} renderChip={renderChip} />
            </div>
          )}
        </div>
      </div>
      <div className="space-y-1.5 pl-6">
        {words !== null &&
          (words.missing.length === 0 ? (
            <Line met text="Words up top" />
          ) : (
            <Line
              met={false}
              text={missingLine(words.missing)}
              showName={`Show where: words up top, "${question}"`}
              onShow={() => onShowRange(row.wordsRange, question)}
            />
          ))}
        <Line
          met={answer.covered}
          text={answer.covered ? 'Answered' : 'No direct answer yet'}
          showName={`Show where: answer, "${question}"`}
          onShow={() => onShowRange(answer.range, question)}
        >
          {!answer.covered && (
            <>
              {answer.message !== null && (
                <p className="pl-5.5 text-ink-soft text-xs">{answer.message}</p>
              )}
              {canSuggest && onSuggestWording && (
                <div className="pl-5.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={asking}
                    onClick={() => onSuggestWording(row)}
                  >
                    <WandSparkles aria-hidden="true" />
                    {asking ? 'Writing...' : 'Suggest wording'}
                  </Button>
                </div>
              )}
              {wording?.status === 'error' && (
                <div role="status" className="ml-5.5 space-y-2 rounded-md border p-2 text-sm">
                  {wording.message}
                </div>
              )}
            </>
          )}
        </Line>
      </div>
    </article>
  );
}

/**
 * Questions covered: N of M. Each question needs (a) its key words up top and (b) a section that
 * answers it directly; it is covered when both are in place. The rows are read from the text, so
 * they carry no Done or Skip. The chips come from `rowLabels` through `renderChip`: the first
 * row's pair stands for the card, and a row whose pair differs shows its own. The card's own chips
 * sit in a `data-card-chips` container, which the e2e specs read.
 */
export function QuestionsCard({
  report,
  rowLabels,
  renderChip,
  pending,
  editorOpen,
  onToggleEditor,
  editor,
  onShowRange,
  canSuggest,
  wording,
  onSuggestWording,
}: QuestionsCardProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const lineId = `${id}-line`;
  const toggleId = `${id}-toggle`;
  const editorId = `${id}-editor`;
  const { rows } = report;
  const empty = rows.length === 0;
  const cardLabels = rowLabels[0];
  const fromPage = report.from === 'page';

  return (
    <section aria-labelledby={headingId} className="rounded-lg border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="font-semibold text-base leading-snug">
          {empty ? 'No questions yet' : `Questions covered: ${report.covered} of ${rows.length}`}
        </h3>
        {!empty && cardLabels && cardLabels.words === cardLabels.answer && (
          <span data-card-chips="" className="ml-auto">
            {renderChip(cardLabels.words, 'card', 0)}
          </span>
        )}
      </div>
      {!empty && cardLabels && cardLabels.words !== cardLabels.answer && (
        <div
          data-card-chips=""
          className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-soft text-xs"
        >
          <Chips labels={cardLabels} scope="card" row={0} renderChip={renderChip} />
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {pending ? 'Updating' : ''}
      </p>
      <p id={lineId} className="mt-1 text-ink-soft text-sm">
        {empty
          ? 'Add the questions your readers ask.'
          : 'Each needs its key words up top and a section that answers it.'}
      </p>
      {!empty && (
        <ul className="mt-3 space-y-3">
          {rows.map((row, i) => {
            const labels = rowLabels[i];
            const own =
              labels !== undefined && cardLabels !== undefined && !samePair(labels, cardLabels)
                ? labels
                : null;
            return (
              <li key={row.question}>
                <QuestionItem
                  row={row}
                  index={i}
                  chips={own}
                  renderChip={renderChip}
                  onShowRange={onShowRange}
                  canSuggest={canSuggest}
                  wording={wording[row.question]}
                  onSuggestWording={onSuggestWording}
                />
              </li>
            );
          })}
        </ul>
      )}
      {!empty && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {fromPage && (
            <p className="text-ink-soft text-sm">From your title. Add your readers' own.</p>
          )}
          <Button
            id={toggleId}
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={editorOpen}
            aria-controls={editorOpen ? editorId : undefined}
            onClick={onToggleEditor}
          >
            {fromPage ? 'Add questions' : 'Edit questions'}
          </Button>
        </div>
      )}
      {(editorOpen || empty) && (
        <section id={editorId} aria-labelledby={empty ? lineId : toggleId} className="mt-3">
          {editor}
        </section>
      )}
    </section>
  );
}
