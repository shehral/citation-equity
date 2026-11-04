'use client';

import { OllamaAdapter } from '@citation-equity/bench';
import {
  type AnalysisResult,
  CHECK_IDS,
  type CheckId,
  groupNotes,
  NOTE_CHECKS,
  QUESTION_LABELS,
  type QuestionInput,
  type QuestionRow,
  questionKey,
  quickEdit,
  type Range,
  type RankedNote,
  rankNotes,
  type Suggestion,
  suggestionFor,
  TEST_LABEL_ORDER,
  TEST_LABELS,
} from '@citation-equity/engine';
import {
  ArrowRight,
  Laptop,
  ListChecks,
  NotebookText,
  PenLine,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import {
  type ReactNode,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { LabelChip } from '@/components/check-chip';
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
  moveRange,
  paragraphAt,
  replacesMostOf,
  revertSuggestion,
  sectionAround,
  textChange,
} from '@/lib/apply';
import { classifyBenchError } from '@/lib/bench';
import { draftKeyFor, selectDraftSlot, slotFor } from '@/lib/draft-summary';
import { fixCopy, STALE_MESSAGE } from '@/lib/fix-copy';
import { labelTooltip } from '@/lib/glossary';
import {
  connect as connectLocalModel,
  getLocalModel,
  type LocalModel,
  subscribeLocalModel,
} from '@/lib/local-model';
import { draftQuestionsFor, draftTextFor } from '@/lib/open-draft';
import { initialQuestions, inputKindOf, labelsFor, type WorkspaceQuestion } from '@/lib/questions';
import { exampleLabel, MY_DRAFT_SLUG, SAMPLES, sampleFor, startingText } from '@/lib/samples';
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
import { getActiveSlot, MY_POST_SLOT, setSummary, storageAvailable, subscribe } from '@/lib/store';
import { useAnalysis } from '@/lib/use-analysis';
import { useScrollToHash } from '@/lib/use-scroll-to-hash';
import { cn } from '@/lib/utils';
import { START_HERE_ID, VIEW_HREF } from '@/lib/views';
import { offersWordingHelper, proposeWording } from '@/lib/wording-helper';
import type { WordingState } from './fix-card';
import { type FixGroup, FixGroups, type FixItem, type HandledItem, NoteChip } from './fix-groups';
import { ModelMissingNote, OllamaInstructions, UnreachableNote } from './ollama-help';
import { QuestionsCard } from './questions-card';
import { QuickEdit } from './quick-edit';
import { RailSection } from './rail-section';
import { ReaderQuestions } from './reader-questions';
import { CONNECT_NOTE } from './test-it';
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
}

/** What My post held before a paste into an example moved there, for Undo. */
interface MovedSnapshot {
  /** The example the paste was made in; Undo goes back to it. */
  fromSlot: string;
  markdown: string | null;
  questions: WorkspaceQuestion[] | null;
}

/** What the toast's Undo reverses: one status, one applied edit, a reset, or a move to My post. */
type UndoTarget =
  | { kind: 'status'; id: string }
  | { kind: 'applied'; id: string }
  | { kind: 'reset'; snapshot: ResetSnapshot }
  | { kind: 'moved'; snapshot: MovedSnapshot };

/**
 * The edit open in the preview, with the draft text its range was measured on (the analysis it
 * came from, which may trail the editor or have caught up since), and who wrote its wording.
 */
interface Opened {
  suggestion: Suggestion;
  on: string;
  note?: string;
}

/** Which column a phone shows (the draft, or its questions and notes); wider screens show both. */
type Pane = 'draft' | 'questions';

/**
 * Where a jump to a passage came from: a note (its id), or a line of the Questions covered card
 * (no id, its question).
 */
type Jump = { id: string; question?: undefined } | { id: null; question: string };

/** The layout that shows the editor and the rail side by side (Tailwind's lg). */
const DESKTOP = '(min-width: 64rem)';
const isDesktop = () =>
  typeof window !== 'undefined' && (window.matchMedia?.(DESKTOP).matches ?? false);

/** The server and the first hydration render always show My post. */
const serverSlot = () => MY_POST_SLOT;

