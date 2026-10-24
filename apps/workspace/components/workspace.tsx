'use client';

import { DEFAULT_SETTINGS, OllamaAdapter } from '@citation-equity/bench';
import {
  type CheckId,
  gather,
  PRESET_WEIGHTS,
  parseDraft,
  questionCoverage,
  type Range,
  type Suggestion,
  type Weights,
} from '@citation-equity/engine';
import { RotateCcw, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type EditorHighlight,
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '@/components/editor/markdown-editor';
import { MergePreview } from '@/components/editor/merge-preview';
import { BenchPanel } from '@/components/panel/bench-panel';
import { CheckList } from '@/components/panel/check-list';
import {
  ModelMissingNote,
  OllamaInstructions,
  UnreachableNote,
} from '@/components/panel/ollama-help';
import { ScoreCard } from '@/components/panel/score-card';
import type { WordingState } from '@/components/panel/suggestion-card';
import { type HandledSuggestion, SuggestionList } from '@/components/panel/suggestion-list';
import { TargetQuestions } from '@/components/panel/target-questions';
import { PresetToggle } from '@/components/panel/weight-controls';
import { SamplePicker } from '@/components/sample-picker';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  applySuggestion,
  mapApplied,
  mapRange,
  revertSuggestion,
  sectionAround,
  textChange,
} from '@/lib/apply';
import { classifyBenchError, draftTitle } from '@/lib/bench';
import { initialQuestions, type WorkspaceQuestion } from '@/lib/questions';
import { MY_DRAFT_LABEL, SAMPLES, sampleFor, startingText } from '@/lib/samples';
import {
  clearDraft,
  forgetDraft,
  loadDraft,
  loadQuestions,
  loadStatuses,
  type SuggestionStatus,
  saveDraft,
  saveQuestions,
  saveStatuses,
} from '@/lib/storage';
import { type ActivePreset, useAnalysis } from '@/lib/use-analysis';
import { proposeWording } from '@/lib/wording-helper';

type Statuses = Record<string, SuggestionStatus>;

/** The local model the wording helper asks (the bench's default). */
const WORDING_MODEL = DEFAULT_SETTINGS.model;

/** What the card says when the wording helper fails. */
function wordingError(err: unknown) {
  const failure = classifyBenchError(err);
  if (failure.kind === 'unavailable') {
    return (
      <>
        <UnreachableNote />
        <OllamaInstructions model={WORDING_MODEL} />
      </>
    );
  }
  if (failure.kind === 'model-missing') return <ModelMissingNote model={WORDING_MODEL} />;
  return <p>The local model could not propose wording: {failure.message}</p>;
}

/**
 * 'applied' is session-only. Undo needs the suggestion itself, which is not
 * saved, and suggestion ids hash the text they replace, so a saved 'applied'
 * would hide the card for good if that text ever came back.
 */
function withoutApplied(statuses: Statuses): Statuses {
  return Object.fromEntries(Object.entries(statuses).filter(([, st]) => st !== 'applied'));
}

/** What "Undo reset" puts back: the text, the statuses and the applied edits with their Undo. */
interface ResetSnapshot {
  markdown: string;
  statuses: Statuses;
  applied: Suggestion[];
  undoStale: Set<string>;
}

const navLink =
  'rounded-sm text-muted-foreground text-sm hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

/**
 * The workspace: the draft on the left, the analysis on the right. The draft
 * changes only when the author types or clicks Apply (or Undo) on one
 * suggestion; there is no bulk action.
 */
