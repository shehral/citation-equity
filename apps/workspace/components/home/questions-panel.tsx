'use client';

import { DEFAULT_OLLAMA_HOST } from '@citation-equity/bench';
import {
  parseQueriesCsv,
  questionKey,
  SITE_QUESTIONS_MAX,
  type SiteQuestion,
  siteQuestionNumbers,
} from '@citation-equity/engine';
import { Copy, FileUp, Laptop, MessagesSquare, RefreshCw, Sparkles, X } from 'lucide-react';
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
import { SearchesBehind } from '@/components/questions/searches-behind';
import { Button, buttonVariants } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';
import { draftKeyFor, selectDraftSlot } from '@/lib/draft-summary';
import { connect, getLocalModel, reportLocalModel, subscribeLocalModel } from '@/lib/local-model';
import { addCitedQuestion } from '@/lib/pasted';
import { hasQuestion, MAX_QUESTIONS, SOURCE_LABELS, type WorkspaceQuestion } from '@/lib/questions';
import { MY_DRAFT_SLUG } from '@/lib/samples';
import { suggestFromKeywords } from '@/lib/search-helper';
import {
  addToDraft,
  draftSourceOf,
  EMPTY_SITE_INPUT,
  getSiteInput,
  keepImported,
  openDraftQuestions,
  removeFromDraft,
  type SiteInput,
  setSiteInput,
  siteQuestionsOf,
  subscribeSiteInput,
} from '@/lib/site-questions';
import {
  batch,
  clearSummary,
  getActiveSlot,
  getSummary,
  MY_POST_SLOT,
  subscribe,
} from '@/lib/store';
import { cn } from '@/lib/utils';
import { VIEW_HREF } from '@/lib/views';

// The home's questions: the input card (one box for questions or keywords, Import CSV and a
// local AI block) and the list under it, with a tick per question for the open draft. The list
// lives in this browser (lib/site-questions); nothing is sent anywhere, except the keywords to
// the local model after Connect local AI. The home lays the two out, with its step cards between
// them on a phone.
//
// While the box's list is empty, the list shows the open draft's own questions instead (the
// example's after Try it), derived from the draft and never stored. While the example is open,
// the first change to the box, an import or a tick on one of the box's rows starts fresh first,
// so the visitor's own questions never land in the example's list. Ticks on the example's own
// rows (the list derived from it) stay on the example.

const field = cn(
  'mt-3 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none',
  'placeholder:text-ink-faint focus-visible:ring-[3px] focus-visible:ring-ring',
);

const PLACEHOLDER =
  'Why does my espresso taste bitter?\nespresso shot time, 1900\nhow to dial in espresso';

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** How the list is ranked, in words, by the numbers it has ("in your order" for none). */
function rankingWords(list: SiteQuestion[]): string {
  if (list.some((q) => q.citations !== undefined)) return 'ranked by citations, then volume';
  return list.some((q) => q.volume !== undefined) ? 'ranked by volume' : 'in your order';
}

const useSiteInput = () =>
  useSyncExternalStore(subscribeSiteInput, getSiteInput, () => EMPTY_SITE_INPUT);

/** The open draft's questions as JSON, so an unchanged list is an unchanged store snapshot. */
const openDraftSnapshot = (): string => JSON.stringify(openDraftQuestions());

/** True for an example's draft slot, false for My post. */
export const isExampleSlot = (slot: string): boolean => draftKeyFor(slot) !== MY_DRAFT_SLUG;

/**
 * Start fresh: My post becomes the open draft, and the site and cited summaries the example
 * stored are forgotten, so nothing on the home still says Example. The visitor's own stay.
 */
export function startFresh(): void {
  batch(() => {
    selectDraftSlot(MY_POST_SLOT);
    if (getSummary('site')?.example) clearSummary('site');
    if (getSummary('cited')?.example) clearSummary('cited');
  });
}

