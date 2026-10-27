'use client';

import { DEFAULT_OLLAMA_HOST } from '@citation-equity/bench';
import {
  parseQueriesCsv,
  questionKey,
  SITE_QUESTIONS_MAX,
  type SiteQuestion,
  siteQuestionNumbers,
  siteQuestions,
} from '@citation-equity/engine';
import { Copy, Laptop, ListPlus, MessagesSquare, RefreshCw, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ModelMissingNote,
  OllamaInstructions,
  UnreachableNote,
} from '@/components/draft/ollama-help';
import { textLink } from '@/components/page-shell';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';
import { addCitedQuestion } from '@/lib/pasted';
import { SOURCE_LABELS } from '@/lib/questions';
import {
  connectLocalModel,
  LOCAL_MODEL,
  type LocalModelState,
  suggestFromKeywords,
} from '@/lib/search-helper';
import {
  addToDraft,
  draftSourceOf,
  EMPTY_SITE_INPUT,
  getSiteInput,
  keepImported,
  type SiteInput,
  setSiteInput,
  subscribeSiteInput,
} from '@/lib/site-questions';
import { cn } from '@/lib/utils';
import { VIEW_HREF } from '@/lib/views';
import { SearchesBehind } from './searches-behind';

const field = cn(
  'mt-1 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none',
  'placeholder:text-ink-faint focus-visible:ring-[3px] focus-visible:ring-ring',
);

const PLACEHOLDER = 'espresso bitter\nespresso shot time, 1900\nhow to dial in espresso';

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** How the list is ranked, in words, by the numbers it has. */
function rankingWords(list: SiteQuestion[]): string {
  if (list.some((q) => q.citations !== undefined)) return 'ranked by citations, then volume';
  return list.some((q) => q.volume !== undefined) ? 'ranked by volume' : 'in your order';
}

type Connection = { kind: 'idle' } | { kind: 'checking' } | { kind: LocalModelState };

/** A question's own note, under its buttons: copied, added, or the Ask an AI steps. */
type Note = { kind: 'text'; text: ReactNode } | { kind: 'ask' };

/**
 * Your questions: the site's keywords (pasted, or imported from Search Console or Bing) turned
 * into a ranked list of reader questions, each with a copy button, "Use in my draft", "Ask an
 * AI" and the searches behind it. The list lives in this browser (lib/site-questions); nothing
 * is sent anywhere, except the keywords to the local model after Connect local AI.
 */
