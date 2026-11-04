// The home (with the example, and with the visitor's own questions) and the About dialog say
// nothing about the evidence (test/quiet.ts).
import { TEST_LABEL_TEXT } from '@citation-equity/engine';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabelChip } from '@/components/check-chip';
import { Home } from '@/components/home/home';
import { AppShell } from '@/components/shell/app-shell';
import { runExample } from '@/lib/examples';
import { setSiteInput } from '@/lib/site-questions';
import { expectQuiet, LABEL_PHRASES, resetScreens, STUDY_NAMES } from './quiet';

const path = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => path.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

beforeEach(resetScreens);
afterEach(() => {
  cleanup();
  resetScreens();
});

describe('the study-name list', () => {
  it('comes from the evidence registries and names the draft checks’ studies', () => {
    for (const name of ['Aggarwal', 'Puerto', 'Vishwakarma', 'C-SEO Bench', 'What Gets Cited']) {
      expect(STUDY_NAMES, name).toContain(name);
    }
    expect(STUDY_NAMES).not.toContain('Google Search Central');
  });
});

describe('the label-chip allowance', () => {
  it('lets every label phrase stand in a chip, with its one-sentence tooltip', () => {
    expect(LABEL_PHRASES).toEqual(Object.values(TEST_LABEL_TEXT));
    const { container } = render(
      <ul>
        {(Object.keys(TEST_LABEL_TEXT) as (keyof typeof TEST_LABEL_TEXT)[]).map((label) => (
          <li key={label}>
            Lists, not long sentences <LabelChip label={label} tooltip="A plain sentence." />
          </li>
        ))}
      </ul>,
    );
    expect(() => expectQuiet('chips', container)).not.toThrow();
  });

  it('catches a label phrase outside a chip', () => {
    for (const phrase of LABEL_PHRASES) {
      const { container, unmount } = render(<p>This note: {phrase}.</p>);
      expect(() => expectQuiet(phrase, container), phrase).toThrow(/outside a chip/);
      unmount();
    }
  });

  it('catches a chip tooltip with a number or a second sentence', () => {
    for (const tooltip of ['Helped by 0.03.', 'One sentence. Two sentences.']) {
      const { container, unmount } = render(<LabelChip label="helped" tooltip={tooltip} />);
      expect(() => expectQuiet(tooltip, container), tooltip).toThrow();
      unmount();
    }
  });

  it('catches a chip whose text is not a label phrase', () => {
    const { container } = render(<span data-label-chip="">Proven</span>);
    expect(() => expectQuiet('odd chip', container)).toThrow(/a chip reads "Proven"/);
  });
});

describe('the working screens say nothing about the evidence', () => {
  it('the home, with the example tried', () => {
    path.current = '/';
    act(() => runExample());
    render(
      <AppShell>
        <Home />
      </AppShell>,
    );
    expectQuiet('home');
  });

  it('the home with keywords, an import and a model question, every disclosure open', () => {
    path.current = '/';
    setSiteInput({
      keywords:
        'espresso bitter\nespresso shot time, 1900\nbest espresso grinder for beginners, 720',
      imported: {
        name: 'Queries.csv',
        queries: [
          { text: 'is espresso safe while pregnant', source: 'search-console', impressions: 90 },
        ],
      },
      suggested: ['Does a darker roast taste more bitter?'],
    });
    render(
      <AppShell>
        <Home />
      </AppShell>,
    );
    // More from a local AI, and the searches behind each question that has some.
    const details = [...document.querySelectorAll('details')];
    expect(details.map((d) => d.querySelector('summary')?.textContent)).toContain(
      'More from a local AI',
    );
    expect(details.length).toBeGreaterThanOrEqual(2);
    for (const d of details) d.open = true;
    expectQuiet('home, own questions');
    // Headings are short, plain names.
    for (const h of document.querySelectorAll('main h1, main h2, main h3, main summary')) {
      expect(
        (h.textContent ?? '').split(/\s+/).filter(Boolean).length,
        h.textContent ?? '',
      ).toBeLessThanOrEqual(6);
    }
  });

  it('the About dialog', async () => {
    path.current = '/';
    render(
      <AppShell>
        <main />
      </AppShell>,
    );
    fireEvent.click(within(screen.getByRole('contentinfo')).getByRole('button', { name: 'About' }));
    await screen.findByRole('dialog', { name: 'About' });
    expectQuiet('about');
  });
});
