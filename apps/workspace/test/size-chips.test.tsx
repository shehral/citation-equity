import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CitedView } from '@/components/cited/cited-view';
import { SizeChip } from '@/components/cited/size-chip';
import { clearPasted } from '@/lib/pasted';
import { clearAll } from '@/lib/store';
import { loadTrancoText, setTrancoList } from '@/lib/tranco-list';

/** A stand-in for a full Tranco list: three ranked sites, a million deep. */
const LIST = (() => {
  const lines = ['1,google.com', '2,reddit.com'];
  for (let r = 3; r <= 20_000; r++) lines.push(`${r},filler${r}.com`);
  lines.push('20001,regionalnews.com');
  for (let r = 20_002; r <= 1_000_000; r++) lines.push(`${r},f${r}.net`);
  return loadTrancoText(lines.join('\n'), 'tranco_TEST1.csv');
})();

const ANSWER = `Bees cluster to stay warm [1][2][3][4].

1. https://www.reddit.com/r/Beekeeping/comments/abc/
2. https://en.wikipedia.org/wiki/Honey_bee
3. https://hivecraft-notes.example/winter
4. https://someone.wordpress.com/winter-hives
5. https://regionalnews.com/bees`;

beforeEach(() => {
  clearAll();
  clearPasted();
});
afterEach(() => {
  cleanup();
  setTrancoList(null);
});

const chipFor = (domain: string) =>
  screen.getByText(domain, { selector: 'span.font-mono' }).querySelector('[data-size-chip]');

function pasteAnswer() {
  fireEvent.change(screen.getByLabelText('The answer, with its links (question 1)'), {
    target: { value: ANSWER },
  });
}

describe('SizeChip', () => {
  it('shows nothing when the size is unknown', () => {
    const { container } = render(<SizeChip domain="example.com" list={null} />);
    expect(container.textContent).toBe('');
  });

  it('names the size, with the rank only in the tooltip', () => {
    render(<SizeChip domain="www.reddit.com" list={LIST.list} />);
    const chip = screen.getByText('Big site');
    expect(chip.getAttribute('title')).toBe('Rank 2 on the Tranco list.');
    expect(chip.textContent).not.toMatch(/\d/);
  });
});

describe('Who gets cited: size chips', () => {
  it('marks Wikipedia and hosting platforms before any list is loaded', () => {
    render(<CitedView />);
    pasteAnswer();
    expect(chipFor('wikipedia.org')?.textContent).toBe('Wikipedia');
    expect(chipFor('someone.wordpress.com')?.textContent).toBe('Hosting platform');
    expect(chipFor('reddit.com')).toBeNull();
    expect(chipFor('hivecraft-notes.example')).toBeNull();
  });

  it('marks big, mid and small sites once a list is loaded', () => {
    render(<CitedView />);
    pasteAnswer();
    act(() => setTrancoList(LIST));
    expect(chipFor('reddit.com')?.textContent).toBe('Big site');
    expect(chipFor('regionalnews.com')?.textContent).toBe('Mid-size site');
    expect(chipFor('hivecraft-notes.example')?.textContent).toBe('Small site');
    expect(chipFor('hivecraft-notes.example')?.getAttribute('title')).toBe(
      'Not in the top million sites on the Tranco list.',
    );
  });

  it("marks the author's own site too", () => {
    render(<CitedView />);
    pasteAnswer();
    fireEvent.change(screen.getByLabelText('Your site'), {
      target: { value: 'hivecraft-notes.example' },
    });
    act(() => setTrancoList(LIST));
    const own = screen.getByRole('region', { name: 'Your site' });
    expect(within(own).getByText('Small site')).toBeTruthy();
  });
});
