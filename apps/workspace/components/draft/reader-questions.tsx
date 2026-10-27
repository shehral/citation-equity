'use client';

import {
  generateQuestions,
  parseQueriesCsv,
  type QuestionCoverage,
  queryNumbers,
  questionKey,
  type Range,
  rankImportedQueries,
  rankingNote,
  type TargetQuestion,
} from '@citation-equity/engine';
import { ListPlus, LocateFixed, Plus, Sparkles, X } from 'lucide-react';
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { SearchesBehind } from '@/components/questions/searches-behind';
import { Button } from '@/components/ui/button';
import { classifyBenchError } from '@/lib/bench';
import { CHECK_NAMES } from '@/lib/glossary';
import { suggestWithLocalModel } from '@/lib/question-helper';
import {
  editProblem,
  hasQuestion,
  MAX_QUESTIONS,
  mergeQuestions,
  SOURCE_LABELS,
  type WorkspaceQuestion,
} from '@/lib/questions';
import { cn } from '@/lib/utils';
import { ModelMissingNote, OllamaInstructions, UnreachableNote } from './ollama-help';

interface ReaderQuestionsProps {
  questions: WorkspaceQuestion[];
  onChange(questions: WorkspaceQuestion[]): void;
  /** The editor's current text, which "Suggest from my draft" reads. */
  markdown: string;
  /** The model Connect local AI found (in Test it); null before that click. */
  localModel: string | null;
  /** Whether the analyzed draft answers each question, and where. */
  coverage?: QuestionCoverage[];
  /** Selects a range in the editor. */
  onShowRange?(range: Range): void;
  /**
   * The page's own title and topic questions the reader's-words check measures while the list
   * holds none of the author's own (typed or imported); shown so every question a card names
   * is on screen.
   */
  pageQuestions?: string[];
}

const NO_PAGE_QUESTIONS: string[] = [];

const field = cn(
  'h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm',
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50',
);

const added = (n: number, from: string) =>
  n === 0 ? `No new questions ${from}.` : `Added ${n} question${n === 1 ? '' : 's'} ${from}.`;

/** What the panel says when the local model fails. */
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
 * Reader questions (the question-coverage check's target questions), up to 8: each with where it
 * came from and whether the draft answers it. The author edits, adds and removes them;
 * suggestions come from the draft's title, headings and first paragraph, from the local model
 * on a click once it is connected, or from real queries in a CSV export.
 */
export function ReaderQuestions({
  questions,
  onChange,
  markdown,
  localModel,
  coverage = [],
  onShowRange,
  pageQuestions = NO_PAGE_QUESTIONS,
}: ReaderQuestionsProps) {
  const pageListId = useId();
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

  function addImported(q: TargetQuestion) {
    onChange(mergeQuestions(questions, [q]));
    setMessage(null);
  }

  function suggestFromDraft() {
    const next = mergeQuestions(questions, generateQuestions(markdown, { max: MAX_QUESTIONS }));
    onChange(next);
    setMessage(added(next.length - questions.length, 'from your draft'));
  }

  async function suggestFromModel(model: string) {
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

  const answered = new Map(coverage.map((c) => [questionKey(c.question), c]));
  return (
    <>
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
                <CoverageNote row={answered.get(questionKey(q.text))} onShowRange={onShowRange} />
                <SearchesBehind question={q.text} localModel={localModel} className="pl-0.5" />
              </li>
            );
          })}
        </ol>
      ) : (
        <p>No questions yet. Add one, or suggest some from your draft.</p>
      )}

      {pageQuestions.length > 0 && (
        <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <p id={pageListId} className="font-medium">
            Page questions used for "{CHECK_NAMES['reader-words']}"
          </p>
          <ul aria-labelledby={pageListId} className="list-disc space-y-0.5 pl-5">
            {pageQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p className="text-ink-soft text-xs">
            Made from your title and topic. Add a question of your own, by typing or importing it,
            and the check uses yours instead.
          </p>
        </div>
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
          onClick={suggestFromDraft}
          disabled={full}
        >
          <ListPlus aria-hidden="true" />
          Suggest from my draft
        </Button>
        {localModel !== null && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => suggestFromModel(localModel)}
            disabled={full || asking}
          >
            <Sparkles aria-hidden="true" />
            {asking ? 'Asking...' : 'Suggest more with local AI'}
          </Button>
        )}
      </div>
      {message !== null && (
        <div role="status" className="space-y-2 text-sm">
          {message}
        </div>
      )}

      <ImportQueries questions={questions} full={full} onAdd={addImported} />
    </>
  );
}

