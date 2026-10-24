import { AdapterUnavailableError } from '@citation-equity/bench';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderQuestions } from '@/components/draft/reader-questions';
import { suggestWithLocalModel } from '@/lib/question-helper';
import type { WorkspaceQuestion } from '@/lib/questions';

// The helper would call a local Ollama; the tests decide what it returns.
vi.mock('@/lib/question-helper', () => ({ suggestWithLocalModel: vi.fn() }));
const askMock = vi.mocked(suggestWithLocalModel);

const DRAFT =
  '# Cold brew at home\n\nCold brew is coffee steeped in cold water.\n\n## How to store it\n\nIn the fridge.\n';
const START: WorkspaceQuestion[] = [
  { text: 'Why is my cold brew sour?', source: 'sample-pack' },
  { text: 'How do you store it?', source: 'template' },
];

/** The panel with its list held in state, as the workspace holds it. */
function Harness({
  initial = START,
  localModel = null,
  onChange,
}: {
  initial?: WorkspaceQuestion[];
  localModel?: string | null;
  onChange?: (q: WorkspaceQuestion[]) => void;
}) {
  const [questions, setQuestions] = useState(initial);
  return (
    <ReaderQuestions
      questions={questions}
      markdown={DRAFT}
      localModel={localModel}
      onChange={(q) => {
        setQuestions(q);
        onChange?.(q);
      }}
    />
  );
}

const panel = () => within(document.body);
const inputs = () =>
  panel()
    .getAllByRole('textbox', { name: /^Question \d/ })
    .map((el) => (el as HTMLInputElement).value);

beforeEach(() => {
  askMock.mockReset();
});
afterEach(cleanup);

