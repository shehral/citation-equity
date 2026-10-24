'use client';

import {
  generateQuestions,
  parseQueriesCsv,
  queryNumbers,
  questionKey,
  rankImportedQueries,
  rankingNote,
  type TargetQuestion,
} from '@citation-equity/engine';
import { ListPlus, Plus, Sparkles, X } from 'lucide-react';
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
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
import { cn } from '@/lib/utils';
import { ModelMissingNote, OllamaInstructions, UnreachableNote } from './ollama-help';

interface TargetQuestionsProps {
  questions: WorkspaceQuestion[];
  onChange(questions: WorkspaceQuestion[]): void;
  /** The editor's current text, which "Suggest from my draft" reads. */
  markdown: string;
  /** The model the bench panel's local-model check found; null before that check. */
  localModel: string | null;
}

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
 * The draft's target questions, up to 8, each with where it came from. The
 * author edits, adds and removes them; suggestions come from the draft's title,
 * headings and first paragraph, or (after the bench panel's local-model check)
 * from the local model on a click, or from real queries in a CSV export.
 */
export function TargetQuestions({
  questions,
  onChange,
  markdown,
  localModel,
}: TargetQuestionsProps) {
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

  return (
    <section
      aria-labelledby="questions-heading"
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <h2 id="questions-heading" className="font-medium">
        Target questions
      </h2>
      <p className="text-muted-foreground text-sm">
        The questions this page should answer, up to {MAX_QUESTIONS}. The Target questions answered
        check looks for a direct answer to each. Edit them freely.
      </p>

      {questions.length > 0 ? (
        <ol className="space-y-2">
          {questions.map((q, i) => {
            const id = `question-${i}`;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: questions are edited in place, so the text cannot be the key
              <li key={i} className="flex items-center gap-2">
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
                <span className="shrink-0 rounded-full border px-2 py-0.5 text-muted-foreground text-xs">
                  {SOURCE_LABELS[q.source]}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove question ${i + 1}`}
                  onClick={() => remove(i)}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm">
          No target questions yet. Add one, or suggest some from your draft.
        </p>
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
          placeholder="A question a reader would ask"
          disabled={full}
          className={field}
        />
        <Button type="submit" size="sm" variant="outline" disabled={full || draft.trim() === ''}>
          <Plus aria-hidden="true" />
          Add
        </Button>
      </form>
      {full && (
        <p className="text-muted-foreground text-xs">
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
            {asking ? 'Asking the local model' : 'Suggest more with my local model'}
          </Button>
        )}
      </div>
      {localModel === null && (
        <p className="text-muted-foreground text-xs">
          To suggest more with a local model, first use Check for a local model in the bench panel
          below. Nothing leaves this page before you click there.
        </p>
      )}
      {message !== null && (
        <div role="status" className="space-y-2 text-sm">
          {message}
        </div>
      )}

      <ImportQueries questions={questions} full={full} onAdd={addImported} />
    </section>
  );
}

/** Imported queries listed at once; the rest are in the file but not shown. */
const IMPORT_SHOWN = 10;

const queriesCount = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'query' : 'queries'}`;

/**
 * "Import real queries (CSV)": a Search Console or Bing AI Performance export, read with the
 * File API and parsed in the browser (no request). Lists the top queries with their numbers;
 * each is added as a target question only on its own click.
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
        Import real queries (CSV)
      </label>
      <p id={`${id}-help`} className="text-muted-foreground text-xs">
        A Search Console Performance export (the Queries table) or a Bing AI Performance export (the
        grounding queries table). The file is read in this browser and is not uploaded.
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
          <p className="text-muted-foreground text-xs">
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
                    <p className="text-muted-foreground text-xs">
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
                        ? `"${question.text}" is already a target question`
                        : `Add "${question.text}" as a target question`
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
