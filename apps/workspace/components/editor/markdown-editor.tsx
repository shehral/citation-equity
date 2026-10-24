'use client';

import type { CheckId, Range } from '@citation-equity/engine';
import { markdown } from '@codemirror/lang-markdown';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import {
  Annotation,
  type Range as CmRange,
  EditorSelection,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, type DecorationSet, dropCursor, EditorView, keymap } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { markdownFromClipboard } from '@/lib/paste';
import { editorTheme, markdownHighlighting, paperLayout } from './editor-theme';

export interface MarkdownEditorHandle {
  focusRange(r: Range): void;
}

/** A fix's passage. Only the selected (`active`) one is marked; the others stay unmarked. */
export interface EditorHighlight {
  range: Range;
  checkId: CheckId;
  active: boolean;
}

interface MarkdownEditorProps {
  value: string;
  /**
   * Bump it when `value` replaces the document wholesale (another draft, a
   * reset): the editor then starts a fresh state, so its undo history cannot
   * bring back the previous document. Other `value` changes (Apply, Undo) are
   * ordinary, undoable transactions.
   */
  docVersion?: number;
  onChange(v: string): void;
  highlights: EditorHighlight[];
  /**
   * Passages to underline besides the selected fix, e.g. every range of the selected group.
   * Compared by value, so a new array with the same ranges keeps marks mapped through edits.
   */
  selectedRanges?: Range[];
  ariaLabel: string;
}

/** Marks changes that come from the `value` prop, so they are not echoed to onChange. */
const fromProps = Annotation.define<boolean>();
const setHighlights = StateEffect.define<DecorationSet>();

/** Suggestion anchors. They follow edits until the next analysis replaces them. */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setHighlights)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const NO_RANGES: Range[] = [];

/**
 * Marks for the selected fix (dotted underline and fill) and the selected ranges (dotted
 * underline). Nothing is marked while nothing is selected, so the draft never looks flagged.
 */
function buildDecorations(
  highlights: EditorHighlight[],
  selectedRanges: Range[],
  docLength: number,
): DecorationSet {
  const marks: CmRange<Decoration>[] = [];
  const valid = ({ start, end }: Range) => start >= 0 && end <= docLength && start < end;
  const active = highlights.filter((h) => h.active && valid(h.range));
  for (const h of active)
    marks.push(
      Decoration.mark({
        class: 'cm-ce-highlight cm-ce-highlight-active',
        attributes: { 'data-check': h.checkId },
      }).range(h.range.start, h.range.end),
    );
  const seen = new Set(active.map((h) => `${h.range.start}:${h.range.end}`));
  for (const r of selectedRanges) {
    const key = `${r.start}:${r.end}`;
    if (!valid(r) || seen.has(key)) continue;
    seen.add(key);
    marks.push(Decoration.mark({ class: 'cm-ce-highlight' }).range(r.start, r.end));
  }
  return Decoration.set(marks, true);
}

/** Rich text on the clipboard (text/html) goes in as Markdown; anything else pastes as usual. */
const richPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const html = event.clipboardData?.getData('text/html');
    if (!html) return false;
    const markdown = markdownFromClipboard(html);
    if (markdown === null) return false;
    event.preventDefault();
    view.dispatch({
      ...view.state.replaceSelection(markdown),
      scrollIntoView: true,
      userEvent: 'input.paste',
    });
    return true;
  },
});

/** The smallest replacement that turns `from` into `to`, so undo history and scroll survive. */
function minimalChange(from: string, to: string) {
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let endFrom = from.length;
  let endTo = to.length;
  while (
    endFrom > start &&
    endTo > start &&
    from.charCodeAt(endFrom - 1) === to.charCodeAt(endTo - 1)
  ) {
    endFrom--;
    endTo--;
  }
  return { from: start, to: endFrom, insert: to.slice(start, endTo) };
}

/**
 * CodeMirror 6 over the Markdown source, so engine offsets are editor positions, styled as a
 * sheet of paper. Only the selected fix and `selectedRanges` are underlined; `focusRange`
 * selects a passage and scrolls it into view. Rich-text pastes arrive as Markdown.
 */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    { value, docVersion = 0, onChange, highlights, selectedRanges = NO_RANGES, ariaLabel },
    ref,
  ) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const highlightsRef = useRef(highlights);
    highlightsRef.current = highlights;
    const selectedKey = selectedRanges.map((r) => `${r.start}:${r.end}`).join(',');
    // biome-ignore lint/correctness/useExhaustiveDependencies: compared by value through selectedKey
    const selected = useMemo(() => selectedRanges, [selectedKey]);
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    const initial = useRef({ value, ariaLabel, docVersion });
    const shownVersion = useRef(docVersion);
    const extensions = useRef<Extension[]>([]);

    useEffect(() => {
      if (!host.current) return;
      extensions.current = [
        minimalSetup,
        dropCursor(),
        search(),
        highlightSelectionMatches(),
        keymap.of(searchKeymap),
        markdown(),
        markdownHighlighting,
        EditorView.lineWrapping,
        editorTheme,
        paperLayout,
        richPaste,
        highlightField,
        EditorView.contentAttributes.of({ 'aria-label': initial.current.ariaLabel }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.transactions.every((tr) => tr.annotation(fromProps))) return;
          onChangeRef.current(update.state.doc.toString());
        }),
      ];
      const editor = new EditorView({
        parent: host.current,
        state: EditorState.create({ doc: initial.current.value, extensions: extensions.current }),
      });
      view.current = editor;
      return () => {
        editor.destroy();
        view.current = null;
      };
    }, []);

    useEffect(() => {
      const editor = view.current;
      if (!editor) return;
      if (shownVersion.current !== docVersion) {
        // A wholesale replacement: a fresh state, so undo history starts empty.
        shownVersion.current = docVersion;
        editor.setState(EditorState.create({ doc: value, extensions: extensions.current }));
        editor.dispatch({
          effects: setHighlights.of(
            buildDecorations(highlightsRef.current, selectedRef.current, value.length),
          ),
        });
        return;
      }
      const current = editor.state.doc.toString();
      if (current === value) return;
      editor.dispatch({ changes: minimalChange(current, value), annotations: fromProps.of(true) });
    }, [value, docVersion]);

    useEffect(() => {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch({
        effects: setHighlights.of(buildDecorations(highlights, selected, editor.state.doc.length)),
      });
    }, [highlights, selected]);

    useImperativeHandle(
      ref,
      () => ({
        focusRange(r: Range) {
          const editor = view.current;
          if (!editor) return;
          const length = editor.state.doc.length;
          const start = Math.min(Math.max(0, r.start), length);
          const end = Math.min(Math.max(start, r.end), length);
          editor.dispatch({
            selection: EditorSelection.range(start, end),
            effects: EditorView.scrollIntoView(start, { y: 'center' }),
          });
          editor.focus();
        },
      }),
      [],
    );

    return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
  },
);