export function QuestionsView() {
  const ids = useId();
  const input = useSyncExternalStore(subscribeSiteInput, getSiteInput, () => EMPTY_SITE_INPUT);
  const list = useMemo(
    () =>
      siteQuestions({
        keywords: input.keywords,
        queries: input.imported?.queries ?? [],
        suggested: input.suggested,
      }),
    [input],
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>({ kind: 'idle' });
  const [modelMessage, setModelMessage] = useState<ReactNode>(null);
  const [asking, setAsking] = useState(false);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  /** Bumped on unmount, so an answer that arrives after leaving the view is dropped. */
  const op = useRef(0);
  useEffect(
    () => () => {
      op.current++;
    },
    [],
  );
  const model = connection.kind === 'ready' ? LOCAL_MODEL : null;

  const change = (patch: Partial<SiteInput>) => setSiteInput({ ...getSiteInput(), ...patch });
  const note = (q: SiteQuestion, n: Note | null) =>
    setNotes((all) => {
      const next = { ...all };
      if (n === null) delete next[questionKey(q.text)];
      else next[questionKey(q.text)] = n;
      return next;
    });

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const file = el.files?.[0];
    if (!file) return;
    try {
      const queries = keepImported(parseQueriesCsv(await file.text()));
      change({ imported: { name: file.name, queries } });
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      // Lets the same file be chosen again after an edit.
      el.value = '';
    }
  }

  async function connect() {
    const id = ++op.current;
    setConnection({ kind: 'checking' });
    setModelMessage(null);
    const state = await connectLocalModel(LOCAL_MODEL);
    if (id === op.current) setConnection({ kind: state });
  }

  async function suggestMore(name: string) {
    const id = ++op.current;
    setAsking(true);
    setModelMessage(null);
    try {
      // Only the keywords and queries go to the local model: no volumes, nothing else.
      const keywords = list.filter((q) => q.source !== 'local-model').map((q) => q.keyword);
      const found = await suggestFromKeywords(keywords, name);
      if (id !== op.current) return;
      const now = getSiteInput();
      const before = siteQuestions({
        keywords: now.keywords,
        queries: now.imported?.queries ?? [],
        suggested: now.suggested,
      });
      const known = new Set(before.map((q) => questionKey(q.text)));
      const fresh = found.filter((t) => !known.has(questionKey(t)));
      const suggested = [...now.suggested, ...fresh];
      change({ suggested });
      // The list shows at most SITE_QUESTIONS_MAX; say so when a new one falls past it.
      const shown = new Set(
        siteQuestions({
          keywords: now.keywords,
          queries: now.imported?.queries ?? [],
          suggested,
        }).map((q) => questionKey(q.text)),
      );
      const hidden = fresh.filter((t) => !shown.has(questionKey(t))).length;
      setModelMessage(
        fresh.length === 0
          ? `No new questions from ${name}.`
          : `Added ${plural(fresh.length, 'question')} from ${name}.${
              hidden === 0
                ? ''
                : ` ${hidden === fresh.length ? (hidden === 1 ? 'It is' : 'They are') : `${hidden} of them are`} past the ${SITE_QUESTIONS_MAX} the list shows: remove some keywords to see ${hidden === 1 ? 'it' : 'them'}.`
            }`,
      );
    } catch {
      if (id === op.current) setConnection({ kind: 'unreachable' });
    } finally {
      if (id === op.current) setAsking(false);
    }
  }

  function removeSuggested(q: SiteQuestion) {
    const now = getSiteInput();
    change({ suggested: now.suggested.filter((t) => questionKey(t) !== questionKey(q.text)) });
    note(q, null);
  }

  async function copy(q: SiteQuestion) {
    const ok = await copyText(q.text);
    note(q, {
      kind: 'text',
      text: ok ? 'Copied.' : 'Could not copy. Select the question and copy it.',
    });
  }

  function toDraft(q: SiteQuestion) {
    const { result, example, empty } = addToDraft({
      text: q.text,
      source: draftSourceOf(q.source),
    });
    const where = example ? 'the example draft' : 'your draft';
    const open = (
      <Link href={VIEW_HREF.draft} prefetch={false} className={textLink}>
        Open your draft
      </Link>
    );
    const text =
      result === 'added' ? (
        <>
          Added to Reader questions in {where}.
          {empty ? ' Add some text to your draft to see Reader questions there. ' : ' '}
          {open}
        </>
      ) : result === 'already' ? (
        'Already in your draft.'
      ) : (
        <>
          Your draft already has the most reader questions it holds. Remove one there first. {open}
        </>
      );
    note(q, { kind: 'text', text });
  }

  async function askAi(q: SiteQuestion) {
    addCitedQuestion(q.text);
    await copyText(q.text);
    note(q, { kind: 'ask' });
  }

  const ranked = list.filter((q) => q.source !== 'local-model').length;
  return (
    <>
      <p className="mt-3 text-lg text-muted-foreground leading-relaxed">
        Turn the keywords your site is found by into the questions readers ask AI, ranked by search
        volume. It suggests; you choose what to write. Everything stays in this browser.
      </p>

      <div className="mt-6">
        <label htmlFor={`${ids}-keywords`} className="font-medium text-sm">
          Your keywords
        </label>
        <p id={`${ids}-hint`} className="text-muted-foreground text-sm">
          One per line. Add the search volume after a comma or a tab, if you have it. Write a
          keyword as a question to keep your wording.
        </p>
        <textarea
          id={`${ids}-keywords`}
          aria-describedby={`${ids}-hint`}
          value={input.keywords}
          placeholder={PLACEHOLDER}
          rows={6}
          onChange={(e) => change({ keywords: e.target.value })}
          className={cn(field, 'min-h-32 resize-y font-mono text-[13px] leading-relaxed')}
        />
      </div>

      <div className="mt-4 space-y-2">
        <label htmlFor={`${ids}-file`} className="font-medium text-sm">
          Import from Search Console or Bing (CSV)
        </label>
        <p id={`${ids}-file-help`} className="text-muted-foreground text-xs">
          The Queries table from Search Console, or grounding queries from Bing AI Performance. Read
          in this browser; nothing is uploaded.
        </p>
        <input
          id={`${ids}-file`}
          type="file"
          accept=".csv,text/csv"
          aria-describedby={`${ids}-file-help`}
          onChange={importFile}
          className={cn(
            'block w-full rounded-md text-sm outline-none',
            'focus-visible:ring-[3px] focus-visible:ring-ring',
            'file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-sm',
          )}
        />
        {importError !== null && (
          <p role="alert" className="text-destructive text-sm">
            {importError}
          </p>
        )}
        {input.imported !== null && (
          <p className="flex items-center gap-2 text-sm">
            Imported {plural(input.imported.queries.length, 'query', 'queries')} from{' '}
            {input.imported.name}.
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove the imported queries"
              onClick={() => change({ imported: null })}
            >
              <X aria-hidden="true" />
            </Button>
          </p>
        )}
      </div>

      <LocalModel
        connection={connection}
        asking={asking}
        canSuggest={ranked > 0}
        message={modelMessage}
        onConnect={connect}
        onSuggest={suggestMore}
      />

      <section aria-labelledby={`${ids}-list`} className="mt-10">
        <h2 id={`${ids}-list`} className="font-medium font-serif text-2xl">
          Your questions
        </h2>
        {list.length === 0 ? (
          <p className="mt-3 text-muted-foreground text-sm">
            No questions yet. Paste your keywords above, or import a file.
          </p>
        ) : (
          <>
            <p className="mt-2 text-muted-foreground text-sm">
              {plural(list.length, 'question')}, {rankingWords(list)}.
              {list.length >= SITE_QUESTIONS_MAX ? ` Showing the top ${SITE_QUESTIONS_MAX}.` : ''}
            </p>
            <ol aria-label="Your questions, ranked" className="mt-3 space-y-3">
              {list.map((q, i) => (
                <QuestionItem
                  key={questionKey(q.text)}
                  q={q}
                  rank={i + 1}
                  model={model}
                  note={notes[questionKey(q.text)] ?? null}
                  onCopy={() => copy(q)}
                  onUse={() => toDraft(q)}
                  onAsk={() => askAi(q)}
                  onRemove={q.source === 'local-model' ? () => removeSuggested(q) : undefined}
                />
              ))}
            </ol>
          </>
        )}
      </section>
    </>
  );
}