export function Workspace() {
  const [slug, setSlug] = useState(() => SAMPLES[0]?.slug ?? '');
  const sample = useMemo(() => sampleFor(slug), [slug]);
  const [markdown, setMarkdownState] = useState(() => startingText(slug));
  /**
   * The draft as of the last change, read by changeMarkdown so applied edits
   * map through each change even when two arrive before a render.
   */
  const markdownRef = useRef(markdown);
  /** Bumped when the draft is replaced wholesale (load, reset), so the editor starts a fresh undo history. */
  const [docVersion, setDocVersion] = useState(0);
  /** The draft's target questions; saved ones replace this prefill once storage is read. */
  const [questions, setQuestions] = useState<WorkspaceQuestion[]>(() =>
    initialQuestions(sampleFor(slug), startingText(slug)),
  );
  /** The model the bench panel's local-model check found (null until that click). */
  const [localModel, setLocalModel] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Statuses>({});
  /** The sample whose saved draft and statuses are loaded; nothing is saved before that. */
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null);
  const [preset, setPreset] = useState<ActivePreset>('foundation');
  const [customWeights, setCustomWeights] = useState<Weights | null>(null);
  const [stale, setStale] = useState<Record<string, Suggestion>>({});
  /** Applied edits, each with its range kept on where its `after` text now sits. */
  const [applied, setApplied] = useState<Suggestion[]>([]);
  const [undoStale, setUndoStale] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<Suggestion | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | undefined>(undefined);
  const [wording, setWording] = useState<Record<string, WordingState>>({});
  /** Set by Reset draft until the author types, so one click can put the old draft back. */
  const [resetUndo, setResetUndo] = useState<ResetSnapshot | null>(null);
  /** The sample on screen, so a wording proposal that arrives after a switch is dropped. */
  const slugRef = useRef(slug);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  /**
   * Every change to the draft goes through here. A plain change keeps applied
   * edits pointing at their text; `replace` (load, reset) starts the editor's
   * undo history afresh, so Cmd-Z never brings back another draft's text.
   */
  function changeMarkdown(next: string, { replace = false } = {}) {
    const prev = markdownRef.current;
    markdownRef.current = next;
    setMarkdownState(next);
    if (replace) {
      setDocVersion((v) => v + 1);
      return;
    }
    setResetUndo(null);
    if (prev === next) return;
    const change = textChange(prev, next);
    setApplied((list) => list.map((a) => mapApplied(a, change)));
  }

  const questionTexts = useMemo(() => questions.map((q) => q.text), [questions]);
  const { result, pending, refresh } = useAnalysis(
    markdown,
    preset,
    customWeights ?? PRESET_WEIGHTS.foundation,
    questionTexts,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per draft switch; changeMarkdown only sets state
  useEffect(() => {
    const draft = loadDraft(slug) ?? startingText(slug);
    changeMarkdown(draft, { replace: true });
    setQuestions(loadQuestions(slug) ?? initialQuestions(sampleFor(slug), draft));
    setLocalModel(null);
    setStatuses(withoutApplied(loadStatuses(slug)));
    setStale({});
    setApplied([]);
    setUndoStale(new Set());
    setActiveId(null);
    setPreview(null);
    setWording({});
    setResetUndo(null);
    slugRef.current = slug;
    setLoadedSlug(slug);
  }, [slug]);

  // The untouched starting text is not saved, so a later edit to a sample reaches returning visitors.
  useEffect(() => {
    if (loadedSlug !== slug) return;
    if (markdown === startingText(slug)) forgetDraft(slug);
    else saveDraft(slug, markdown);
  }, [loadedSlug, slug, markdown]);

  useEffect(() => {
    if (loadedSlug === slug) saveStatuses(slug, withoutApplied(statuses));
  }, [loadedSlug, slug, statuses]);

  useEffect(() => {
    if (loadedSlug === slug) saveQuestions(slug, questions);
  }, [loadedSlug, slug, questions]);

  // Where the analyzed text answers each target question (or should), for the coverage card.
  const analyzedMarkdown = result?.markdown;
  const coverage = useMemo(
    () =>
      analyzedMarkdown === undefined
        ? []
        : questionCoverage(gather(parseDraft(analyzedMarkdown)), questionTexts),
    [analyzedMarkdown, questionTexts],
  );

  const suggestions = useMemo(
    () =>
      (result?.checks ?? [])
        .flatMap((c) => c.suggestions)
        .sort((a, b) => a.range.start - b.range.start),
    [result],
  );
  /** What each suggestion's check found at its text, where the rationale does not already say it. */
  const findings = useMemo(() => {
    const out: Record<string, string> = {};
    for (const check of result?.checks ?? []) {
      for (const s of check.suggestions) {
        const f = check.findings.find(
          (f) => f.range.start === s.range.start && f.range.end === s.range.end,
        );
        if (f && f.message.trim() !== '' && !s.rationale.includes(f.message)) out[s.id] = f.message;
      }
    }
    return out;
  }, [result]);
  const pendingSuggestions = useMemo(
    () => suggestions.filter((s) => (statuses[s.id] ?? 'pending') === 'pending'),
    [suggestions, statuses],
  );

  const handled: HandledSuggestion[] = [
    ...applied
      .filter((s) => statuses[s.id] === 'applied')
      .map((s) => ({ suggestion: s, status: 'applied' as const, undoStale: undoStale.has(s.id) })),
    ...suggestions.flatMap((s) => {
      const status = statuses[s.id];
      return status === 'done' || status === 'ignored'
        ? [{ suggestion: s, status, undoStale: false }]
        : [];
    }),
  ];

  // Anchors are replaced only by an analysis of the current text; in between,
  // the editor maps the previous ones through the author's edits.
  const fresh = result?.markdown === markdown;
  const nextHighlights = useMemo<EditorHighlight[]>(
    () =>
      pendingSuggestions.map((s) => ({
        range: s.range,
        checkId: s.checkId,
        active: s.id === activeId,
      })),
    [pendingSuggestions, activeId],
  );
  const [highlights, setHighlights] = useState<EditorHighlight[]>([]);
  useEffect(() => {
    if (fresh) setHighlights(nextHighlights);
  }, [fresh, nextHighlights]);

  // An applied edit's text is gone from the draft, so its id is gone from the
  // analysis. If an analysis of the current text proposes that id again, the
  // text came back (for example the editor's own undo), so the suggestion is
  // pending again and its Undo, which could only fail as stale, is dropped.
  useEffect(() => {
    if (!fresh) return;
    const back = new Set(suggestions.filter((s) => statuses[s.id] === 'applied').map((s) => s.id));
    if (back.size === 0) return;
    setStatuses((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !back.has(id))));
    setApplied((prev) => prev.filter((a) => !back.has(a.id)));
    setUndoStale((prev) => new Set([...prev].filter((id) => !back.has(id))));
  }, [fresh, suggestions, statuses]);

  // An Apply refused as stale may have been about text that only moved: once an analysis of the
  // current text proposes that id again over text that still reads `before`, it is valid again.
  useEffect(() => {
    if (!fresh) return;
    const valid = suggestions.filter(
      (s) => s.id in stale && markdown.slice(s.range.start, s.range.end) === s.before,
    );
    if (valid.length === 0) return;
    setStale((prev) => {
      const next = { ...prev };
      for (const s of valid) delete next[s.id];
      return next;
    });
  }, [fresh, suggestions, stale, markdown]);

  /**
   * Where a suggestion's range sits in the current text. Ranges come from the
   * last analysis, which can trail the editor by the debounce; a change that
   * touches the range, even only borders it, gives null (out of date).
   */
  function currentRange(s: Suggestion): Range | null {
    const analyzed = result?.markdown;
    if (analyzed === undefined || analyzed === markdown) return s.range;
    return mapRange(s.range, textChange(analyzed, markdown), 'touches');
  }

  function setStatus(id: string, status: SuggestionStatus) {
    setStatuses((prev) => {
      const next = { ...prev };
      if (status === 'pending') delete next[id];
      else next[id] = status;
      return next;
    });
    setStale(({ [id]: _, ...rest }) => rest);
  }

  function apply(s: Suggestion) {
    const range = currentRange(s);
    const outcome = range ? applySuggestion(markdown, { ...s, range }) : null;
    if (!range || !outcome?.ok) {
      setStale((prev) => ({ ...prev, [s.id]: s }));
      refresh();
      return;
    }
    changeMarkdown(outcome.markdown);
    const at = { ...s, range };
    setApplied((prev) => [...prev.filter((a) => a.id !== s.id), at]);
    setStatus(s.id, 'applied');
    openPreview(null);
  }

  function undo({ suggestion, status }: HandledSuggestion) {
    if (status !== 'applied') {
      setStatus(suggestion.id, 'pending');
      return;
    }
    // The applied list holds the current range; the handled row may hold an older copy.
    const s = applied.find((a) => a.id === suggestion.id) ?? suggestion;
    const outcome = revertSuggestion(markdown, s);
    if (!outcome.ok) {
      setUndoStale((prev) => new Set(prev).add(s.id));
      return;
    }
    changeMarkdown(outcome.markdown);
    setApplied((prev) => prev.filter((a) => a.id !== s.id));
    setUndoStale((prev) => {
      const next = new Set(prev);
      next.delete(s.id);
      return next;
    });
    setStatus(s.id, 'pending');
  }

  function openPreview(s: Suggestion | null, note?: string) {
    setPreview(s);
    setPreviewNote(note);
  }

  /**
   * Asks the local model (only on this click) for wording that addresses an
   * advisory, then opens the proposal side by side. Nothing is applied here.
   */
  async function suggestWording(s: Suggestion) {
    const forSlug = slug;
    const section = sectionAround(markdown, s.range);
    setWording((prev) => ({ ...prev, [s.id]: { status: 'asking' } }));
    try {
      const proposal = await proposeWording(
        s,
        markdown.slice(section.start, section.end),
        new OllamaAdapter(),
        WORDING_MODEL,
      );
      if (slugRef.current !== forSlug) return;
      setWording(({ [s.id]: _, ...rest }) => rest);
      openPreview(
        proposal,
        `Wording proposed by ${WORDING_MODEL} on this computer. Check that it keeps your facts before you apply it.`,
      );
    } catch (err) {
      if (slugRef.current !== forSlug) return;
      setWording((prev) => ({ ...prev, [s.id]: { status: 'error', message: wordingError(err) } }));
    }
  }

  function show(s: Suggestion) {
    setActiveId(s.id);
    editorRef.current?.focusRange(currentRange(s) ?? s.range);
  }

  function showRange(range: Range) {
    setActiveId(null);
    editorRef.current?.focusRange(range);
  }

  function changeWeight(id: CheckId, value: number) {
    const base =
      preset === 'custom' && customWeights
        ? customWeights
        : PRESET_WEIGHTS[preset === 'custom' ? 'foundation' : preset];
    setCustomWeights({ ...base, [id]: value });
    setPreset('custom');
  }

  function resetDraft() {
    const snapshot: ResetSnapshot = { markdown, statuses, applied, undoStale };
    clearDraft(slug);
    changeMarkdown(startingText(slug), { replace: true });
    setStatuses({});
    setStale({});
    setApplied([]);
    setUndoStale(new Set());
    setResetUndo(snapshot.markdown === startingText(slug) ? null : snapshot);
  }

  function undoReset() {
    if (!resetUndo) return;
    changeMarkdown(resetUndo.markdown, { replace: true });
    setStatuses(resetUndo.statuses);
    setApplied(resetUndo.applied);
    setUndoStale(resetUndo.undoStale);
    setResetUndo(null);
  }

  const draftHeading = sample ? sample.title : draftTitle(markdown, MY_DRAFT_LABEL);

  const shownWeights =
    preset === 'custom' ? (customWeights ?? PRESET_WEIGHTS.foundation) : PRESET_WEIGHTS[preset];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b px-4 py-3">
        <p className="font-semibold">Citation Equity</p>
        <SamplePicker samples={SAMPLES} value={slug} onChange={setSlug} />
        <PresetToggle value={preset} hasCustom={customWeights !== null} onChange={setPreset} />
        <nav
          aria-label="Pages"
          className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-4"
        >
          <Link href="/evidence" prefetch={false} className={navLink}>
            Evidence
          </Link>
          <Link href="/site" prefetch={false} className={navLink}>
            Site readiness
          </Link>
          <Link href="/off-page" prefetch={false} className={navLink}>
            Off-page
          </Link>
          <Link href="/about" prefetch={false} className={navLink}>
            About
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,58fr)_minmax(0,42fr)]">
        <section
          aria-label="Draft"
          className="flex min-h-[60vh] flex-col overflow-hidden rounded-lg border lg:sticky lg:top-4 lg:h-[calc(100dvh-6rem)]"
        >
          <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
            <h1 className="min-w-0 truncate font-medium text-sm">{draftHeading}</h1>
            <Button type="button" variant="ghost" size="sm" onClick={resetDraft}>
              <RotateCcw aria-hidden="true" />
              {sample ? 'Reset draft' : 'Clear draft'}
            </Button>
          </div>
          {resetUndo && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2 border-b bg-warning px-3 py-1.5 text-sm text-warning-foreground"
            >
              <p>
                {sample ? 'Draft reset to the sample.' : 'Draft cleared.'} Your previous text is
                kept until you type.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={undoReset}>
                <Undo2 aria-hidden="true" />
                {sample ? 'Undo reset' : 'Undo clear'}
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <MarkdownEditor
              ref={editorRef}
              value={markdown}
              docVersion={docVersion}
              onChange={changeMarkdown}
              highlights={highlights}
              ariaLabel="Draft in Markdown"
            />
          </div>
        </section>

        <aside aria-label="Analysis" className="space-y-4">
          {result && (
            <>
              <ScoreCard
                scores={result.scores}
                wordCount={result.wordCount}
                active={preset}
                pending={pending}
              />
              <TargetQuestions
                key={slug}
                questions={questions}
                onChange={setQuestions}
                markdown={markdown}
                localModel={localModel}
              />
              <SuggestionList
                pending={pendingSuggestions}
                handled={handled}
                stale={stale}
                activeId={activeId}
                onShow={show}
                wording={wording}
                onPreview={(s) => openPreview(s)}
                onApply={apply}
                onMarkDone={(s) => setStatus(s.id, 'done')}
                onIgnore={(s) => setStatus(s.id, 'ignored')}
                onSuggestWording={suggestWording}
                findings={findings}
                onUndo={undo}
                onDismissStale={(id) => setStale(({ [id]: _, ...rest }) => rest)}
              />
              <CheckList
                checks={result.checks}
                weights={shownWeights}
                onWeightChange={changeWeight}
                questionCoverage={coverage}
                onShowRange={showRange}
              />
            </>
          )}
          {/* Recorded results, and a local run only after the author clicks. */}
          <BenchPanel
            key={slug}
            sample={sample}
            markdown={markdown}
            fallbackTitle={sample?.title ?? MY_DRAFT_LABEL}
            onLocalModel={setLocalModel}
          />
        </aside>
      </main>

      <MergePreview
        markdown={markdown}
        suggestion={preview}
        note={previewNote}
        onApply={apply}
        onClose={() => openPreview(null)}
      />
    </div>
  );
}