/** The input card: the box, Import CSV and More from a local AI. */
export function QuestionsInput({ className }: { className?: string }) {
  const ids = useId();
  const input = useSiteInput();
  const list = useMemo(() => siteQuestionsOf(input), [input]);
  const local = useSyncExternalStore(subscribeLocalModel, getLocalModel, getLocalModel);
  const [importError, setImportError] = useState<string | null>(null);
  const [modelMessage, setModelMessage] = useState<ReactNode>(null);
  const [asking, setAsking] = useState(false);
  /** Bumped on unmount, so an answer that arrives after leaving the view is dropped. */
  const op = useRef(0);
  useEffect(
    () => () => {
      op.current++;
    },
    [],
  );

  const change = (patch: Partial<SiteInput>) => setSiteInput({ ...getSiteInput(), ...patch });
  /** The visitor's own questions or import: never into the example's list. */
  const own = (patch: Partial<SiteInput>) => {
    if (isExampleSlot(getActiveSlot())) startFresh();
    change(patch);
  };

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const file = el.files?.[0];
    if (!file) return;
    try {
      const queries = keepImported(parseQueriesCsv(await file.text()));
      own({ imported: { name: file.name, queries } });
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      // Lets the same file be chosen again after an edit.
      el.value = '';
    }
  }

  function connectModel() {
    setModelMessage(null);
    void connect();
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
      const known = new Set(siteQuestionsOf(now).map((q) => questionKey(q.text)));
      const fresh = found.filter((t) => !known.has(questionKey(t)));
      const suggested = [...now.suggested, ...fresh];
      change({ suggested });
      // The list shows at most SITE_QUESTIONS_MAX; say so when a new one falls past it.
      const shown = new Set(siteQuestionsOf({ ...now, suggested }).map((q) => questionKey(q.text)));
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
      // The model stopped answering: every view reads it as unreachable (the list's rows stop
      // offering it too) until Try again connects afresh.
      if (id === op.current) reportLocalModel('unreachable', name);
    } finally {
      if (id === op.current) setAsking(false);
    }
  }

  return (
    <section
      aria-labelledby={`${ids}-heading`}
      className={cn('rounded-lg border bg-surface p-5 shadow-card', className)}
    >
      <h2 id={`${ids}-heading`} className="font-semibold text-[15px]">
        <label htmlFor={`${ids}-box`}>Your readers' questions</label>
      </h2>
      <p id={`${ids}-hint`} className="mt-0.5 text-ink-soft text-sm">
        Type questions or paste keywords, one per line. Add a search volume after a comma.
      </p>
      <textarea
        id={`${ids}-box`}
        aria-describedby={`${ids}-hint`}
        value={input.keywords}
        placeholder={PLACEHOLDER}
        rows={4}
        onChange={(e) => own({ keywords: e.target.value })}
        className={cn(field, 'min-h-24 resize-y font-mono text-[13px] leading-relaxed')}
      />

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'cursor-pointer has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring',
          )}
        >
          <FileUp aria-hidden="true" />
          Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            aria-describedby={`${ids}-file-help`}
            onChange={importFile}
            className="sr-only"
          />
        </label>
        <p id={`${ids}-file-help`} className="min-w-0 flex-1 basis-48 text-ink-soft text-xs">
          A Search Console or Bing Webmaster export. Read here, never uploaded.
        </p>
      </div>
      {importError !== null && (
        <p role="alert" className="mt-2 text-destructive text-sm">
          {importError}
        </p>
      )}
      {input.imported !== null && (
        <p className="mt-2 flex items-center gap-2 text-sm">
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

      <LocalModel
        status={local.status}
        model={local.model}
        asking={asking}
        canSuggest={list.some((q) => q.source !== 'local-model')}
        message={modelMessage}
        onConnect={connectModel}
        onSuggest={suggestMore}
      />
    </section>
  );
}

