'use client';

import type { CheckId, Range } from '@citation-equity/engine';
import { markdown } from '@codemirror/lang-markdown';
import {
  Annotation,
  type Range as CmRange,
  EditorSelection,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { editorTheme } from './editor-theme';

export interface MarkdownEditorHandle {
  focusRange(r: Range): void;
}

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

function buildDecorations(highlights: EditorHighlight[], docLength: number): DecorationSet {
  const marks: CmRange<Decoration>[] = [];
  for (const h of highlights) {
    const { start, end } = h.range;
    if (start < 0 || end > docLength || start >= end) continue;
    marks.push(
      Decoration.mark({
        class: h.active ? 'cm-ce-highlight cm-ce-highlight-active' : 'cm-ce-highlight',
        attributes: { 'data-check': h.checkId },
      }).range(start, end),
    );
  }
  return Decoration.set(marks, true);
}

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
 * CodeMirror 6 over the Markdown source, so engine offsets are editor
 * positions. Suggestion ranges are underlined; `focusRange` selects one and
 * scrolls it into view.
 */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ value, docVersion = 0, onChange, highlights, ariaLabel }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const highlightsRef = useRef(highlights);
    highlightsRef.current = highlights;
    const initial = useRef({ value, ariaLabel, docVersion });
    const shownVersion = useRef(docVersion);
    const extensions = useRef<Extension[]>([]);

    useEffect(() => {
      if (!host.current) return;
      extensions.current = [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        editorTheme,
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
          effects: setHighlights.of(buildDecorations(highlightsRef.current, value.length)),
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
        effects: setHighlights.of(buildDecorations(highlights, editor.state.doc.length)),
      });
    }, [highlights]);

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
