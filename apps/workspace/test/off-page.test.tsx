import { OFFPAGE_ADVICE, OFFPAGE_NOTE } from '@citation-equity/engine';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OffPagePage from '@/app/off-page/page';
import { PageShell } from '@/components/page-shell';

const EM_DASH = '—';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PERPLEXITY = `Espresso tastes bitter when it over-extracts [1][2].

Sources
1. https://www.reddit.com/r/espresso/comments/abc/bitter/
2. [Espresso](https://en.wikipedia.org/wiki/Espresso_(drink))
3. https://www.example.com/espresso`;

describe('/off-page', () => {
  it('renders a tally from pasted text, groups it by kind, and makes no request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<OffPagePage />);
    fireEvent.change(screen.getByLabelText('Question 1'), {
      target: { value: 'Why does espresso taste bitter?' },
    });
    fireEvent.change(screen.getByLabelText('Answer 1, with its sources'), {
      target: { value: PERPLEXITY },
    });
    fireEvent.change(screen.getByLabelText('Your site'), { target: { value: 'example.com' } });

    const report = screen.getByRole('region', { name: 'Who gets cited' });
    expect(report.textContent).toContain('1 answer to 1 question');
    expect(report.textContent).toContain('Your site (example.com) is cited in 1 of 1 answer.');
    const forums = within(report).getByRole('table', { name: OFFPAGE_ADVICE.forum.title });
    const row = within(forums).getByRole('row', { name: /reddit\.com/ });
    expect(row.textContent).toContain('1 of 1');
    expect(row.textContent).toContain('Why does espresso taste bitter?');
    expect(within(report).getByRole('table', { name: OFFPAGE_ADVICE.wiki.title })).toBeTruthy();
    // The own site is reported apart, not in a table.
    expect(within(report).queryByRole('row', { name: /example\.com/ })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows an advice card, with grade, what to avoid and sources, for each kind present', () => {
    render(<OffPagePage />);
    fireEvent.change(screen.getByLabelText('Answer 1, with its sources'), {
      target: { value: PERPLEXITY },
    });
    for (const kind of ['forum', 'wiki'] as const) {
      const card = OFFPAGE_ADVICE[kind];
      const region = screen.getByRole('region', { name: `What to do: ${card.title}` });
      const text = region.textContent ?? '';
      expect(text).toContain(`Evidence: ${card.evidence.grade}`);
      expect(text).toContain(card.advice);
      expect(text).toContain(card.avoid);
      expect(text).toContain(card.evidence.summary);
      for (const s of card.evidence.sources) {
        expect(within(region).getByRole('link', { name: s.citation }).getAttribute('href')).toBe(
          s.url,
        );
      }
    }
    expect(
      screen.queryByRole('region', { name: `What to do: ${OFFPAGE_ADVICE.commerce.title}` }),
    ).toBeNull();
    // Without a question, the answer is labelled by its box.
    expect(screen.getByRole('region', { name: 'Who gets cited' }).textContent).toContain(
      'Question 1',
    );
  });

  it('adds and removes question boxes from the keyboard-reachable buttons', () => {
    render(<OffPagePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    fireEvent.change(screen.getByLabelText('Answer 2, with its sources'), {
      target: { value: 'See https://www.youtube.com/watch?v=1 and https://reddit.com/r/x' },
    });
    fireEvent.change(screen.getByLabelText('Answer 1, with its sources'), {
      target: { value: 'https://reddit.com/r/y' },
    });
    const report = screen.getByRole('region', { name: 'Who gets cited' });
    expect(report.textContent).toContain('2 answers to 2 questions');
    expect(within(report).getByRole('row', { name: /reddit\.com/ }).textContent).toContain(
      '2 of 2',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove question 2' }));
    expect(screen.queryByLabelText('Answer 2, with its sources')).toBeNull();
    expect(report.textContent).toContain('1 answer to 1 question');
  });

  it('says what to paste before anything is pasted, with the note and no advice cards', () => {
    render(<OffPagePage />);
    const text = document.body.textContent ?? '';
    expect(text).toContain(OFFPAGE_NOTE);
    expect(text).toContain('ce sources');
    expect(screen.getByRole('region', { name: 'Who gets cited' }).textContent).toMatch(
      /Paste an answer/,
    );
    expect(screen.queryAllByRole('region', { name: /^What to do:/ })).toHaveLength(0);
  });

  it('uses no em dash and never the retired grade word', () => {
    render(<OffPagePage />);
    fireEvent.change(screen.getByLabelText('Answer 1, with its sources'), {
      target: {
        value: Object.values({
          a: 'https://reddit.com',
          b: 'https://wikipedia.org',
          c: 'https://youtube.com',
          d: 'https://g2.com',
          e: 'https://reuters.com',
          f: 'https://nih.gov',
          g: 'https://linkedin.com',
          h: 'https://amazon.com',
          i: 'https://blog.example.org',
        }).join(' '),
      },
    });
    expect(screen.getAllByRole('region', { name: /^What to do:/ })).toHaveLength(9);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toMatch(new RegExp(['contra', 'dicted'].join(''), 'i'));
  });

  it('is linked from the page header', () => {
    render(
      <PageShell title="T">
        <p>x</p>
      </PageShell>,
    );
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(nav).getByRole('link', { name: 'Off-page' }).getAttribute('href')).toBe(
      '/off-page',
    );
  });
});
