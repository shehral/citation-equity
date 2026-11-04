'use client';

import { generateQuestions, type SiteQuestion } from '@citation-equity/engine';
import { ListPlus, Plus, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { textLink } from '@/components/page-shell';
import { SearchesBehind } from '@/components/questions/searches-behind';
import { Button } from '@/components/ui/button';
import { classifyBenchError } from '@/lib/bench';
import { suggestWithLocalModel } from '@/lib/question-helper';
import {
  editProblem,
  hasQuestion,
  MAX_QUESTIONS,
  mergeQuestions,
  SOURCE_LABELS,
  type WorkspaceQuestion,
} from '@/lib/questions';
import {
  draftSourceOf,
  EMPTY_SITE_INPUT,
  getSiteInput,
  siteQuestionsOf,
  subscribeSiteInput,
} from '@/lib/site-questions';
import { cn } from '@/lib/utils';
import { VIEW_HREF } from '@/lib/views';
import { ModelMissingNote, OllamaInstructions, UnreachableNote } from './ollama-help';

interface ReaderQuestionsProps {
  questions: WorkspaceQuestion[];
  onChange(questions: WorkspaceQuestion[]): void;
  /** The editor's current text, which From headings and Local AI read. */
  markdown: string;
  /** The model Connect local AI found; null before that click. */
  localModel: string | null;
}

/** How many of the home's questions From your list offers at once. */
const FROM_LIST_SHOWN = 10;

const field = cn(
  'h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm',
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50',
);

const added = (n: number, from: string) =>
  n === 0 ? `No new questions ${from}.` : `Added ${n} question${n === 1 ? '' : 's'} ${from}.`;

/** What the editor says when the local model fails. */
function localError(err: unknown, model: string): ReactNode {
  const failure = classifyBenchError(err);
  if (failure.kind === 'unavailable') {
    return (
      <>
        <UnreachableNote />
        <OllamaInstructions model={model} />
      </>
    );
  }
  if (failure.kind === 'model-missing') return <ModelMissingNote model={model} />;
  return <p>The local model could not suggest questions: {failure.message}</p>;
}

/**
 * The question editor: the draft's reader questions, up to 8, which the Questions covered card
 * measures. The author edits, adds and removes them; more come from the draft's title and
 * headings, from the local model on a click once it is connected, or from the home's Your
 * questions list, one per click.
 */
export function ReaderQuestions({
  questions,
  onChange,
  markdown,
  localModel,
}: ReaderQuestionsProps) {
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<ReactNode>(null);
  const [asking, setAsking] = useState(false);
  /** Bumped on unmount, so an answer that arrives after a sample switch is dropped. */
  const op = useRef(0);
  useEffect(
    () => () => {
      op.current++;
    },
    [],
  );
  /** The list as it is now, so an answer that arrives later keeps edits made meanwhile. */
  const latest = useRef(questions);
  latest.current = questions;
  const full = questions.length >= MAX_QUESTIONS;

  function add(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (text === '' || full) return;
    if (hasQuestion(questions, text)) {
      setMessage('That question is already on the list.');
      return;
    }
    onChange(mergeQuestions(questions, [{ text, source: 'user' }]));
    setDraft('');
    setMessage(null);
  }

  /**
   * A field's text while it is empty or repeats another question. The list itself never holds
   * such text (add() refuses it too); leaving the field puts the last valid question back.
   */
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);

  function edit(index: number, text: string) {
    const problem = editProblem(questions, index, text);
    if (problem) {
      setEditing({ index, text });
      setMessage(problem);
      return;
    }
    setEditing(null);
    setMessage(null);
    onChange(questions.map((q, i) => (i === index ? { text, source: 'user' } : q)));
  }

  function endEdit(index: number) {
    if (editing?.index !== index) return;
    setEditing(null);
    setMessage(null);
  }

  function remove(index: number) {
    onChange(questions.filter((_, i) => i !== index));
    setEditing(null);
    setMessage(null);
  }

  function fromHeadings() {
    const next = mergeQuestions(questions, generateQuestions(markdown, { max: MAX_QUESTIONS }));
    onChange(next);
    setMessage(added(next.length - questions.length, 'from your draft'));
  }

  async function fromModel(model: string) {
    const id = ++op.current;
    setAsking(true);
    setMessage(null);
    try {
      const found = await suggestWithLocalModel(markdown, model);
      if (id !== op.current) return;
      const now = latest.current;
      const next = mergeQuestions(now, found);
      onChange(next);
      setMessage(added(next.length - now.length, `from ${model}`));
    } catch (err) {
      if (id !== op.current) return;
      setMessage(localError(err, model));
    } finally {
      if (id === op.current) setAsking(false);
    }
  }

  function fromList(q: SiteQuestion) {
    if (full) return;
    onChange(
      mergeQuestions(questions, [
        { text: q.text, source: draftSourceOf(q.source), template: q.template },
      ]),
    );
    setMessage(null);
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink-soft">What should this page answer? Up to {MAX_QUESTIONS}.</p>

      {questions.length > 0 ? (
        <ol aria-label="Your reader questions" className="space-y-2">
          {questions.map((q, i) => {
            const id = `question-${i}`;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: questions are edited in place, so the text cannot be the key
              <li key={i} className="flex flex-wrap items-center gap-2">
                <label htmlFor={id} className="sr-only">
                  Question {i + 1}
                </label>
                <input
                  id={id}
                  type="text"
                  value={editing?.index === i ? editing.text : q.text}
                  onChange={(e) => edit(i, e.currentTarget.value)}
                  onBlur={() => endEdit(i)}
                  aria-invalid={editing?.index === i}
                  className={field}
                />
                {q.source !== 'sample-pack' && (
                  <span className="shrink-0 rounded-full border px-2 py-0.5 text-ink-soft text-xs">
                    {SOURCE_LABELS[q.source]}
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove question ${i + 1}`}
                  onClick={() => remove(i)}
                >
                  <X aria-hidden="true" />
                </Button>
                <SearchesBehind question={q.text} localModel={localModel} className="pl-0.5" />
              </li>
            );
          })}
        </ol>
      ) : (
        <p>No questions yet. Add one, or suggest some from your draft.</p>
      )}

      <form onSubmit={add} className="flex items-center gap-2">
        <label htmlFor="new-question" className="sr-only">
          New question
        </label>
        <input
          id="new-question"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder="Add a question..."
          disabled={full}
          className={field}
        />
        <Button type="submit" size="sm" variant="outline" disabled={full || draft.trim() === ''}>
          <Plus aria-hidden="true" />
          Add
        </Button>
      </form>
      {full && (
        <p className="text-ink-soft text-xs">
          That is the limit of {MAX_QUESTIONS}. Remove one to add another.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          title="Questions your title and headings already ask."
          onClick={fromHeadings}
          disabled={full}
        >
          <ListPlus aria-hidden="true" />
          From headings
        </Button>
        {localModel !== null && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fromModel(localModel)}
            disabled={full || asking}
          >
            <Sparkles aria-hidden="true" />
            {asking ? 'Asking...' : 'Local AI'}
          </Button>
        )}
      </div>
      {message !== null && (
        <div role="status" className="space-y-2">
          {message}
        </div>
      )}

      <FromYourList questions={questions} full={full} onAdd={fromList} />
    </div>
  );
}

/**
 * From your list: the first FROM_LIST_SHOWN questions of the home's list (typed, pasted,
 * imported or from the local model there) that this draft does not have yet, each added on its
 * own click. It follows the home's list as it changes.
 */
function FromYourList({
  questions,
  full,
  onAdd,
}: {
  questions: WorkspaceQuestion[];
  full: boolean;
  onAdd(q: SiteQuestion): void;
}) {
  const headingId = useId();
  const input = useSyncExternalStore(subscribeSiteInput, getSiteInput, () => EMPTY_SITE_INPUT);
  const list = useMemo(() => siteQuestionsOf(input), [input]);
  const offered = list.filter((q) => !hasQuestion(questions, q.text)).slice(0, FROM_LIST_SHOWN);

  // An added question leaves the list, and its button with it: focus goes to the button now in
  // its place (or the last one), else to the heading (none left, or the draft is now full), so
  // the keyboard never drops to the page.
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAt = useRef<number | null>(null);
  // No dependency list: it acts only on the render right after an add, which focusAt marks.
  useEffect(() => {
    const at = focusAt.current;
    if (at === null) return;
    focusAt.current = null;
    const buttons = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>('button:enabled') ?? []),
    ];
    (buttons[Math.min(at, buttons.length - 1)] ?? headingRef.current)?.focus();
  });

  return (
    <section aria-labelledby={headingId} className="space-y-2 border-t pt-3">
      <h4 id={headingId} ref={headingRef} tabIndex={-1} className="font-medium outline-none">
        From your list
      </h4>
      {offered.length === 0 ? (
        <p className="text-ink-soft">
          {list.length === 0
            ? 'Your list is empty.'
            : 'Every question on your list is on this draft.'}{' '}
          <Link href={VIEW_HREF.home} prefetch={false} className={textLink}>
            Your questions
          </Link>
        </p>
      ) : (
        <ul ref={listRef} className="space-y-2">
          {offered.map((q, i) => (
            <li key={q.text} className="flex items-start gap-2">
              <p data-question className="min-w-0 flex-1 break-words pt-1">
                {q.text}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Add "${q.text}"`}
                disabled={full}
                onClick={() => {
                  focusAt.current = i;
                  onAdd(q);
                }}
              >
                <Plus aria-hidden="true" />
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
