import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CitedView } from '@/components/cited/cited-view';
import { clearPasted } from '@/lib/pasted';
import { clearAll } from '@/lib/store';
import { getTrancoList, loadTrancoText, setTrancoList } from '@/lib/tranco-list';
import { expectQuiet } from './quiet';

/** A full-depth list in which reddit.com is big and regionalnews.com is mid. */
function fullList(): string {
  const lines = ['1,google.com', '2,reddit.com'];
  for (let r = 3; r <= 20_000; r++) lines.push(`${r},filler${r}.com`);
  lines.push('20001,regionalnews.com');
  for (let r = 20_002; r <= 1_000_000; r++) lines.push(`${r},f${r}.net`);
  return lines.join('\n');
}
const LIST_TEXT = fullList();

const ANSWER_1 = `Bees cluster to stay warm [1][2][3].

1. https://www.reddit.com/r/Beekeeping/comments/abc/
2. https://en.wikipedia.org/wiki/Honey_bee
3. https://hivecraft-notes.example/winter`;
const ANSWER_2 = `Narrow the entrance [1][2].

1. https://hivecraft-notes.example/entrances
2. https://regionalnews.com/bees`;

beforeEach(() => {
  clearAll();
  clearPasted();
});
afterEach(() => {
  cleanup();
  setTrancoList(null);
});

const card = () => screen.getByRole('region', { name: 'Do small sites win these questions?' });

function pasteTwo() {
  fireEvent.change(screen.getByLabelText('The answer, with its links (question 1)'), {
    target: { value: ANSWER_1 },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
  fireEvent.change(screen.getByLabelText('The answer, with its links (question 2)'), {
    target: { value: ANSWER_2 },
  });
}

const csvFile = (text: string, name: string) => new File([text], name, { type: 'text/csv' });

describe('Do small sites win these questions?', () => {
  it('appears only once an answer is pasted', () => {
    render(<CitedView />);
    expect(
      screen.queryByRole('region', { name: 'Do small sites win these questions?' }),
    ).toBeNull();
    pasteTwo();
    expect(card()).toBeTruthy();
  });

  it('without a list, offers to load one and counts Wikipedia apart already', () => {
    render(<CitedView />);
    pasteTwo();
    const c = within(card());
    expect(c.getByLabelText('Load a Tranco list')).toBeTruthy();
    expect(c.getByRole('link', { name: 'Download its CSV' }).getAttribute('href')).toBe(
      'https://tranco-list.eu',
    );
    expect(card().textContent).toContain('Counted apart already: Wikipedia (1).');
  });

  it('with a list, splits the citations into big, mid and small', () => {
    render(<CitedView />);
    pasteTwo();
    act(() => setTrancoList(loadTrancoText(LIST_TEXT, 'tranco_TEST1.csv')));
    const text = card().textContent ?? '';
    // reddit (big) 1, regionalnews (mid) 1, hivecraft-notes (small) 2: one site, two answers.
    expect(text).toContain('Small sites got 2 of 4 citations.');
    const rows = within(card()).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Big sites1 site1 of 4',
      'Mid-size sites1 site1 of 4',
      'Small sites1 site2 of 4',
    ]);
    expect(text).toContain('Counted apart: Wikipedia (1).');
    expect(text).toContain('Sizes from Tranco list TEST1, top 1,000,000 sites.');
    expectQuiet('size mix', card());
  });

  it('loads a list from a file the author picks, and removes it again', async () => {
    render(<CitedView />);
    pasteTwo();
    fireEvent.change(within(card()).getByLabelText('Load a Tranco list'), {
      target: { files: [csvFile(LIST_TEXT, 'tranco_TEST1.csv')] },
    });
    await waitFor(() => expect(card().textContent).toContain('Small sites got 2 of 4'));
    expect(getTrancoList()?.list.id).toBe('TEST1');
    fireEvent.click(within(card()).getByRole('button', { name: 'Remove the list' }));
    expect(getTrancoList()).toBeNull();
    expect(within(card()).getByLabelText('Load a Tranco list')).toBeTruthy();
  });

  it('says what is wrong with a file that is not a list, and with the zip', async () => {
    render(<CitedView />);
    pasteTwo();
    const input = () => within(card()).getByLabelText('Load a Tranco list');
    fireEvent.change(input(), { target: { files: [csvFile('1,a.com\n3,b.com', 'x.csv')] } });
    await waitFor(() =>
      expect(within(card()).getByRole('alert').textContent).toMatch(/rank 3 where 2/),
    );
    fireEvent.change(input(), { target: { files: [csvFile('', 'tranco_TEST1-1m.csv.zip')] } });
    await waitFor(() =>
      expect(within(card()).getByRole('alert').textContent).toBe(
        'Unzip the download first, then load the .csv file inside.',
      ),
    );
    expect(getTrancoList()).toBeNull();
  });
});