/** Whether the analyzed draft answers a question, with a way to see where. */
function CoverageNote({
  row,
  onShowRange,
}: {
  row: QuestionCoverage | undefined;
  onShowRange?(range: Range): void;
}) {
  if (!row) return null;
  return (
    <span className="flex w-full items-center gap-2 pl-0.5 text-xs">
      <span className={row.covered ? 'text-done' : 'text-ink-soft'}>
        {row.covered ? 'Answered' : 'Not answered yet'}
      </span>
      {onShowRange && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={`Show in draft: ${row.question}`}
          onClick={() => onShowRange(row.range)}
        >
          <LocateFixed aria-hidden="true" />
          Show
        </Button>
      )}
    </span>
  );
}

/** Imported queries listed at once; the rest are in the file but not shown. */
const IMPORT_SHOWN = 10;

const queriesCount = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'query' : 'queries'}`;

/**
 * "Import real queries (CSV)": a Search Console or Bing AI Performance export, read with the
 * File API and parsed in the browser (no request). Lists the top queries with their numbers;
 * each is added as a reader question only on its own click.
 */
function ImportQueries({
  questions,
  full,
  onAdd,
}: {
  questions: WorkspaceQuestion[];
  full: boolean;
  onAdd(q: TargetQuestion): void;
}) {
  const id = useId();
  const [result, setResult] = useState<{
    name: string;
    ranked: ReturnType<typeof rankImportedQueries>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function read(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const ranked = rankImportedQueries(parseQueriesCsv(await file.text()));
      setResult({ name: file.name, ranked });
      setError(null);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Lets the same file be chosen again after an edit.
      input.value = '';
    }
  }

  const shown = result?.ranked.slice(0, IMPORT_SHOWN) ?? [];
  return (
    <div className="space-y-2 border-t pt-3">
      <label htmlFor={`${id}-file`} className="font-medium text-sm">
        Import from Search Console or Bing (CSV)
      </label>
      <p id={`${id}-help`} className="text-ink-soft text-xs">
        Your real search queries test best: the Queries table from Search Console, or grounding
        queries from Bing AI Performance.
      </p>
      <input
        id={`${id}-file`}
        type="file"
        accept=".csv,text/csv"
        aria-describedby={`${id}-help`}
        onChange={read}
        className={cn(
          'block w-full rounded-md text-sm outline-none',
          'focus-visible:ring-[3px] focus-visible:ring-ring',
          'file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-sm',
        )}
      />
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {result !== null && (
        <section aria-labelledby={`${id}-heading`} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id={`${id}-heading`} className="font-medium text-sm">
              Imported queries
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close imported queries"
              onClick={() => setResult(null)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <p className="text-ink-soft text-xs">
            {result.ranked.length === 0
              ? `No queries in ${result.name}.`
              : `${queriesCount(result.ranked.length)} from ${result.name}, ${rankingNote(result.ranked.map((r) => r.query))}.${
                  shown.length < result.ranked.length ? ` Showing the top ${shown.length}.` : ''
                }`}
          </p>
          <ol className="space-y-2">
            {shown.map(({ query, question }) => {
              const listed = hasQuestion(questions, question.text);
              return (
                <li key={question.text} className="flex items-start gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p>{question.text}</p>
                    <p className="text-ink-soft text-xs">
                      {SOURCE_LABELS[query.source]}: {queryNumbers(query)}
                      {questionKey(question.text) === questionKey(query.text)
                        ? ''
                        : `. Query: ${query.text}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={
                      listed
                        ? `"${question.text}" is already a reader question`
                        : `Add "${question.text}" as a reader question`
                    }
                    disabled={listed || full}
                    onClick={() => onAdd(question)}
                  >
                    <Plus aria-hidden="true" />
                    {listed ? 'Added' : 'Add'}
                  </Button>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