/** Order of the writing-note groups: by label (as the engine orders them), then registry order. */
const byLabelThenCheck = (a: FixGroup, b: FixGroup) =>
  TEST_LABEL_ORDER.indexOf(a.label) - TEST_LABEL_ORDER.indexOf(b.label) ||
  CHECK_IDS.indexOf(a.checkId) - CHECK_IDS.indexOf(b.checkId);

/** A record of per-key states with one key set, or cleared for null. */
function withState<T>(states: Record<string, T>, key: string, state: T | null): Record<string, T> {
  const { [key]: _, ...rest } = states;
  return state === null ? rest : { ...rest, [key]: state };
}

/** The empty rail's line for a draft whose list already holds `n` questions. */
const waiting = (n: number) => (n === 1 ? '1 question is waiting.' : `${n} questions are waiting.`);

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
 * Your draft: the paper editor and the rail. Start here holds the Questions covered card (with
 * the question editor) and the Quick edit; then the writing notes by check (collapsed), a link to
 * Test it on Results, and the local AI. The draft changes only when the author types, or clicks
 * Apply in one edit's preview (or Undo); there is no bulk action.
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
    initialQuestions(sampleFor(draftKey)),
  );
  // The page's one connection to the local AI, shared with the other views. Nothing connects
  // before a click, so the server and the first paint read it as not connected.
  const connection = useSyncExternalStore(subscribeLocalModel, getLocalModel, getLocalModel);
  /** The model Connect local AI found (null until that click succeeds). */
  const localModel = connection.status === 'ready' ? connection.model : null;
  const [statuses, setStatuses] = useState<Statuses>({});
  /** The draft whose saved text and statuses are loaded; nothing is saved before that. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [stale, setStale] = useState<Record<string, Suggestion>>({});
  /** Applied edits, each with its range kept on where its `after` text now sits. */
  const [applied, setApplied] = useState<Suggestion[]>([]);
  const [undoStale, setUndoStale] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<Opened | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<CheckId>>(() => new Set());
  /** The group opened last; its passages are underlined while no single fix is selected. */
  const [markedGroup, setMarkedGroup] = useState<CheckId | null>(null);
  /** The wording helper's state per note (by suggestion id) and per card row (by question). */
  const [wording, setWording] = useState<Record<string, WordingState>>({});
  const [rowWording, setRowWording] = useState<Record<string, WordingState>>({});
  const [sections, setSections] = useState({ notes: false });
  /** The question editor under the Questions covered card. */
  const [editorOpen, setEditorOpen] = useState(false);
  const [toast, setToast] = useState<(ToastState & { undo: UndoTarget }) | null>(null);
  const [pane, setPane] = useState<Pane>('draft');
  /**
   * Set by a jump to a passage (Show me, Show): a phone then shows the draft with a bar holding
   * that note's title and action, or the card line's question, and Back.
   */
  const [jump, setJump] = useState<Jump | null>(null);
  /** A passage to select once the editor is on screen; a phone shows it only after the switch. */
  const [focusTarget, setFocusTarget] = useState<{ range: Range } | null>(null);
  /** "Saved in this browser" only once storage is known to work (after mount). */
  const [saves, setSaves] = useState(false);
  const keyRef = useRef(draftKey);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  /** The switch's Questions button: where focus goes when the bar it replaced closes. */
  const questionsButtonRef = useRef<HTMLButtonElement>(null);
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
   * their text; `replace` (load, reset) starts the editor's undo history afresh.
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
    const change = textChange(prev, next);
    setApplied((list) => list.map((a) => mapApplied(a, change)));
  }

  /**
   * The editor's own changes. A paste that replaces most of an example (the rule that makes it
   * another draft) is the author's own post: it moves to My post and the example stays as it was,
   * so the home shows My post and Reset to example never touches it.
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
    };
    // Questions saved for an empty My post came from no text; the pasted post gets its own.
    if (!previous?.trim()) forgetQuestions(MY_DRAFT_SLUG);
    saveDraft(MY_DRAFT_SLUG, text);
    selectDraftSlot(MY_POST_SLOT);
  }

  /** Undo of a move: My post as it was, and back to the example, which never changed. */
  function undoMove(snapshot: MovedSnapshot) {
    if (snapshot.markdown === null) forgetDraft(MY_DRAFT_SLUG);
    else saveDraft(MY_DRAFT_SLUG, snapshot.markdown);
    if (snapshot.questions === null) forgetQuestions(MY_DRAFT_SLUG);
    else saveQuestions(MY_DRAFT_SLUG, snapshot.questions);
    selectDraftSlot(snapshot.fromSlot);
  }

  const questionTexts = useMemo(() => questions.map((q) => q.text), [questions]);
  const { result, pending, refresh } = useAnalysis(markdown, questionTexts);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per draft switch; changeMarkdown only sets state
  useEffect(() => {
    keyRef.current = draftKey;
    const draft = draftTextFor(draftKey);
    changeMarkdown(draft, { replace: true });
    setQuestions(draftQuestionsFor(draftKey));
    setStatuses(withoutApplied(loadStatuses(draftKey)));
    setStale({});
    setApplied([]);
    setUndoStale(new Set());
    setActiveId(null);
    setOpenGroups(new Set());
    setMarkedGroup(null);
    setPreview(null);
    setWording({});
    setRowWording({});
    setEditorOpen(false);
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
    // A phone opens a draft with content on its questions, and an empty one on the editor.
    setPane(draft.trim() === '' ? 'draft' : 'questions');
    setJump(null);
    setFocusTarget(null);
    setLoadedKey(draftKey);
  }, [draftKey]);

  // A draft just loaded is analyzed at once, not after the typing debounce, so the rail never
  // shows the previous draft's analysis (an empty one reads "No questions yet").
  useEffect(() => {
    if (loadedKey !== null) refresh();
  }, [loadedKey, refresh]);

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

  // Anchors are trusted only from an analysis of the current text.
  const fresh = result?.markdown === markdown && loadedKey === draftKey;

  const suggestions = useMemo(() => (result?.checks ?? []).flatMap((c) => c.suggestions), [result]);
  const findings = useMemo(() => findingsOf(result), [result]);
  /** The open writing notes, ranked: the order the Quick edit and the groups read them in. */
  const notes = useMemo(() => {
    if (!result) return [];
    const isOpen = (s: Suggestion) => (statuses[s.id] ?? 'pending') === 'pending';
    const checks = result.checks.map((c) => ({ ...c, suggestions: c.suggestions.filter(isOpen) }));
    return rankNotes({ ...result, checks });
  }, [result, statuses]);

  const item = (note: RankedNote): FixItem => ({
    fix: note,
    copy: fixCopy(note.suggestion, findings[note.suggestion.id]),
    stale: note.suggestion.id in stale,
    canSuggest: localModel !== null && offersWordingHelper(note.suggestion),
    wording: wording[note.suggestion.id],
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

  // One group per note check with open or handled notes. A question line's applied wording and
  // an older build's statuses for the two question checks belong to no note.
  const groups: FixGroup[] = (() => {
    const byCheck = new Map<CheckId, FixGroup>(
      groupNotes(notes).map((g) => [
        g.checkId,
        { checkId: g.checkId, label: g.label, items: g.notes.map(item), handled: [] },
      ]),
    );
    for (const h of handled) {
      const id = h.suggestion.checkId;
      if (!NOTE_CHECKS.includes(id)) continue;
      let group = byCheck.get(id);
      if (!group) {
        group = { checkId: id, label: TEST_LABELS[id], items: [], handled: [] };
        byCheck.set(id, group);
      }
      group.handled.push(h);
    }
    return [...byCheck.values()].sort(byLabelThenCheck);
  })();

  /** The one ready edit Start here keeps while the draft has one: the Quick edit. */
  const quickNote = quickEdit(notes);
  const quick = quickNote ? item(quickNote) : null;

  // The draft's step card on the home and its summary: written after each fresh analysis of
  // real content, from the questions it measured (the draft's own, else the page's).
  const report = fresh && result && result.wordCount > 0 ? result.questions : null;
  // The home's draft step card links here (/draft/#start-here); the card appears after the analysis.
  useScrollToHash(START_HERE_ID, report !== null);

  // Only the selected fix (the editor's active highlight, underlined and filled), or else the
  // ranges of the group opened last (the editor's selectedRanges, underlined), are marked;
  // nothing on load.
  const nextMarks = useMemo<{ highlights: EditorHighlight[]; selected: Range[] }>(() => {
    const active = notes.find((f) => f.suggestion.id === activeId);
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
      selected: notes.filter((f) => f.checkId === markedGroup).map((f) => f.suggestion.range),
    };
  }, [notes, activeId, markedGroup, openGroups]);
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

  const covered = report?.covered ?? null;
  const measured = report?.rows.length ?? null;
  const fromPage = report?.from === 'page';
  const summaryKey = useRef('');
  useEffect(() => {
    if (covered === null || measured === null) return;
    const s = slotFor(draftKey);
    const keyNow = JSON.stringify([s, covered, measured, fromPage]);
    if (summaryKey.current === keyNow) return;
    summaryKey.current = keyNow;
    setSummary('draft', {
      slot: s,
      covered,
      total: measured,
      fromPage,
      example: s !== MY_POST_SLOT,
      at: new Date().toISOString(),
    });
  }, [covered, measured, fromPage, draftKey]);

  /**
   * Where a range of the last analysis sits in the current text. That analysis can trail the
   * editor by the debounce; a change that touches the range gives null.
   */
  function currentRange(range: Range): Range | null {
    return moveRange(range, result?.markdown ?? markdown, markdown);
  }

  /**
   * The opened edit on the current text: its range moved from the text it was measured on, which
   * the latest analysis need not have read (the author may type while the local AI works). When
   * a change since touches it, it has nothing left to apply, so the preview says Out of date.
   * Kept stable between renders, as the preview rebuilds its comparison when it changes.
   */
  const previewNow = useMemo(() => {
    if (!preview) return null;
    const range = moveRange(preview.suggestion.range, preview.on, markdown);
    return range ? { ...preview.suggestion, range } : { ...preview.suggestion, after: undefined };
  }, [preview, markdown]);

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

  /** Apply in the preview: `s` is the opened edit on the current text (`previewNow`). */
  function apply(s: Suggestion) {
    const outcome = applySuggestion(markdown, s);
    if (!outcome.ok) {
      setStale((prev) => ({ ...prev, [s.id]: s }));
      setPreview(null);
      refresh();
      return;
    }
    changeMarkdown(outcome.markdown);
    setApplied((prev) => [...prev.filter((a) => a.id !== s.id), s]);
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
    jumpTo(currentRange(s.range) ?? s.range, { id: s.id });
  }

  /** A card line's Show: selects its passage, with no note active. */
  function showLine(range: Range, question: string) {
    setActiveId(null);
    jumpTo(currentRange(range) ?? range, { id: null, question });
  }

  /** Selects a passage in the draft; on a phone, switches to the draft and shows the bar. */
  function jumpTo(range: Range, from: Jump) {
    setPane('draft');
    // A desktop shows the rail beside the draft, so it needs no bar (and no raised toast).
    setJump(isDesktop() ? null : from);
    setFocusTarget({ range });
  }

  /** The Draft / Questions switch: the chosen column, from its top. */
  function showPane(next: Pane) {
    setPane(next);
    setJump(null);
    requestAnimationFrame(() => document.scrollingElement?.scrollTo?.({ top: 0 }));
  }

  /**
   * Back to the rail, at the card the author jumped from, with focus on its main button; the
   * switch's Questions button when there is no such card (a card line, or a note since handled).
   */
  function backToRail() {
    const id = jump?.id ?? null;
    setPane('questions');
    setJump(null);
    requestAnimationFrame(() => {
      const from = [...document.querySelectorAll<HTMLElement>('[data-fix]')].find(
        (el) => el.dataset.fix === id,
      );
      if (from?.scrollIntoView) from.scrollIntoView({ block: 'center' });
      else document.scrollingElement?.scrollTo?.({ top: 0 });
      const main = from?.querySelector<HTMLElement>('button');
      if (main) main.focus({ preventScroll: true });
      else questionsButtonRef.current?.focus({ preventScroll: true });
    });
  }

  /** The bar's Done: the bar and its button go, so focus moves to the switch's Questions button. */
  function doneFromBar(s: Suggestion) {
    setJump(null);
    actions.onDone(s);
    requestAnimationFrame(() => questionsButtonRef.current?.focus({ preventScroll: true }));
  }

  /** The bar's Preview; on close, focus goes to the switch's Questions button, as the bar is gone. */
  function previewFromBarOf(s: Suggestion) {
    previewFromBar.current = true;
    setJump(null);
    actions.onPreview(s);
  }

  /** Opens `s`, a suggestion of the current analysis, in the preview. */
  function openPreview(s: Suggestion) {
    if (result) setPreview({ suggestion: s, on: result.markdown });
  }

  /**
   * Asks the local model (only on this click) for wording that addresses the advisory `s`, then
   * opens the proposal (after `finish`) side by side. `setState` follows the request on the card
   * that asked. Nothing is applied here. The proposal keeps the text `s` was measured on, so text
   * typed while the model works moves it, or makes it out of date, rather than misplace it.
   */
  async function askLocalModel(
    s: Suggestion,
    setState: (state: WordingState | null) => void,
    finish: (proposal: Suggestion) => Suggestion = (p) => p,
  ) {
    if (localModel === null || !result) return;
    const forKey = draftKey;
    const model = localModel;
    const on = result.markdown;
    const section = sectionAround(on, s.range);
    setState({ status: 'asking' });
    try {
      const proposal = await proposeWording(
        s,
        on.slice(section.start, section.end),
        new OllamaAdapter(),
        model,
      );
      if (keyRef.current !== forKey) return;
      setState(null);
      setPreview({
        suggestion: finish(proposal),
        on,
        note: `Written by ${model} on this computer. Check that it keeps your facts.`,
      });
    } catch (err) {
      if (keyRef.current !== forKey) return;
      setState({ status: 'error', message: wordingError(err, model) });
    }
  }

  function suggestWording(s: Suggestion) {
    setActiveId(s.id);
    void askLocalModel(s, (state) => setWording((prev) => withState(prev, s.id, state)));
  }

  /**
   * The advisory Suggest wording rewrites for a card row: the row's question-coverage advisory,
   * moved onto the passage a direct answer goes in (the matching section's first sentence, or an
   * empty spot after its heading, where the helper writes a new passage from the section's own
   * facts). It keeps an id of its own, so applying it never marks the advisory itself. Undefined
   * when the row is answered or the analysis holds no advisory for it.
   */
  function answerAdvisory(row: QuestionRow): Suggestion | undefined {
    if (!result || row.answer.covered) return undefined;
    const advisory = suggestionFor(result, 'question-coverage', row.question);
    if (!advisory) return undefined;
    const range = { ...row.answerRange };
    return {
      ...advisory,
      id: `${advisory.id}-answer`,
      range,
      before: result.markdown.slice(range.start, range.end),
    };
  }

  /**
   * Suggest wording on a card row. An empty spot gets the answer as a paragraph of its own, set
   * apart in the text the spot was measured on; moveRange holds the preview and Apply to that.
   */
  function suggestAnswer(row: QuestionRow) {
    const s = answerAdvisory(row);
    if (!s || !result) return;
    const analyzed = result.markdown;
    setActiveId(null);
    void askLocalModel(
      s,
      (state) => setRowWording((prev) => withState(prev, row.question, state)),
      (p) =>
        s.before === '' ? { ...p, after: paragraphAt(analyzed, s.range.start, p.after ?? '') } : p,
    );
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

  /** Reset to example (or Clear, for My post): the starting text and no statuses. */
  function resetDraft() {
    const snapshot: ResetSnapshot = { markdown, statuses, applied, undoStale };
    clearDraft(draftKey);
    changeMarkdown(startingText(draftKey), { replace: true });
    setStatuses({});
    setStale({});
    setApplied([]);
    setUndoStale(new Set());
    setActiveId(null);
    if (snapshot.markdown !== startingText(draftKey) || Object.keys(statuses).length > 0) {
      showToast(sample ? 'Reset.' : 'Cleared.', { kind: 'reset', snapshot });
    }
  }

  function undoReset(snapshot: ResetSnapshot) {
    changeMarkdown(snapshot.markdown, { replace: true });
    setStatuses(snapshot.statuses);
    setApplied(snapshot.applied);
    setUndoStale(snapshot.undoStale);
  }

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
  const outdated = Object.values(stale).filter((s) => !notes.some((f) => f.suggestion.id === s.id));
  /** A phone shows one column at a time once there are questions and notes to switch to. */
  const split = !empty && result !== null;
  /** Questions the card does not count as covered yet: the switch's badge. */
  const notCovered = result ? result.questions.rows.length - result.questions.covered : 0;
  const jumped = jump?.id == null ? undefined : notes.find((f) => f.suggestion.id === jump.id);
  /** The bar shows a note's title, so it shows only while that note is still in the list. */
  const showBar = jump !== null && (jump.id === null || jumped !== undefined);
  // The jumped note left the list (fixed by an edit, say): the bar closes rather than show no title.
  // The bar's own actions move focus themselves; an edit leaves focus in the editor.
  const jumpGone = fresh && jump?.id != null && jumped === undefined;
  useEffect(() => {
    if (jumpGone) setJump(null);
  }, [jumpGone]);

  // Each card row's question is looked up on the list by its key, never by its place: the
  // analysis may trail an edit to the list. A row whose question is not on the list (the page's
  // own, or one just removed) reads as the page's, the input our tests did not use.
  const listed = new Map<string, WorkspaceQuestion>();
  for (const q of questions) {
    const key = questionKey(q.text);
    if (!listed.has(key)) listed.set(key, q);
  }
  const rows = result?.questions.rows ?? [];
  const rowChips = rows.map((row) => {
    const q =
      result?.questions.from === 'yours' ? listed.get(questionKey(row.question)) : undefined;
    const input: QuestionInput = q ? inputKindOf(q) : 'page';
    const pair = q ? labelsFor(q) : QUESTION_LABELS.page;
    // A row with no key words to look for has no words line, so only its answer's label shows.
    return {
      input,
      labels: row.words === null ? { words: pair.answer, answer: pair.answer } : pair,
    };
  });
  const canSuggestAnswer = localModel !== null && rows.some((r) => answerAdvisory(r) !== undefined);

  return (
    <main
      className={cn('mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6', showBar && 'max-lg:pb-24')}
    >
      {split && (
        <div className="sticky top-14 z-30 -mx-4 -mt-2 mb-4 bg-background/90 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:hidden">
          <fieldset className="grid min-w-0 grid-cols-2 gap-1 rounded-lg border bg-sunken p-1">
            <legend className="sr-only">Draft or questions</legend>
            <PaneButton pressed={pane === 'draft'} onClick={() => showPane('draft')}>
              <PenLine aria-hidden="true" strokeWidth={1.75} />
              Draft
            </PaneButton>
            <PaneButton
              ref={questionsButtonRef}
              pressed={pane === 'questions'}
              onClick={() => showPane('questions')}
            >
              <ListChecks aria-hidden="true" strokeWidth={1.75} />
              Questions
              {notCovered > 0 && (
                <>
                  <span
                    aria-hidden="true"
                    className="rounded-full bg-brand-soft px-1.5 font-semibold text-brand text-xs tabular-nums"
                  >
                    {notCovered}
                  </span>
                  <span className="sr-only">{`, ${notCovered} not covered`}</span>
                </>
              )}
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
              split && pane === 'questions' && 'max-lg:hidden',
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
          aria-label="Questions and notes"
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
                Paste or type your post. Your questions and notes show up here.
              </p>
              {questions.length > 0 && (
                <p className="mt-1 text-ink-soft text-sm">{waiting(questions.length)}</p>
              )}
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
              <section
                id={START_HERE_ID}
                aria-labelledby="start-here-title"
                className="scroll-mt-24 space-y-2"
              >
                <h2
                  id="start-here-title"
                  className="px-0.5 font-semibold text-ink-soft text-xs uppercase tracking-wider"
                >
                  Start here
                </h2>
                <QuestionsCard
                  report={result.questions}
                  rowLabels={rowChips.map((c) => c.labels)}
                  renderChip={(label, scope, row) => (
                    <LabelChip
                      label={label}
                      tooltip={labelTooltip(label, {
                        card: scope === 'card',
                        input: rowChips[row]?.input,
                      })}
                    />
                  )}
                  pending={pending}
                  editorOpen={editorOpen}
                  onToggleEditor={() => setEditorOpen((open) => !open)}
                  editor={
                    <ReaderQuestions
                      key={draftKey}
                      questions={questions}
                      onChange={setQuestions}
                      markdown={markdown}
                      localModel={localModel}
                    />
                  }
                  onShowRange={showLine}
                  canSuggest={canSuggestAnswer}
                  wording={rowWording}
                  onSuggestWording={suggestAnswer}
                />
                {quick && (
                  <QuickEdit
                    suggestion={quick.fix.suggestion}
                    copy={quick.copy}
                    editable={quick.fix.editable}
                    active={quick.fix.suggestion.id === activeId}
                    stale={quick.stale}
                    canSuggest={quick.canSuggest}
                    wording={quick.wording}
                    chip={<NoteChip checkId={quick.fix.checkId} label={quick.fix.label} />}
                    {...actions}
                  />
                )}
              </section>
              <RailSection
                title="Writing notes"
                icon={NotebookText}
                meta={String(notes.length)}
                open={sections.notes}
                onOpenChange={(open) => setSections((s) => ({ ...s, notes: open }))}
              >
                <p className="text-ink-soft">Each note carries a label from our tests.</p>
                <FixGroups
                  groups={groups}
                  open={openGroups}
                  onToggle={toggleGroup}
                  activeId={activeId}
                  onUndo={undoHandled}
                  {...actions}
                />
              </RailSection>
              <p className="flex flex-wrap items-center gap-x-1.5 px-0.5 text-sm">
                Did it change anything?
                <Link
                  href={`${VIEW_HREF.cited}#test`}
                  prefetch={false}
                  className="inline-flex items-center gap-1 rounded-sm font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  Test it
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </p>
              <LocalAiRow connection={connection} />
            </>
          )}
        </aside>
      </div>

      <MergePreview
        markdown={markdown}
        suggestion={previewNow}
        title={
          preview ? fixCopy(preview.suggestion, findings[preview.suggestion.id]).title : undefined
        }
        note={preview?.note}
        onApply={apply}
        onClose={() => setPreview(null)}
        returnFocus={() => {
          const fromBar = previewFromBar.current;
          previewFromBar.current = false;
          return fromBar ? questionsButtonRef.current : null;
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
            {jumped
              ? fixCopy(jumped.suggestion, findings[jumped.suggestion.id]).title
              : jump?.question}
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Back to questions and notes"
            onClick={backToRail}
          >
            Back
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

/** One side of the phone's Draft / Questions switch. */
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

/**
 * The local AI row: Connect local AI (only on this click, and only to the AI on this computer),
 * then the model it found, or what to do when it is not running or lacks the model. One
 * connection unlocks Suggest wording and the question editor's local AI.
 */
function LocalAiRow({ connection: { status, model } }: { connection: LocalModel }) {
  const again = status === 'unreachable' || status === 'model-missing';
  return (
    <section aria-label="Local AI" className="space-y-2 px-0.5 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-soft">
        <span>Local AI (optional)</span>
        {status === 'ready' ? (
          <span className="text-foreground">Connected to {model}.</span>
        ) : (
          <Button
            type="button"
            size="xs"
            variant="outline"
            title={CONNECT_NOTE}
            disabled={status === 'checking'}
            onClick={() => void connectLocalModel()}
          >
            {again ? <RefreshCw aria-hidden="true" /> : <Laptop aria-hidden="true" />}
            {status === 'checking' ? 'Connecting...' : again ? 'Try again' : 'Connect local AI'}
          </Button>
        )}
      </p>
      {status === 'unreachable' && (
        <div role="status" className="space-y-2">
          <UnreachableNote />
          <OllamaInstructions model={model} />
        </div>
      )}
      {status === 'model-missing' && (
        <div role="status">
          <ModelMissingNote model={model} />
        </div>
      )}
    </section>
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
