'use client';

import { OllamaAdapter } from '@citation-equity/bench';
import {
  type AnalysisResult,
  CHECK_IDS,
  type CheckId,
  gather,
  groupFixes,
  PRESET_WEIGHTS,
  pageQuestions,
  parseDraft,
  questionCoverage,
  type Range,
  rankFixes,
  type Suggestion,
  startHereFixes,
  type Weights,
} from '@citation-equity/engine';
import { Laptop, List, ListChecks, PenLine, RotateCcw, Target } from 'lucide-react';
import {
  type ReactNode,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  type EditorHighlight,
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '@/components/editor/markdown-editor';
import { MergePreview } from '@/components/editor/merge-preview';
import { Button } from '@/components/ui/button';
import {
  applySuggestion,
  mapApplied,
  mapRange,
  revertSuggestion,
  sectionAround,
  textChange,
} from '@/lib/apply';
import {
  type Baseline,
  loadBaseline,
  replacesMostOf,
  saveBaseline,
  sinceStart,
} from '@/lib/baseline';
import { classifyBenchError } from '@/lib/bench';
import { draftKeyFor, selectDraftSlot, slotFor } from '@/lib/draft-summary';
import { fixCopy, STALE_MESSAGE } from '@/lib/fix-copy';
import { chipFor } from '@/lib/glossary';
import { authorQuestionTexts, initialQuestions, type WorkspaceQuestion } from '@/lib/questions';
import {
  exampleLabel,
  MY_DRAFT_LABEL,
  MY_DRAFT_SLUG,
  SAMPLES,
  sampleFor,
  startingText,
} from '@/lib/samples';
import {
  clearDraft,
  forgetDraft,
  forgetQuestions,
  loadDraft,
  loadQuestions,
  loadStatuses,
  type SuggestionStatus,
  saveDraft,
  saveQuestions,
  saveStatuses,
} from '@/lib/storage';
import {
  getActiveSlot,
  getSummary,
  MY_POST_SLOT,
  setSummary,
  storageAvailable,
  subscribe,
} from '@/lib/store';
import { type ActivePreset, useAnalysis } from '@/lib/use-analysis';
import { useScrollToHash } from '@/lib/use-scroll-to-hash';
import { cn } from '@/lib/utils';
import { START_HERE_ID } from '@/lib/views';
import { offersWordingHelper, proposeWording } from '@/lib/wording-helper';
import { AllChecks } from './all-checks';
import type { WordingState } from './fix-card';
import { type FixGroup, FixGroups } from './fix-groups';
import { ModelMissingNote, OllamaInstructions, UnreachableNote } from './ollama-help';
import { RailSection } from './rail-section';
import { ReaderQuestions } from './reader-questions';
import { ScoreCard } from './score-card';
import { type FixItem, type HandledItem, StartHere } from './start-here';
import { TestIt } from './test-it';
import { type ToastState, UndoToast } from './undo-toast';

type Statuses = Record<string, SuggestionStatus>;

/**
 * 'applied' is session-only. Undo needs the suggestion itself, which is not saved,
 * and suggestion ids hash the text they replace, so a saved 'applied' would hide the card for
 * good if that text ever came back.
 */
function withoutApplied(statuses: Statuses): Statuses {
  return Object.fromEntries(Object.entries(statuses).filter(([, st]) => st !== 'applied'));
}

/** What Undo after Reset (or Clear) puts back. */
interface ResetSnapshot {
  markdown: string;
  statuses: Statuses;
  applied: Suggestion[];
  undoStale: Set<string>;
  baseline: Baseline | null;
}

/** What My post held before a paste into an example moved there, for Undo. */
interface MovedSnapshot {
  /** The example the paste was made in; Undo goes back to it. */
  fromSlot: string;
  markdown: string | null;
  questions: WorkspaceQuestion[] | null;
  baseline: Baseline | null;
}

/** What the toast's Undo reverses: one status, one applied edit, a reset, or a move to My post. */
type UndoTarget =
  | { kind: 'status'; id: string }
  | { kind: 'applied'; id: string }
  | { kind: 'reset'; snapshot: ResetSnapshot }
  | { kind: 'moved'; snapshot: MovedSnapshot };

/** Which column a phone shows; wider screens show both, whatever it says. */
type Pane = 'draft' | 'fixes';

/** The layout that shows the editor and the fix rail side by side (Tailwind's lg). */
const DESKTOP = '(min-width: 64rem)';
const isDesktop = () =>
  typeof window !== 'undefined' && (window.matchMedia?.(DESKTOP).matches ?? false);

/** The server and the first hydration render always show My post. */
const serverSlot = () => MY_POST_SLOT;

/** What each suggestion's check found at its range (its finding message), by suggestion id. */
function findingsOf(result: AnalysisResult | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const check of result?.checks ?? []) {
    for (const s of check.suggestions) {
      const f = check.findings.find(
        (f) => f.range.start === s.range.start && f.range.end === s.range.end,
      );
      if (f) out[s.id] = f.message;
    }
  }
  return out;
}

