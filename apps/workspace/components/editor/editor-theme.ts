import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * Paper for every view of the draft (the editor and the Apply preview): Newsreader on the
 * paper token. Colours come from the app's semantic tokens, so light and dark follow along.
 */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--paper)',
    color: 'var(--foreground)',
  },
  '&.cm-focused': { outline: '2px solid var(--ring)', outlineOffset: '-2px' },
  '.cm-scroller': {
    fontFamily: 'var(--font-newsreader), ui-serif, Georgia, serif',
    lineHeight: '1.7',
  },
  '.cm-content': { caretColor: 'var(--foreground)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'var(--mark-fill)' },
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    color: 'var(--foreground)',
    fontFamily: 'var(--font-instrument), ui-sans-serif, system-ui, sans-serif',
    fontSize: '0.875rem',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-textfield': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--surface)',
    color: 'var(--foreground)',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--mark-fill)' },
  '.cm-searchMatch.cm-searchMatch-selected': { outline: '2px solid var(--mark)' },
});

/**
 * The draft editor as a sheet: 18px type and a 68ch measure, centred.
 * Smaller side padding on phones keeps the measure inside 390px.
 */
export const paperLayout = EditorView.theme({
  '&': { fontSize: '1.125rem' },
  '.cm-content': {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 'calc(68ch + 3rem)',
    marginInline: 'auto',
    padding: '2rem 1.5rem 4rem',
  },
  '.cm-line': { padding: '0' },
  '@media (max-width: 639px)': { '.cm-content': { padding: '1.25rem 1rem 3rem' } },
});

/** Markers (`#`, `-`, `**`, `>`, link brackets) recede; headings read as headings. */
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.75em', fontWeight: '500', lineHeight: '1.25' },
  { tag: tags.heading2, fontSize: '1.4em', fontWeight: '500', lineHeight: '1.3' },
  { tag: tags.heading3, fontSize: '1.2em', fontWeight: '600' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '600' },
  { tag: tags.processingInstruction, color: 'var(--ink-faint)', fontWeight: '400' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--brand)' },
  { tag: tags.url, color: 'var(--ink-soft)' },
  { tag: tags.quote, color: 'var(--ink-soft)', fontStyle: 'italic' },
  {
    tag: tags.monospace,
    fontFamily: 'var(--font-jetbrains), ui-monospace, Menlo, Consolas, monospace',
    fontSize: '0.85em',
  },
  { tag: [tags.contentSeparator, tags.meta, tags.comment], color: 'var(--ink-faint)' },
]);

export const markdownHighlighting = syntaxHighlighting(markdownStyle);