function LocalModel({
  connection,
  asking,
  canSuggest,
  message,
  onConnect,
  onSuggest,
}: {
  connection: Connection;
  asking: boolean;
  canSuggest: boolean;
  message: ReactNode;
  onConnect(): void;
  onSuggest(model: string): void;
}) {
  const again = connection.kind === 'unreachable' || connection.kind === 'model-missing';
  return (
    <div className="mt-6 space-y-2 rounded-lg border bg-surface p-4 text-sm shadow-card">
      <p className="font-medium">More from a local AI</p>
      <p className="text-muted-foreground text-xs">
        Optional. A free model on your own computer suggests more questions. Only your keywords are
        sent, and only to it.
      </p>
      {connection.kind === 'ready' ? (
        <>
          <p>Connected to {LOCAL_MODEL}.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={asking || !canSuggest}
            onClick={() => onSuggest(LOCAL_MODEL)}
          >
            <Sparkles aria-hidden="true" />
            {asking ? 'Asking...' : 'Suggest more questions'}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={connection.kind === 'checking'}
          onClick={onConnect}
          title={`Connects to ${DEFAULT_OLLAMA_HOST} only`}
        >
          {again ? <RefreshCw aria-hidden="true" /> : <Laptop aria-hidden="true" />}
          {connection.kind === 'checking'
            ? 'Connecting...'
            : again
              ? 'Try again'
              : 'Connect local AI'}
        </Button>
      )}
      {connection.kind === 'unreachable' && (
        <>
          <UnreachableNote />
          <OllamaInstructions model={LOCAL_MODEL} />
        </>
      )}
      {connection.kind === 'model-missing' && <ModelMissingNote model={LOCAL_MODEL} />}
      {message !== null && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}

/** "Volume 1,900 · Keyword: espresso bitter": the number, and the keyword when it was rewritten. */
function metaOf(q: SiteQuestion): string {
  const parts: string[] = [];
  const numbers = siteQuestionNumbers(q);
  if (numbers !== '') parts.push(numbers);
  if (q.source !== 'local-model' && questionKey(q.keyword) !== questionKey(q.text)) {
    parts.push(`${q.source === 'keywords' ? 'Keyword' : 'Query'}: ${q.keyword}`);
  }
  return parts.join(' · ');
}

function QuestionItem({
  q,
  rank,
  model,
  note,
  onCopy,
  onUse,
  onAsk,
  onRemove,
}: {
  q: SiteQuestion;
  rank: number;
  model: string | null;
  note: Note | null;
  onCopy(): void;
  onUse(): void;
  onAsk(): void;
  /** Only for a question the local model suggested: the keywords' own go with their keyword. */
  onRemove?(): void;
}) {
  const meta = metaOf(q);
  return (
    <li className="rounded-lg border bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="pt-0.5 font-serif text-ink-soft tabular-nums">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <p data-question className="break-words font-medium">
            {q.text}
          </p>
          {(meta !== '' || q.source !== 'keywords') && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-soft text-xs">
              {q.source !== 'keywords' && (
                <span className="rounded-full border px-2 py-0.5">{SOURCE_LABELS[q.source]}</span>
              )}
              {meta !== '' && <span>{meta}</span>}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy "${q.text}"`}
          title="Copy"
          onClick={onCopy}
        >
          <Copy aria-hidden="true" />
        </Button>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove "${q.text}"`}
            title="Remove"
            onClick={onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Use in my draft: ${q.text}`}
          onClick={onUse}
        >
          <ListPlus aria-hidden="true" />
          Use in my draft
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Ask an AI: ${q.text}`}
          onClick={onAsk}
        >
          <MessagesSquare aria-hidden="true" />
          Ask an AI
        </Button>
      </div>
      {note !== null && (
        <div role="status" className="mt-2 text-sm">
          {note.kind === 'text' ? <p>{note.text}</p> : <AskSteps />}
        </div>
      )}
      <SearchesBehind question={q.text} localModel={model} className="mt-3" />
    </li>
  );
}

/** What to do after "Ask an AI" copied the question. */
function AskSteps() {
  return (
    <>
      <p>Copied.</p>
      <ol aria-label="Ask an AI" className="mt-1 list-decimal space-y-0.5 pl-5">
        <li>Paste the question into ChatGPT, Perplexity, Gemini or Copilot.</li>
        <li>Copy the answer with its links.</li>
        <li>
          Paste it in{' '}
          <Link href={VIEW_HREF.cited} prefetch={false} className={textLink}>
            Who gets cited
          </Link>
          , next to the question.
        </li>
      </ol>
    </>
  );
}