/**
 * Your draft: the paper editor and the fix rail (score, Start here, all fixes by check, then
 * Reader questions, All checks and Test it, collapsed). The draft changes only when the author
 * types, or clicks Apply in one edit's preview (or Undo); there is no bulk action.
 */
export function DraftView() {
  // The store's active slot; the server snapshot keeps the prerendered page on the empty My post,
  // so a new visitor never sees the example flash before an effect replaces it.
  const slot = useSyncExternalStore(subscribe, getActiveSlot, serverSlot);
  const draftKey = draftKeyFor(slot);
  const sample = useMemo(() => sampleFor(draftKey), [draftKey]);

  const [markdown, setMarkdownState] = useState(() => startingText(draftKey));
  /** The draft as of the last change, so applied edits map through changes that arrive together. */
  const markdownRef = useRef(markdown);
  /** Bumped when the draft is replaced wholesale (load, reset), so the editor's undo starts afresh. */
  const [docVersion, setDocVersion] = useState(0);
  const [questions, setQuestions] = useState<WorkspaceQuestion[]>(() =>
    initialQuestions(sampleFor(draftKey), startingText(draftKey)),
  );
  /** The model Connect local AI found (null until that click). */
  const [localModel, setLocalModel] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Statuses>({});
  /** The draft whose saved text and statuses are loaded; nothing is saved before that. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [preset, setPreset] = useState<ActivePreset>('foundation');
  const [customWeights, setCustomWeights] = useState<Weights | null>(null);
  const [stale, setStale] = useState<Record<string, Suggestion>>({});
  /** Applied edits, each with its range kept on where its `after` text now sits. */
  const [applied, setApplied] = useState<Suggestion[]>([]);
  const [undoStale, setUndoStale] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<Suggestion | null>(null);
  const [previewNote, setPreviewNote] = useState<string | undefined>(undefined);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<CheckId>>(() => new Set());
  /** The group opened last; its passages are underlined while no single fix is selected. */
  const [markedGroup, setMarkedGroup] = useState<CheckId | null>(null);
  const [wording, setWording] = useState<Record<string, WordingState>>({});
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [sections, setSections] = useState({ questions: false, checks: false, test: false });
  const [showWeights, setShowWeights] = useState(false);
  const [toast, setToast] = useState<(ToastState & { undo: UndoTarget }) | null>(null);
  const [pane, setPane] = useState<Pane>('draft');
  /**
   * Set by a jump to a passage (Show me, Show in draft): a phone then shows the draft with a bar
   * holding that fix's action and Back to fixes. `id` is the fix, or null for a reader question.
   */
  const [jump, setJump] = useState<{ id: string | null } | null>(null);
  /** A passage to select once the editor is on screen; a phone shows it only after the switch. */
  const [focusTarget, setFocusTarget] = useState<{ range: Range } | null>(null);
  /** "Saved in this browser" only once storage is known to work (after mount). */
  const [saves, setSaves] = useState(false);
  const keyRef = useRef(draftKey);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const checksRef = useRef<HTMLDivElement>(null);
  /** The switch's Fixes button: where focus goes when the fix bar it replaced closes. */
  const fixesButtonRef = useRef<HTMLButtonElement>(null);
  /** Set while a preview opened from the fix bar is open; that bar is gone when it closes. */
  const previewFromBar = useRef(false);
  /** Set by a move to My post; the toast shows once My post has loaded. */
  const movedFrom = useRef<MovedSnapshot | null>(null);

  useEffect(() => setSaves(storageAvailable()), []);

  // The fix bar is a phone's; once the layout is a desktop one, a jump leaves nothing to show.
  useEffect(() => {
    const mq = window.matchMedia?.(DESKTOP);
    if (!mq) return;
    const clear = () => {
      if (mq.matches) setJump(null);
    };
    mq.addEventListener('change', clear);
    return () => mq.removeEventListener('change', clear);
  }, []);

  useEffect(() => {
    if (focusTarget) editorRef.current?.focusRange(focusTarget.range);
  }, [focusTarget]);

  /**
   * Every change to the draft goes through here. A plain change keeps applied edits pointing at
   * their text, and a change that replaces most of the draft (a paste over it) starts the
   * baseline afresh; `replace` (load, reset) starts the editor's undo history afresh.
   */
  function changeMarkdown(next: string, { replace = false } = {}) {
    const prev = markdownRef.current;
    markdownRef.current = next;
    setMarkdownState(next);
    if (replace) {
      setDocVersion((v) => v + 1);
      return;
    }
    if (prev === next) return;
    if (replacesMostOf(prev, next)) resetBaseline();
    const change = textChange(prev, next);
    setApplied((list) => list.map((a) => mapApplied(a, change)));
  }

  function resetBaseline() {
    saveBaseline(slotFor(keyRef.current), null);
    setBaseline(null);
  }

  /**
   * The editor's own changes. A paste that replaces most of an example (the rule that makes it
   * another draft) is the author's own post: it moves to My post and the example stays as it was,
   * so the home tile shows My post and Reset to example never touches it.
   */
  function editorChange(next: string) {
    const prev = markdownRef.current;
    // Clearing the example (select all, then Delete or Cut) is not a post of one's own.
    if (
      keyRef.current !== MY_DRAFT_SLUG &&
      prev !== next &&
      next.trim() !== '' &&
      replacesMostOf(prev, next)
    ) {
      moveToMyPost(next);
      return;
    }
    // Once My post is edited after a move, the move's Undo would discard those edits.
    if (toast?.undo.kind === 'moved') setToast(null);
    changeMarkdown(next);
  }

  function moveToMyPost(text: string) {
    const previous = loadDraft(MY_DRAFT_SLUG);
    movedFrom.current = {
      fromSlot: slotFor(keyRef.current),
      markdown: previous,
      questions: loadQuestions(MY_DRAFT_SLUG),
      baseline: loadBaseline(MY_POST_SLOT),
    };
    // Questions saved for an empty My post came from no text; the pasted post gets its own.
    if (!previous?.trim()) forgetQuestions(MY_DRAFT_SLUG);
    saveDraft(MY_DRAFT_SLUG, text);
    saveBaseline(MY_POST_SLOT, null);
    selectDraftSlot(MY_POST_SLOT);
  }

  /** Undo of a move: My post as it was, and back to the example, which never changed. */
  function undoMove(snapshot: MovedSnapshot) {
    if (snapshot.markdown === null) forgetDraft(MY_DRAFT_SLUG);
    else saveDraft(MY_DRAFT_SLUG, snapshot.markdown);
    if (snapshot.questions === null) forgetQuestions(MY_DRAFT_SLUG);
    else saveQuestions(MY_DRAFT_SLUG, snapshot.questions);
    saveBaseline(MY_POST_SLOT, snapshot.baseline);
    selectDraftSlot(snapshot.fromSlot);
  }

  const questionTexts = useMemo(() => questions.map((q) => q.text), [questions]);
  const authorTexts = useMemo(() => authorQuestionTexts(questions), [questions]);
  const weights =
    preset === 'custom' ? (customWeights ?? PRESET_WEIGHTS.foundation) : PRESET_WEIGHTS[preset];
  const { result, pending, refresh } = useAnalysis(
    markdown,
    preset,
    customWeights ?? PRESET_WEIGHTS.foundation,
    questionTexts,
    authorTexts,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per draft switch; changeMarkdown only sets state
  useEffect(() => {
    keyRef.current = draftKey;
    const draft = loadDraft(draftKey) ?? startingText(draftKey);
    changeMarkdown(draft, { replace: true });
    setQuestions(loadQuestions(draftKey) ?? initialQuestions(sampleFor(draftKey), draft));
    setStatuses(withoutApplied(loadStatuses(draftKey)));
    setStale({});
    setApplied([]);
    setUndoStale(new Set());
    setActiveId(null);
    setOpenGroups(new Set());
    setMarkedGroup(null);
    setPreview(null);
    setWording({});
    setLocalModel(null);
    setToast(null);
    const moved = movedFrom.current;
    movedFrom.current = null;
    if (moved) {
      // Earlier My post text is replaced; Undo is the only way back, so that toast stays.
      const replaced = (moved.markdown ?? '').trim() !== '';
      showToast(
        replaced ? 'Moved to My post, replacing its earlier text.' : 'Moved to My post.',
        { kind: 'moved', snapshot: moved },
        replaced,
      );
    }
    // A phone opens a draft with content on its fixes, and an empty one on the editor to paste into.
    setPane(draft.trim() === '' ? 'draft' : 'fixes');
    setJump(null);
    setFocusTarget(null);
    const stored = getSummary('draft');
    const s = slotFor(draftKey);
    setBaseline(loadBaseline(s) ?? (stored?.slot === s ? stored.baseline : null));
    setLoadedKey(draftKey);
  }, [draftKey]);

  // The untouched starting text is not saved, so a later edit to an example reaches returning visitors.
  useEffect(() => {
    if (loadedKey !== draftKey) return;
    if (markdown === startingText(draftKey)) forgetDraft(draftKey);
    else saveDraft(draftKey, markdown);
  }, [loadedKey, draftKey, markdown]);

  useEffect(() => {
    if (loadedKey === draftKey) saveStatuses(draftKey, withoutApplied(statuses));
  }, [loadedKey, draftKey, statuses]);

  useEffect(() => {
    if (loadedKey === draftKey) saveQuestions(draftKey, questions);
  }, [loadedKey, draftKey, questions]);

  // Anchors and scores are trusted only from an analysis of the current text.
  const fresh = result?.markdown === markdown && loadedKey === draftKey;

  // The first scores of a slot (or of a pasted-over draft) are its baseline.
  useEffect(() => {
    if (!fresh || baseline !== null || !result) return;
    const { foundation, evidence } = result.scores;
    if (foundation === null || evidence === null) return;
    const next = { standard: foundation, evidence };
    saveBaseline(slotFor(draftKey), next);
    setBaseline(next);
  }, [fresh, baseline, result, draftKey]);

  // The questions reader-words measured when the author has none of their own, worked out as
  // analyze() does, so the panel lists every question its cards can name.
  const pageQuestionTexts = useMemo(
    () =>
      result?.markdown === undefined || authorTexts.length > 0
        ? []
        : pageQuestions(result.markdown).map((q) => q.text),
    [result?.markdown, authorTexts],
  );

  const coverage = useMemo(
    () =>
      result?.markdown === undefined
        ? []
        : questionCoverage(gather(parseDraft(result.markdown)), questionTexts),
    [result?.markdown, questionTexts],
  );

  const suggestions = useMemo(() => (result?.checks ?? []).flatMap((c) => c.suggestions), [result]);
  const findings = useMemo(() => findingsOf(result), [result]);
  /** The ranking over open fixes only, so each check's gain divides by its open fixes. */
  const ranked = useMemo(() => {
    if (!result) return [];
    const isOpen = (s: Suggestion) => (statuses[s.id] ?? 'pending') === 'pending';
    const checks = result.checks.map((c) => ({ ...c, suggestions: c.suggestions.filter(isOpen) }));
    return rankFixes({ ...result, checks }, weights);
  }, [result, statuses, weights]);

  const item = (fix: (typeof ranked)[number]): FixItem => ({
    fix,
    copy: fixCopy(fix.suggestion, findings[fix.suggestion.id]),
    stale: fix.suggestion.id in stale,
    canSuggest: localModel !== null && offersWordingHelper(fix.suggestion),
    wording: wording[fix.suggestion.id],
  });

  const handled: HandledItem[] = [
    ...applied
      .filter((s) => statuses[s.id] === 'applied')
      .map((s) => ({ suggestion: s, status: 'applied' as const, undoStale: undoStale.has(s.id) })),
    ...suggestions.flatMap((s) => {
      const status = statuses[s.id];
      return status === 'done' || status === 'ignored'
        ? [{ suggestion: s, status, undoStale: false }]
        : [];
    }),
  ].map((h) => ({ ...h, copy: fixCopy(h.suggestion, findings[h.suggestion.id]) }));

  const groups: FixGroup[] = (() => {
    const out: FixGroup[] = groupFixes(ranked).map((g) => ({
      checkId: g.checkId,
      items: [],
      handled: [],
      chip: chipFor(g.checkId, weights[g.checkId]),
    }));
    const byCheck = new Map(out.map((g) => [g.checkId, g]));
    for (const g of groupFixes(ranked)) byCheck.get(g.checkId)?.items.push(...g.fixes.map(item));
    for (const id of CHECK_IDS) {
      const done = handled.filter((h) => h.suggestion.checkId === id);
      if (done.length === 0) continue;
      const group = byCheck.get(id) ?? {
        checkId: id,
        items: [],
        handled: [],
        chip: chipFor(id, weights[id]),
      };
      if (!byCheck.has(id)) {
        byCheck.set(id, group);
        out.push(group);
      }
      group.handled.push(...done);
    }
    return out;
  })();

  const startHere = startHereFixes(ranked).map(item);
  // Next up on the home links here (/draft/#start-here); the list appears after the analysis.
  useScrollToHash(START_HERE_ID, fresh && startHere.length > 0);

  // Only the selected fix (the editor's active highlight, underlined and filled), or else the
  // ranges of the group opened last (the editor's selectedRanges, underlined), are marked;
  // nothing on load.
  const nextMarks = useMemo<{ highlights: EditorHighlight[]; selected: Range[] }>(() => {
    const active = ranked.find((f) => f.suggestion.id === activeId);
    if (active) {
      return {
        highlights: [{ range: active.suggestion.range, checkId: active.checkId, active: true }],
        selected: [],
      };
    }
    if (markedGroup === null || !openGroups.has(markedGroup))
      return { highlights: [], selected: [] };
    return {
      highlights: [],
      selected: ranked.filter((f) => f.checkId === markedGroup).map((f) => f.suggestion.range),
    };
  }, [ranked, activeId, markedGroup, openGroups]);
  const [marks, setMarks] = useState<{ highlights: EditorHighlight[]; selected: Range[] }>({
    highlights: [],
    selected: [],
  });
  useEffect(() => {
    if (fresh) setMarks(nextMarks);
  }, [fresh, nextMarks]);

  // An applied edit's text is gone, so its id is gone from the analysis. If a fresh analysis
  // proposes that id again, the text came back (the editor's own undo): pending again.
  useEffect(() => {
    if (!fresh) return;
    const back = new Set(suggestions.filter((s) => statuses[s.id] === 'applied').map((s) => s.id));
    if (back.size === 0) return;
    setStatuses((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !back.has(id))));
    setApplied((prev) => prev.filter((a) => !back.has(a.id)));
    setUndoStale((prev) => new Set([...prev].filter((id) => !back.has(id))));
  }, [fresh, suggestions, statuses]);

  // An Apply refused as stale may have been about text that only moved: once a fresh analysis
  // proposes that id again over text that still reads `before`, it is valid again.
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

  // The draft tile's summary: written after each fresh analysis of real content.
  // Its score is always the Standard score, whatever mode is shown, so the home's "+N" compares
  // Standard with Standard.
  const score = result?.scores.foundation ?? null;
  const openStartHere = startHere.length;
  const summaryKey = useRef('');
  useEffect(() => {
    if (!fresh || score === null || baseline === null) return;
    const s = slotFor(draftKey);
    const keyNow = JSON.stringify([s, score, baseline, openStartHere]);
    if (summaryKey.current === keyNow) return;
    summaryKey.current = keyNow;
    setSummary('draft', {
      slot: s,
      score,
      baseline,
      openStartHere,
      example: s !== MY_POST_SLOT,
      at: new Date().toISOString(),
    });
  }, [fresh, score, baseline, openStartHere, draftKey]);

  /**
   * Where a suggestion's range sits in the current text. Ranges come from the last analysis,
   * which can trail the editor by the debounce; a change that touches the range gives null.
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

  const toastId = useRef(0);
  function showToast(message: string, undo: UndoTarget, persist = false) {
    toastId.current++;
    setToast({ id: toastId.current, message, undo, persist });
  }

  function apply(s: Suggestion) {
    const range = currentRange(s);
    const outcome = range ? applySuggestion(markdown, { ...s, range }) : null;
    if (!range || !outcome?.ok) {
      setStale((prev) => ({ ...prev, [s.id]: s }));
      setPreview(null);
      refresh();
      return;
    }
    changeMarkdown(outcome.markdown);
    setApplied((prev) => [...prev.filter((a) => a.id !== s.id), { ...s, range }]);
    setStatus(s.id, 'applied');
    if (activeId === s.id) setActiveId(null);
    setPreview(null);
    showToast('Applied.', { kind: 'applied', id: s.id });
  }

  function handle(s: Suggestion, status: 'done' | 'ignored') {
    setStatus(s.id, status);
    if (activeId === s.id) setActiveId(null);
    showToast(status === 'done' ? 'Done.' : 'Skipped.', { kind: 'status', id: s.id });
  }

  function undoApplied(id: string) {
    const s = applied.find((a) => a.id === id);
    if (!s) return;
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

  function undo(target: UndoTarget) {
    setToast(null);
    if (target.kind === 'status') setStatus(target.id, 'pending');
    else if (target.kind === 'applied') undoApplied(target.id);
    else if (target.kind === 'moved') undoMove(target.snapshot);
    else undoReset(target.snapshot);
  }

  function undoHandled(h: HandledItem) {
    if (h.status === 'applied') undoApplied(h.suggestion.id);
    else setStatus(h.suggestion.id, 'pending');
    setToast(null);
  }

  function select(s: Suggestion) {
    setActiveId(s.id);
    jumpTo(currentRange(s) ?? s.range, s.id);
  }

  /** Selects a passage in the draft; on a phone, switches to the draft and shows the bar. */
  function jumpTo(range: Range, id: string | null) {
    setPane('draft');
    // A desktop shows the rail beside the draft, so it needs no bar (and no raised toast).
    setJump(isDesktop() ? null : { id });
    setFocusTarget({ range });
  }

  /** The Draft / Fixes switch: the chosen column, from its top. */
  function showPane(next: Pane) {
    setPane(next);
    setJump(null);
    requestAnimationFrame(() => document.scrollingElement?.scrollTo?.({ top: 0 }));
  }

  /**
   * Back to fixes, at the card the author jumped from, with focus on its main button; the
   * switch's Fixes button when that card is gone (a reader question, or a fix since handled).
   */
  function backToFixes() {
    const id = jump?.id ?? null;
    setPane('fixes');
    setJump(null);
    requestAnimationFrame(() => {
      const from = [...document.querySelectorAll<HTMLElement>('[data-fix]')].find(
        (el) => el.dataset.fix === id,
      );
      if (from?.scrollIntoView) from.scrollIntoView({ block: 'center' });
      else document.scrollingElement?.scrollTo?.({ top: 0 });
      const main = from?.querySelector<HTMLElement>('button');
      if (main) main.focus({ preventScroll: true });
      else fixesButtonRef.current?.focus({ preventScroll: true });
    });
  }

  /** The bar's Done: the bar and its button go, so focus moves to the switch's Fixes button. */
  function doneFromBar(s: Suggestion) {
    setJump(null);
    actions.onDone(s);
    requestAnimationFrame(() => fixesButtonRef.current?.focus({ preventScroll: true }));
  }

  /** The bar's Preview; on close, focus goes to the switch's Fixes button, as the bar is gone. */
  function previewFromBarOf(s: Suggestion) {
    previewFromBar.current = true;
    setJump(null);
    actions.onPreview(s);
  }

  function openPreview(s: Suggestion | null, note?: string) {
    setPreview(s);
    setPreviewNote(note);
  }

  /**
   * Asks the local model (only on this click) for wording that addresses an advisory, then
   * opens the proposal side by side. Nothing is applied here.
   */
  async function suggestWording(s: Suggestion) {
    if (localModel === null) return;
    const forKey = draftKey;
    const section = sectionAround(markdown, s.range);
    setActiveId(s.id);
    setWording((prev) => ({ ...prev, [s.id]: { status: 'asking' } }));
    try {
      const proposal = await proposeWording(
        s,
        markdown.slice(section.start, section.end),
        new OllamaAdapter(),
        localModel,
      );
      if (keyRef.current !== forKey) return;
      setWording(({ [s.id]: _, ...rest }) => rest);
      openPreview(
        proposal,
        `Written by ${localModel} on this computer. Check that it keeps your facts.`,
      );
    } catch (err) {
      if (keyRef.current !== forKey) return;
      setWording((prev) => ({
        ...prev,
        [s.id]: { status: 'error', message: wordingError(err, localModel) },
      }));
    }
  }

  function toggleGroup(id: CheckId) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMarkedGroup(openGroups.has(id) ? null : id);
    setActiveId(null);
  }

  function changeWeight(id: CheckId, value: number) {
    setCustomWeights({ ...weights, [id]: value });
    setPreset('custom');
  }

  function adjustWeights() {
    setSections((s) => ({ ...s, checks: true }));
    setShowWeights(true);
    requestAnimationFrame(() => checksRef.current?.scrollIntoView?.({ block: 'nearest' }));
  }

  /** Reset to example (or Clear, for My post): the starting text, no statuses, a new baseline. */
  function resetDraft() {
    const snapshot: ResetSnapshot = { markdown, statuses, applied, undoStale, baseline };
    clearDraft(draftKey);
    changeMarkdown(startingText(draftKey), { replace: true });
    setStatuses({});
    setStale({});
    setApplied([]);
    setUndoStale(new Set());
    setActiveId(null);
    resetBaseline();
    if (snapshot.markdown !== startingText(draftKey) || Object.keys(statuses).length > 0) {
      showToast(sample ? 'Reset.' : 'Cleared.', { kind: 'reset', snapshot });
    }
  }

  function undoReset(snapshot: ResetSnapshot) {
    changeMarkdown(snapshot.markdown, { replace: true });
    setStatuses(snapshot.statuses);
    setApplied(snapshot.applied);
    setUndoStale(snapshot.undoStale);
    saveBaseline(slotFor(draftKey), snapshot.baseline);
    setBaseline(snapshot.baseline);
  }

  const total = ranked.length + handled.length;
  const since =
    preset === 'custom' || !result
      ? null
      : sinceStart(
          result.scores[preset],
          preset === 'foundation' ? baseline?.standard : baseline?.evidence,
        );
  const answered = coverage.filter((c) => c.covered).length;
  // Empty at once when the text is (a slot switch needs no debounce to say so), else as analyzed.
  const empty = markdown.trim() === '' || (fresh && result.wordCount === 0);
  const actions = {
    onPreview: (s: Suggestion) => {
      setActiveId(s.id);
      openPreview(s);
    },
    onShow: select,
    onDone: (s: Suggestion) => handle(s, 'done'),
    onSkip: (s: Suggestion) => handle(s, 'ignored'),
    onSuggestWording: suggestWording,
  };
  const outdated = Object.values(stale).filter(
    (s) => !ranked.some((f) => f.suggestion.id === s.id),
  );
  /** A phone shows one column at a time once there are a score and fixes to switch to. */
  const split = !empty && result !== null;
  const jumped = jump?.id == null ? undefined : ranked.find((f) => f.suggestion.id === jump.id);
  /** The bar shows a fix's title, so it shows only while that fix is still in the list. */
  const showBar = jump !== null && (jump.id === null || jumped !== undefined);
  // The jumped fix left the list (fixed by an edit, say): the bar closes rather than show no title.
  // The bar's own actions move focus themselves; an edit leaves focus in the editor.
  const jumpGone = fresh && jump?.id != null && jumped === undefined;
  useEffect(() => {
    if (jumpGone) setJump(null);
  }, [jumpGone]);

  return (
    <main
      className={cn('mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6', showBar && 'max-lg:pb-24')}
    >
      {split && (
        <div className="sticky top-14 z-30 -mx-4 -mt-2 mb-4 bg-background/90 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:hidden">
          <fieldset className="grid min-w-0 grid-cols-2 gap-1 rounded-lg border bg-sunken p-1">
            <legend className="sr-only">Draft or fixes</legend>
            <PaneButton pressed={pane === 'draft'} onClick={() => showPane('draft')}>
              <PenLine aria-hidden="true" strokeWidth={1.75} />
              Draft
            </PaneButton>
            <PaneButton
              ref={fixesButtonRef}
              pressed={pane === 'fixes'}
              onClick={() => showPane('fixes')}
            >
              <ListChecks aria-hidden="true" strokeWidth={1.75} />
              Fixes
              <span
                aria-hidden="true"
                className="rounded-full bg-brand-soft px-1.5 font-semibold text-brand text-xs tabular-nums"
              >
                {ranked.length}
              </span>
              <span className="sr-only">{`, ${ranked.length} open`}</span>
            </PaneButton>
          </fieldset>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-labelledby="draft-title" className="min-w-0 space-y-3">
          {sample && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border-strong border-dashed px-3 py-2 text-ink-soft text-sm">
              <span>
                <span className="font-medium text-foreground">This is an example post.</span> Try a
                fix, then paste your own.
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => selectDraftSlot(MY_POST_SLOT)}
              >
                Paste my post
              </Button>
            </p>
          )}
          <div className="flex items-center gap-2 text-sm">
            <PenLine aria-hidden="true" className="size-4 text-ink-soft" strokeWidth={1.75} />
            <h1 id="draft-title" className="font-semibold">
              {sample ? exampleLabel(sample) : 'Your draft'}
            </h1>
            {saves && <span className="text-ink-soft">Saved in this browser</span>}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={sample ? 'Reset to example' : 'Clear draft'}
              title={sample ? 'Reset to example' : 'Clear draft'}
              onClick={resetDraft}
            >
              <RotateCcw aria-hidden="true" />
            </Button>
          </div>
          <div
            className={cn(
              'min-h-[60vh] overflow-hidden rounded-paper border bg-paper shadow-card',
              split && pane === 'fixes' && 'max-lg:hidden',
            )}
          >
            <MarkdownEditor
              ref={editorRef}
              value={markdown}
              docVersion={docVersion}
              onChange={editorChange}
              highlights={marks.highlights}
              selectedRanges={marks.selected}
              ariaLabel="Draft text"
            />
          </div>
        </section>

        <aside
          aria-label="Score and fixes"
          className={cn(
            'min-w-0 space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:p-1',
            split && pane === 'draft' && 'max-lg:hidden',
          )}
        >
          {empty || !result ? (
            <div className="rounded-lg border bg-surface p-6 text-center shadow-card">
              <span className="mx-auto mb-3 grid size-16 place-items-center rounded-full bg-brand-soft text-brand">
                <PenLine aria-hidden="true" className="size-7" strokeWidth={1.75} />
              </span>
              <h2 className="font-serif text-lg">No content yet</h2>
              <p className="mt-1 text-ink-soft text-sm">
                Paste or type your post. Your score and fixes show up here.
              </p>
              {SAMPLES[0] && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="mt-2"
                  onClick={() => selectDraftSlot(SAMPLES[0]?.slug ?? MY_POST_SLOT)}
                >
                  Use the example instead
                </Button>
              )}
            </div>
          ) : (
            <>
              <ScoreCard
                scores={result.scores}
                mode={preset}
                hasCustom={customWeights !== null}
                since={since}
                pending={pending}
                onModeChange={setPreset}
                onAdjustWeights={adjustWeights}
              />
              {total > 0 && (
                <div className="flex items-center gap-3 px-0.5 text-ink-soft text-xs">
                  <span className="tabular-nums">{`${handled.length} of ${total} handled`}</span>
                  <span
                    aria-hidden="true"
                    className="h-1 flex-1 overflow-hidden rounded-full bg-score-track"
                  >
                    <span
                      className="block h-full rounded-full bg-done motion-safe:transition-[width]"
                      style={{ width: `${(handled.length / total) * 100}%` }}
                    />
                  </span>
                </div>
              )}
              {outdated.map((s) => (
                <p
                  key={`outdated-${s.id}`}
                  role="status"
                  className="flex items-center justify-between gap-2 rounded-lg bg-stale-soft px-3 py-2 text-sm text-stale"
                >
                  <span>{STALE_MESSAGE}</span>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => setStale(({ [s.id]: _, ...rest }) => rest)}
                  >
                    Dismiss
                  </Button>
                </p>
              ))}
              <StartHere items={startHere} activeId={activeId} {...actions} />
              <FixGroups
                groups={groups}
                open={openGroups}
                onToggle={toggleGroup}
                activeId={activeId}
                onUndo={undoHandled}
                {...actions}
              />
              <RailSection
                title="Reader questions"
                icon={Target}
                meta={
                  questions.length > 0 ? `${questions.length} · ${answered} answered` : undefined
                }
                open={sections.questions}
                onOpenChange={(open) => setSections((s) => ({ ...s, questions: open }))}
              >
                <ReaderQuestions
                  key={draftKey}
                  questions={questions}
                  onChange={setQuestions}
                  markdown={markdown}
                  localModel={localModel}
                  coverage={coverage}
                  pageQuestions={pageQuestionTexts}
                  onShowRange={(range) => {
                    setActiveId(null);
                    jumpTo(range, null);
                  }}
                />
              </RailSection>
              <div ref={checksRef}>
                <RailSection
                  title={`All ${CHECK_IDS.length} checks`}
                  icon={List}
                  open={sections.checks}
                  onOpenChange={(open) => setSections((s) => ({ ...s, checks: open }))}
                >
                  <AllChecks
                    checks={result.checks}
                    weights={weights}
                    showWeights={showWeights}
                    onShowWeights={setShowWeights}
                    onWeightChange={changeWeight}
                  />
                </RailSection>
              </div>
            </>
          )}
          {!empty && result && (
            <RailSection
              title="Test it"
              icon={Laptop}
              meta="optional"
              open={sections.test}
              onOpenChange={(open) => setSections((s) => ({ ...s, test: open }))}
            >
              <TestIt
                key={draftKey}
                sample={sample}
                markdown={markdown}
                fallbackTitle={sample?.title ?? MY_DRAFT_LABEL}
                onLocalModel={setLocalModel}
              />
            </RailSection>
          )}
        </aside>
      </div>

      <MergePreview
        markdown={markdown}
        suggestion={preview}
        title={preview ? fixCopy(preview, findings[preview.id]).title : undefined}
        note={previewNote}
        onApply={apply}
        onClose={() => openPreview(null)}
        returnFocus={() => {
          const fromBar = previewFromBar.current;
          previewFromBar.current = false;
          return fromBar ? fixesButtonRef.current : null;
        }}
      />
      {showBar && (
        <section
          aria-label="Selected fix"
          className={cn(
            'fixed inset-x-3 bottom-3 z-30 flex items-center gap-2 rounded-xl border border-border-strong',
            'bg-surface py-2 pr-2 pl-3 shadow-pop lg:hidden',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2',
          )}
        >
          <p className="min-w-0 flex-1 truncate font-semibold text-sm">
            {jumped && fixCopy(jumped.suggestion, findings[jumped.suggestion.id]).title}
          </p>
          {jumped?.editable && (
            <Button type="button" size="sm" onClick={() => previewFromBarOf(jumped.suggestion)}>
              Preview
            </Button>
          )}
          {jumped && !jumped.editable && (
            <Button type="button" size="sm" onClick={() => doneFromBar(jumped.suggestion)}>
              Done
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={backToFixes}>
            Back to fixes
          </Button>
        </section>
      )}
      <UndoToast
        raised={showBar}
        toast={toast}
        onUndo={() => toast && undo(toast.undo)}
        onDismiss={() => setToast(null)}
      />
    </main>
  );
}

/** One side of the phone's Draft / Fixes switch. */
function PaneButton({
  ref,
  pressed,
  onClick,
  children,
}: {
  ref?: Ref<HTMLButtonElement>;
  pressed: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md font-medium text-sm outline-none',
        'transition-colors focus-visible:ring-[3px] focus-visible:ring-ring motion-safe:duration-150',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        pressed ? 'bg-surface text-foreground shadow-card' : 'text-ink-soft hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** What a card says when the wording helper fails. */
function wordingError(err: unknown, model: string) {
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
  return <p>The local AI could not suggest wording: {failure.message}</p>;
}
