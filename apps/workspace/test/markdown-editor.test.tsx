import { EditorView } from '@codemirror/view';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '@/components/editor/markdown-editor';

afterEach(cleanup);

/** The real CodeMirror view inside the rendered editor. */
function viewOf(container: HTMLElement): EditorView {
  const dom = container.querySelector('.cm-editor');
  const view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null;
  if (!view) throw new Error('no editor view');
  return view;
}

/** Presses Ctrl-Z (jsdom is not a Mac) in the editor, which runs CodeMirror's undo. */
function pressUndo(view: EditorView) {
  act(() => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        keyCode: 90,
        ctrlKey: true,
        bubbles: true,
      }),
    );
  });
}

const props = { highlights: [], ariaLabel: 'Draft in Markdown' };

describe('MarkdownEditor undo history', () => {
  it('keeps an Apply-style value change undoable', () => {
    const onChange = vi.fn();
    const view = render(
      <MarkdownEditor value="## Why it is bitter" onChange={onChange} {...props} />,
    );
    view.rerender(<MarkdownEditor value="## Why is it bitter?" onChange={onChange} {...props} />);
    const cm = viewOf(view.container);
    expect(cm.state.doc.toString()).toBe('## Why is it bitter?');
    pressUndo(cm);
    expect(cm.state.doc.toString()).toBe('## Why it is bitter');
    expect(onChange).toHaveBeenLastCalledWith('## Why it is bitter');
  });

  it('starts a fresh history when docVersion changes, so undo cannot bring back another draft', () => {
    const onChange = vi.fn();
    const view = render(
      <MarkdownEditor value="Espresso draft." docVersion={0} onChange={onChange} {...props} />,
    );
    view.rerender(
      <MarkdownEditor
        value="Espresso draft, edited."
        docVersion={0}
        onChange={onChange}
        {...props}
      />,
    );
    view.rerender(
      <MarkdownEditor value="RAG draft." docVersion={1} onChange={onChange} {...props} />,
    );
    const cm = viewOf(view.container);
    expect(cm.state.doc.toString()).toBe('RAG draft.');
    pressUndo(cm);
    expect(cm.state.doc.toString()).toBe('RAG draft.');
    expect(onChange).not.toHaveBeenCalled();
  });
});