/** Today's local AI block, collapsed under "More from a local AI". */
function LocalModel({
  status,
  model,
  asking,
  canSuggest,
  message,
  onConnect,
  onSuggest,
}: {
  status: ReturnType<typeof getLocalModel>['status'];
  model: string;
  asking: boolean;
  canSuggest: boolean;
  message: ReactNode;
  onConnect(): void;
  onSuggest(model: string): void;
}) {
  const again = status === 'unreachable' || status === 'model-missing';
  return (
    <details className="mt-4 text-sm">
      <summary
        className={cn(
          'w-fit cursor-pointer rounded-sm text-ink-soft outline-none hover:text-foreground',
          'focus-visible:ring-[3px] focus-visible:ring-ring',
        )}
      >
        More from a local AI
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-ink-soft text-xs">
          Optional. A free model on your own computer suggests more questions. Only your keywords
          are sent, and only to it.
        </p>
        {status === 'ready' ? (
          <>
            <p>Connected to {model}.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={asking || !canSuggest}
              onClick={() => onSuggest(model)}
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
            disabled={status === 'checking'}
            onClick={onConnect}
            title={`Connects to ${DEFAULT_OLLAMA_HOST} only`}
          >
            {again ? <RefreshCw aria-hidden="true" /> : <Laptop aria-hidden="true" />}
            {status === 'checking' ? 'Connecting...' : again ? 'Try again' : 'Connect local AI'}
          </Button>
        )}
        {status === 'unreachable' && (
          <>
            <UnreachableNote />
            <OllamaInstructions model={model} />
          </>
        )}
        {status === 'model-missing' && <ModelMissingNote model={model} />}
        {message !== null && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}

/** A question's own note, under its buttons: copied, the full draft, or the Ask AI steps. */
type Note = { kind: 'text'; text: string } | { kind: 'ask' };

/** One row of the list: the question, what a tick puts on the draft, and how it is labelled. */
interface Row {
  /** The question a tick adds to the draft's list, with its source and template. */
  question: WorkspaceQuestion;
  /** The small tag next to it (where it came from), if any. */
  tag: string | null;
  /** Its numbers and the keyword it came from, if any. */
  meta: string;
  /** True for a question the local model suggested, which can be removed here. */
  suggested: boolean;
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

const rowOf = (q: SiteQuestion): Row => ({
  // The template sets the question's input kind on the draft: as written, or a keyword guess.
  question: { text: q.text, source: draftSourceOf(q.source), template: q.template },
  tag: q.source === 'keywords' ? null : SOURCE_LABELS[q.source],
  meta: metaOf(q),
  suggested: q.source === 'local-model',
});

/** A row for one of the open draft's own questions: tagged Example on the example. */
const draftRowOf = (q: WorkspaceQuestion, example: boolean): Row => ({
  question: q,
  tag: example ? 'Example' : q.source === 'keywords' ? null : SOURCE_LABELS[q.source],
  meta: '',
  suggested: false,
});

/** The rows on screen when an untick happened, kept while the box and the open draft stay. */
interface Held {
  input: SiteInput;
  slot: string;
  questions: WorkspaceQuestion[];
}

/**
 * Your questions: the box's list, ranked, each with a tick that puts it on the open draft's list
 * (or takes it off), a copy button, Ask AI and the searches behind it.
 */
export function QuestionList({
  canTryExample,
  className,
}: {
  /** True while the home offers Try it with an example, so the empty list can point to it. */
  canTryExample: boolean;
  className?: string;
}) {
  const ids = useId();
  const input = useSiteInput();
  const list = useMemo(() => siteQuestionsOf(input), [input]);
  const onDraftRaw = useSyncExternalStore(subscribe, openDraftSnapshot, () => '[]');
  const onDraft = useMemo(() => JSON.parse(onDraftRaw) as WorkspaceQuestion[], [onDraftRaw]);
  const slot = useSyncExternalStore(subscribe, getActiveSlot, () => MY_POST_SLOT);
  const local = useSyncExternalStore(subscribeLocalModel, getLocalModel, getLocalModel);
  const model = local.status === 'ready' ? local.model : null;
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [held, setHeld] = useState<Held | null>(null);

  // With an empty box, the open draft's own questions, after any row unticked here, which stays
  // in place (unticked) until the box changes, so it does not vanish under the pointer.
  const kept = held !== null && held.input === input && held.slot === slot ? held.questions : [];
  const fromDraft = [...kept, ...onDraft.filter((q) => !hasQuestion(kept, q.text))];
  const derived = list.length === 0;
  const rows = derived ? fromDraft.map((q) => draftRowOf(q, isExampleSlot(slot))) : list.map(rowOf);

  const note = (text: string, n: Note | null) =>
    setNotes((all) => {
      const next = { ...all };
      if (n === null) delete next[questionKey(text)];
      else next[questionKey(text)] = n;
      return next;
    });

  function toggle(row: Row, ticked: boolean) {
    const { text } = row.question;
    // A row of the box is the visitor's own: never onto (or off) the example's list.
    if (!derived && isExampleSlot(slot)) startFresh();
    if (!ticked) {
      if (derived) setHeld({ input, slot, questions: fromDraft });
      removeFromDraft(text);
      note(text, null);
      return;
    }
    const { result } = addToDraft(row.question);
    note(
      text,
      result === 'full'
        ? { kind: 'text', text: `A draft holds ${MAX_QUESTIONS} questions. Untick one first.` }
        : null,
    );
  }

  function removeSuggested(text: string) {
    const now = getSiteInput();
    setSiteInput({
      ...now,
      suggested: now.suggested.filter((t) => questionKey(t) !== questionKey(text)),
    });
    note(text, null);
  }

  async function copy(text: string) {
    const ok = await copyText(text);
    note(text, {
      kind: 'text',
      text: ok ? 'Copied.' : 'Could not copy. Select the question and copy it.',
    });
  }

  async function askAi(text: string) {
    addCitedQuestion(text);
    await copyText(text);
    note(text, { kind: 'ask' });
  }

  return (
    <section aria-labelledby={`${ids}-list`} className={className}>
      <h2 id={`${ids}-list`} className="font-medium font-serif text-2xl">
        Your questions
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-muted-foreground text-sm">
          {canTryExample
            ? 'No questions yet. Type one above, or try the example.'
            : 'No questions yet. Type one above.'}
        </p>
      ) : (
        <>
          <p className="mt-1 text-muted-foreground text-sm">
            {plural(rows.length, 'question')}, {rankingWords(list)}.
            {list.length >= SITE_QUESTIONS_MAX ? ` Showing the top ${SITE_QUESTIONS_MAX}.` : ''}{' '}
            Tick the ones this draft should answer, up to {MAX_QUESTIONS}.
          </p>
          <ol aria-label="Your questions, ranked" className="mt-3 space-y-2.5">
            {rows.map((row) => {
              const { text } = row.question;
              return (
                <QuestionItem
                  key={questionKey(text)}
                  row={row}
                  ticked={hasQuestion(onDraft, text)}
                  model={model}
                  note={notes[questionKey(text)] ?? null}
                  onTick={(ticked) => toggle(row, ticked)}
                  onCopy={() => copy(text)}
                  onAsk={() => askAi(text)}
                  onRemove={row.suggested ? () => removeSuggested(text) : undefined}
                />
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

function QuestionItem({
  row,
  ticked,
  model,
  note,
  onTick,
  onCopy,
  onAsk,
  onRemove,
}: {
  row: Row;
  ticked: boolean;
  model: string | null;
  note: Note | null;
  onTick(ticked: boolean): void;
  onCopy(): void;
  onAsk(): void;
  /** Only for a question the local model suggested: the keywords' own go with their keyword. */
  onRemove?(): void;
}) {
  const id = useId();
  const { text } = row.question;
  return (
    <li className="rounded-lg border bg-surface px-4 py-3 shadow-card">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={ticked}
          onChange={(e) => onTick(e.currentTarget.checked)}
          className={cn(
            'mt-1 size-4 shrink-0 cursor-pointer rounded-sm accent-brand outline-none',
            'focus-visible:ring-[3px] focus-visible:ring-ring',
          )}
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} data-question className="cursor-pointer break-words font-medium">
            {text}
          </label>
          {(row.meta !== '' || row.tag !== null) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-soft text-xs">
              {row.tag !== null && (
                <span className="rounded-full border px-2 py-0.5">{row.tag}</span>
              )}
              {row.meta !== '' && <span>{row.meta}</span>}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy "${text}"`}
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
            aria-label={`Remove "${text}"`}
            title="Remove"
            onClick={onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="mt-2 pl-7">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Ask AI: ${text}`}
          onClick={onAsk}
        >
          <MessagesSquare aria-hidden="true" />
          Ask AI
        </Button>
        {note !== null && (
          <div role="status" className="mt-2 text-sm">
            {note.kind === 'text' ? note.text : <AskSteps />}
          </div>
        )}
        <SearchesBehind question={text} localModel={model} className="mt-2" />
      </div>
    </li>
  );
}

/** What to do after Ask AI copied the question. */
function AskSteps() {
  return (
    <>
      <p>Copied.</p>
      <ol aria-label="Ask AI" className="mt-1 list-decimal space-y-0.5 pl-5">
        <li>Paste the question into ChatGPT, Perplexity, Gemini or Copilot.</li>
        <li>Copy the answer with its links.</li>
        <li>
          Paste it in{' '}
          <Link href={VIEW_HREF.cited} prefetch={false} className={textLink}>
            Results
          </Link>
          , next to the question.
        </li>
      </ol>
    </>
  );
}
