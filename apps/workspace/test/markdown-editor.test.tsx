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

/** Fires a paste event carrying the given clipboard types at the editor. */
function paste(view: EditorView, data: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => data[type] ?? '', types: Object.keys(data) },
  });
  act(() => {
    view.contentDOM.dispatchEvent(event);
  });
}

const DOC = '## Why it is bitter\n\nEspresso tastes bitter when it runs long.';
const heading = { start: 0, end: 19 };
const sentence = { start: 21, end: 62 };

describe('MarkdownEditor decorations', () => {
  it('shows no marks on load, however many fixes are open', () => {
    const view = render(
      <MarkdownEditor
        value={DOC}
        onChange={vi.fn()}
        ariaLabel="Draft in Markdown"
        highlights={[
          { range: heading, checkId: 'question-headings', active: false },
          { range: sentence, checkId: 'direct-answer-lead', active: false },
        ]}
      />,
    );
    expect(view.container.querySelectorAll('.cm-ce-highlight')).toHaveLength(0);
  });

  it('underlines only the selected fix, and fills it', () => {
    const view = render(
      <MarkdownEditor
        value={DOC}
        onChange={vi.fn()}
        ariaLabel="Draft in Markdown"
        highlights={[
          { range: heading, checkId: 'question-headings', active: true },
          { range: sentence, checkId: 'direct-answer-lead', active: false },
        ]}
      />,
    );
    const marks = view.container.querySelectorAll('.cm-ce-highlight');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('## Why it is bitter');
    expect(marks[0].classList.contains('cm-ce-highlight-active')).toBe(true);
    expect(marks[0].getAttribute('data-check')).toBe('question-headings');
  });

  it("underlines a selected group's ranges without filling them", () => {
    const props = { value: DOC, onChange: vi.fn(), ariaLabel: 'Draft in Markdown', highlights: [] };
    const view = render(<MarkdownEditor {...props} />);
    expect(view.container.querySelectorAll('.cm-ce-highlight')).toHaveLength(0);
    view.rerender(<MarkdownEditor {...props} selectedRanges={[heading, sentence]} />);
    const marks = [...view.container.querySelectorAll('.cm-ce-highlight')];
    expect(marks.map((m) => m.textContent)).toEqual([
      '## Why it is bitter',
      'Espresso tastes bitter when it runs long.',
    ]);
    expect(marks.some((m) => m.classList.contains('cm-ce-highlight-active'))).toBe(false);
    view.rerender(<MarkdownEditor {...props} selectedRanges={[]} />);
    expect(view.container.querySelectorAll('.cm-ce-highlight')).toHaveLength(0);
  });

  it('keeps group marks on the passage while the author types before it', () => {
    const onChange = vi.fn();
    const props = { value: DOC, onChange, ariaLabel: 'Draft in Markdown', highlights: [] };
    const view = render(<MarkdownEditor {...props} selectedRanges={[{ ...sentence }]} />);
    const cm = viewOf(view.container);
    act(() => {
      cm.dispatch({ changes: { from: 0, insert: 'Intro. ' } });
    });
    // A re-render with an equal (new) array must not reset the mapped mark.
    view.rerender(<MarkdownEditor {...props} selectedRanges={[{ ...sentence }]} />);
    const marks = view.container.querySelectorAll('.cm-ce-highlight');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('Espresso tastes bitter when it runs long.');
  });

  it('draws no line numbers', () => {
    const view = render(<MarkdownEditor value={DOC} onChange={vi.fn()} {...props} />);
    expect(view.container.querySelector('.cm-lineNumbers')).toBeNull();
    expect(view.container.querySelector('.cm-gutters')).toBeNull();
  });
});

describe('MarkdownEditor paste', () => {
  it('converts rich text on the clipboard to Markdown', () => {
    const onChange = vi.fn();
    const view = render(<MarkdownEditor value="" onChange={onChange} {...props} />);
    const cm = viewOf(view.container);
    paste(cm, {
      'text/html': '<h2>Grind</h2><script>alert(1)</script><ul><li>Finer</li><li>Even</li></ul>',
      'text/plain': 'Grind\nFiner\nEven',
    });
    expect(cm.state.doc.toString()).toBe('## Grind\n\n* Finer\n* Even');
    expect(onChange).toHaveBeenLastCalledWith('## Grind\n\n* Finer\n* Even');
  });

  it('pastes plain text as is', () => {
    const view = render(<MarkdownEditor value="" onChange={vi.fn()} {...props} />);
    const cm = viewOf(view.container);
    paste(cm, { 'text/plain': '## Already Markdown\n\n- kept' });
    expect(cm.state.doc.toString()).toBe('## Already Markdown\n\n- kept');
  });

  it('pastes the plain text when the HTML only styles it (a code editor copy)', () => {
    const view = render(<MarkdownEditor value="" onChange={vi.fn()} {...props} />);
    const cm = viewOf(view.container);
    paste(cm, {
      'text/html': '<div><span style="color: blue">## Heading</span></div>',
      'text/plain': '## Heading',
    });
    expect(cm.state.doc.toString()).toBe('## Heading');
  });
});