describe('Reader questions', () => {
  it('lists each question in its own labelled field, with a source label except for the sample', () => {
    render(<Harness />);
    expect(inputs()).toEqual(['Why is my cold brew sour?', 'How do you store it?']);
    const items = panel().getAllByRole('listitem');
    expect(items[0]?.textContent).not.toContain('Sample pack');
    expect(items[1]?.textContent).toContain('Template');
  });

  it('edits a question in place, which makes it yours', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(panel().getByRole('textbox', { name: 'Question 2' }), {
      target: { value: 'How long does cold brew keep?' },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      START[0],
      { text: 'How long does cold brew keep?', source: 'user' },
    ]);
    expect(panel().getAllByRole('listitem')[1]?.textContent).toContain('By you');
  });

  it('never lets an edit empty a question or repeat another, and restores it on leaving', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const second = panel().getByRole('textbox', { name: 'Question 2' }) as HTMLInputElement;
    fireEvent.change(second, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(second.value).toBe('');
    expect(panel().getByRole('status').textContent).toContain('cannot be empty');
    // The same question as the first, but for case and the "?".
    fireEvent.change(second, { target: { value: 'why is my cold brew sour' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(panel().getByRole('status').textContent).toContain('already on the list');
    fireEvent.blur(second);
    expect(second.value).toBe('How do you store it?');
    expect(panel().queryByRole('status')).toBeNull();
  });

  it('refuses to add a question that differs from one on the list only by its "?"', () => {
    render(<Harness />);
    const field = panel().getByRole('textbox', { name: 'New question' });
    fireEvent.change(field, { target: { value: 'Why is my cold brew sour' } });
    fireEvent.submit(field);
    expect(inputs()).toEqual(['Why is my cold brew sour?', 'How do you store it?']);
    expect(panel().getByRole('status').textContent).toContain('already on the list');
  });

  it('adds a question with Enter and removes one with its button', () => {
    render(<Harness />);
    const field = panel().getByRole('textbox', { name: 'New question' });
    fireEvent.change(field, { target: { value: 'Is cold brew stronger than coffee?' } });
    fireEvent.submit(field);
    expect(inputs()).toEqual([
      'Why is my cold brew sour?',
      'How do you store it?',
      'Is cold brew stronger than coffee?',
    ]);
    expect((field as HTMLInputElement).value).toBe('');
    fireEvent.click(panel().getByRole('button', { name: 'Remove question 1' }));
    expect(inputs()).toEqual(['How do you store it?', 'Is cold brew stronger than coffee?']);
  });

  it('does not add a question twice, and stops at 8', () => {
    render(<Harness />);
    const field = panel().getByRole('textbox', { name: 'New question' });
    fireEvent.change(field, { target: { value: 'why is my COLD brew sour?' } });
    fireEvent.submit(field);
    expect(inputs()).toHaveLength(2);
    expect(panel().getByRole('status').textContent).toMatch(/already on the list/);

    cleanup();
    const eight = Array.from({ length: 8 }, (_, i) => ({
      text: `Q${i}?`,
      source: 'user' as const,
    }));
    render(<Harness initial={eight} />);
    expect(panel().getByRole('textbox', { name: 'New question' })).toHaveProperty('disabled', true);
    expect(panel().getByText(/limit of 8/)).toBeTruthy();
  });

  it('suggests questions from the draft, adding only new ones', () => {
    render(<Harness />);
    fireEvent.click(panel().getByRole('button', { name: 'Suggest from my draft' }));
    expect(inputs()).toEqual([
      'Why is my cold brew sour?',
      'How do you store it?',
      'What is cold brew?',
      'How does cold brew work?',
    ]);
    expect(panel().getByRole('status').textContent).toContain('Added 2 questions');
  });

  it('offers local AI only after Connect local AI found it, and asks nothing before', () => {
    render(<Harness />);
    expect(panel().queryByRole('button', { name: /local model/ })).toBeNull();
    expect(panel().queryByText(/local model/i)).toBeNull();
    expect(askMock).not.toHaveBeenCalled();
  });

  it('adds the local model questions on click, labelled as such', async () => {
    askMock.mockResolvedValue([
      { text: 'Is cold brew stronger than coffee?', source: 'local-model' },
      { text: 'How do you store it?', source: 'local-model' },
    ]);
    render(<Harness localModel="llama3.2:3b" />);
    await act(async () => {
      fireEvent.click(panel().getByRole('button', { name: 'Suggest more with local AI' }));
    });
    expect(askMock).toHaveBeenCalledWith(DRAFT, 'llama3.2:3b');
    expect(inputs()).toEqual([
      'Why is my cold brew sour?',
      'How do you store it?',
      'Is cold brew stronger than coffee?',
    ]);
    expect(panel().getAllByRole('listitem')[2]?.textContent).toContain('Local model');
  });

  it('keeps edits made while the local model is answering', async () => {
    let answer: (q: WorkspaceQuestion[]) => void = () => {};
    askMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    render(<Harness localModel="llama3.2:3b" />);
    fireEvent.click(panel().getByRole('button', { name: 'Suggest more with local AI' }));
    expect(panel().getByRole('button', { name: 'Asking...' })).toHaveProperty('disabled', true);
    fireEvent.change(panel().getByRole('textbox', { name: 'Question 1' }), {
      target: { value: 'Why is cold brew sweet?' },
    });
    await act(async () => {
      answer([{ text: 'Is cold brew stronger than coffee?', source: 'local-model' }]);
    });
    expect(inputs()).toEqual([
      'Why is cold brew sweet?',
      'How do you store it?',
      'Is cold brew stronger than coffee?',
    ]);
  });

  it('says how to start Ollama when the local model does not answer', async () => {
    askMock.mockImplementation(async () => {
      throw new AdapterUnavailableError('Ollama is not reachable');
    });
    render(<Harness localModel="llama3.2:3b" />);
    await act(async () => {
      fireEvent.click(panel().getByRole('button', { name: 'Suggest more with local AI' }));
    });
    expect(panel().getByRole('status').textContent).toContain("Can't reach Ollama");
    expect(inputs()).toHaveLength(2);
  });
});
