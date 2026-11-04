import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockerBanner } from '@/components/home/blocker-banner';

/** A link's route. Under Vitest next/link drops the trailing slash that the static build keeps. */
const route = (a: Element) => (a.getAttribute('href') ?? '').replace(/(.)\/(#|$)/, '$1$2');
const banner = () => screen.getByRole('region', { name: 'Blocker' });

const REASONS: [string, string][] = [
  ['crawler-access', 'Its robots.txt blocks a crawler AI search needs.'],
  ['indexing-directives', 'A tag keeps it out of search results.'],
  ['renders-without-js', 'Its text appears only after JavaScript runs.'],
];

afterEach(cleanup);

describe('BlockerBanner', () => {
  it('renders nothing when there is no blocker', () => {
    const { container } = render(<BlockerBanner blockers={[]} example={false} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it.each(REASONS)('names one blocker on your page with its reason (%s)', (id, reason) => {
    render(<BlockerBanner blockers={[id]} example={false} />);
    const b = within(banner());
    expect(b.getByText('A blocker on your page')).toBeTruthy();
    expect(b.getByText(reason)).toBeTruthy();
    expect(banner().textContent).not.toMatch(/more/);
  });

  it('counts 2 blockers on your page and shows the first reason, then and 1 more', () => {
    render(<BlockerBanner blockers={['crawler-access', 'renders-without-js']} example={false} />);
    const b = within(banner());
    expect(b.getByText('2 blockers on your page')).toBeTruthy();
    expect(
      within(banner()).getByText('Its robots.txt blocks a crawler AI search needs, and 1 more.'),
    ).toBeTruthy();
    expect(banner().textContent).not.toContain('JavaScript');
  });

  it('counts 3 blockers as the first reason and 2 more', () => {
    render(
      <BlockerBanner
        blockers={['indexing-directives', 'crawler-access', 'renders-without-js']}
        example={false}
      />,
    );
    expect(within(banner()).getByText('3 blockers on your page')).toBeTruthy();
    expect(
      within(banner()).getByText('A tag keeps it out of search results, and 2 more.'),
    ).toBeTruthy();
  });

  it('never calls the example page "your"', () => {
    const one = render(<BlockerBanner blockers={['crawler-access']} example />);
    expect(within(banner()).getByText('A blocker on the example page')).toBeTruthy();
    expect(banner().textContent).toContain('Its robots.txt blocks a crawler AI search needs.');
    expect(banner().textContent).not.toMatch(/\byour\b/i);
    one.unmount();
    render(<BlockerBanner blockers={['crawler-access', 'indexing-directives']} example />);
    expect(within(banner()).getByText('2 blockers on the example page')).toBeTruthy();
    expect(banner().textContent).toContain(
      'Its robots.txt blocks a crawler AI search needs, and 1 more.',
    );
    expect(banner().textContent).not.toMatch(/\byour\b/i);
  });

  it('gives a blocker with no reason of its own a plain one, so the sentence never starts bare', () => {
    render(<BlockerBanner blockers={['a-new-blocker', 'crawler-access']} example={false} />);
    expect(
      within(banner()).getByText('It can keep the page out of AI answers, and 1 more.'),
    ).toBeTruthy();
  });

  it('links See blockers to the first issue on Your site, on your page and the example', () => {
    for (const example of [false, true]) {
      const view = render(<BlockerBanner blockers={['crawler-access']} example={example} />);
      const link = within(banner()).getByRole('link', { name: 'See blockers' });
      expect(route(link)).toBe('/site#first-issue');
      expect(banner().textContent).not.toMatch(/GEO|—/);
      view.unmount();
    }
  });
});
