import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Steps } from '@/components/home/steps';

type Props = Parameters<typeof Steps>[0];
type Draft = NonNullable<Props['draft']>;
type Site = NonNullable<Props['site']>;
type Cited = NonNullable<Props['cited']>;

const DRAFT: Draft = { covered: 1, total: 4, fromPage: false, example: false };
const SITE: Site = { blockers: ['crawler-access'], needsLiveSite: 1, example: false };
const CITED: Cited = {
  answers: 3,
  citingYou: 1,
  site: 'example.com',
  topKinds: ['forum', 'wiki'],
  example: false,
};

/** A link's route. Under Vitest next/link drops the trailing slash that the static build keeps. */
const route = (a: Element) => (a.getAttribute('href') ?? '').replace(/(.)\/(#|$)/, '$1$2');
const card = (name: string) => screen.getByRole('region', { name });
const show = (p: Partial<Props>) => render(<Steps draft={null} site={null} cited={null} {...p} />);

afterEach(cleanup);

describe('Steps', () => {
  it('puts the three cards under the heading Next steps, in order, one level below it', () => {
    show({});
    const steps = screen.getByRole('region', { name: 'Next steps' });
    const top = within(steps).getAllByRole('heading', { level: 2 });
    expect(top.map((h) => h.textContent)).toEqual(['Next steps']);
    const cards = within(steps).getAllByRole('heading', { level: 3 });
    expect(cards.map((h) => h.textContent)).toEqual(['Your draft', 'Your site', 'Results']);
  });

  it('reads Not checked on every card before anything is checked, each with its link', () => {
    show({});
    const cards = [
      [
        'Your draft',
        'Does it answer them?',
        'Paste your post. See which questions it covers.',
        'Open draft',
        '/draft',
      ],
      [
        'Your site',
        'Can engines reach it?',
        "Paste your page's HTML. See what keeps engines away.",
        'Check page',
        '/site',
      ],
      [
        'Results',
        'Did it change anything?',
        'Test before and after, or paste AI answers.',
        'See results',
        '/cited',
      ],
    ];
    for (const [name, question, body, cta, href] of cards) {
      const c = within(card(name));
      expect(c.getByText(question)).toBeTruthy();
      expect(c.getByText('Not checked')).toBeTruthy();
      expect(c.getByText(body)).toBeTruthy();
      expect(c.queryByText('Example')).toBeNull();
      expect(route(c.getByRole('link', { name: `${cta}: ${name}` }))).toBe(href);
    }
    expect(document.body.textContent).not.toMatch(/GEO|—|score/i);
  });
});

describe('Your draft card', () => {
  it('needs attention while a question is not covered, and links to Start here', () => {
    show({ draft: DRAFT });
    const c = within(card('Your draft'));
    expect(card('Your draft').textContent).toContain('1 of 4 covered');
    expect(c.getByText('Needs attention')).toBeTruthy();
    expect(c.queryByText('From your title')).toBeNull();
    expect(c.queryByText('Example')).toBeNull();
    expect(route(c.getByRole('link', { name: 'Open draft: Your draft' }))).toBe(
      '/draft#start-here',
    );
  });

  it('reads Checked once every question is covered', () => {
    show({ draft: { ...DRAFT, covered: 4 } });
    expect(within(card('Your draft')).getByText('Checked')).toBeTruthy();
    expect(card('Your draft').textContent).toContain('4 of 4 covered');
  });

  it('says No questions yet, with no number, when M is 0', () => {
    show({ draft: { ...DRAFT, covered: 0, total: 0, fromPage: true } });
    const c = within(card('Your draft'));
    expect(c.getByText('No questions yet')).toBeTruthy();
    expect(c.getByText('Needs attention')).toBeTruthy();
    expect(card('Your draft').textContent).not.toMatch(/\d|covered/);
    // Nothing was measured, so it does not say where the questions came from.
    expect(c.queryByText('From your title')).toBeNull();
    expect(route(c.getByRole('link', { name: 'Open draft: Your draft' }))).toBe(
      '/draft#start-here',
    );
  });

  it("says From your title when the page's own questions were measured", () => {
    show({ draft: { ...DRAFT, covered: 0, total: 2, fromPage: true } });
    expect(card('Your draft').textContent).toContain('0 of 2 covered');
    expect(within(card('Your draft')).getByText('From your title')).toBeTruthy();
  });

  it('is marked Example on the example', () => {
    show({ draft: { ...DRAFT, covered: 0, example: true } });
    const c = within(card('Your draft'));
    expect(c.getByText('Example')).toBeTruthy();
    expect(c.getByText('Needs attention')).toBeTruthy();
    expect(card('Your draft').textContent).toContain('0 of 4 covered');
  });
});

describe('Your site card', () => {
  it('reads Checked with No blockers found, linking to the details', () => {
    show({ site: { ...SITE, blockers: [], needsLiveSite: 0 } });
    const c = within(card('Your site'));
    expect(c.getByText('Checked')).toBeTruthy();
    expect(c.getByText('No blockers found')).toBeTruthy();
    expect(card('Your site').textContent).not.toContain('live site');
    expect(route(c.getByRole('link', { name: 'See details: Your site' }))).toBe('/site');
  });

  it('needs attention with 1 blocker, named plainly, and what needs the live site', () => {
    show({ site: SITE });
    const c = within(card('Your site'));
    expect(c.getByText('Needs attention')).toBeTruthy();
    expect(c.getByText('1 blocker')).toBeTruthy();
    expect(c.getByText('AI crawlers allowed')).toBeTruthy();
    expect(c.getByText('1 more needs your live site')).toBeTruthy();
    expect(route(c.getByRole('link', { name: 'See details: Your site' }))).toBe('/site');
  });

  it('reads Checked with No blockers found and still says what needs the live site', () => {
    show({ site: { ...SITE, blockers: [], needsLiveSite: 1 } });
    const c = within(card('Your site'));
    expect(c.getByText('Checked')).toBeTruthy();
    expect(c.getByText('No blockers found')).toBeTruthy();
    expect(c.getByText('1 more needs your live site')).toBeTruthy();
  });

  it('counts and names 2 blockers', () => {
    show({
      site: {
        blockers: ['indexing-directives', 'renders-without-js'],
        needsLiveSite: 2,
        example: false,
      },
    });
    const c = within(card('Your site'));
    expect(c.getByText('2 blockers')).toBeTruthy();
    expect(c.getByText('Search can show it, Text loads without JavaScript')).toBeTruthy();
    expect(c.getByText('2 more need your live site')).toBeTruthy();
  });

  it('is marked Example on the example', () => {
    show({ site: { ...SITE, example: true } });
    const c = within(card('Your site'));
    expect(c.getByText('Example')).toBeTruthy();
    expect(c.getByText('1 blocker')).toBeTruthy();
  });
});

describe('Results card', () => {
  it('counts the live answers that cite you, with the most cited kinds', () => {
    show({ cited: CITED });
    const c = within(card('Results'));
    expect(c.getByText('Checked')).toBeTruthy();
    expect(card('Results').textContent).toContain('1 of 3 live answers cite you');
    expect(c.getByText('Most cited: Forums, Wikipedia')).toBeTruthy();
    expect(c.queryByText('Paste a few more answers')).toBeNull();
    expect(c.queryByText('Not cited yet')).toBeNull();
    expect(route(c.getByRole('link', { name: 'See results: Results' }))).toBe('/cited');
  });

  it('agrees with one live answer: "1 of 1 live answer cites you"', () => {
    show({ cited: { ...CITED, answers: 1 } });
    expect(card('Results').textContent).toContain('1 of 1 live answer cites you');
    expect(card('Results').textContent).toContain('Paste a few more answers');
    cleanup();
    show({ cited: { ...CITED, answers: 1, citingYou: 0 } });
    expect(card('Results').textContent).toContain('0 of 1 live answer cites you');
  });

  it('needs attention when no answer cites you', () => {
    show({ cited: { ...CITED, citingYou: 0 } });
    const c = within(card('Results'));
    expect(c.getByText('Needs attention')).toBeTruthy();
    expect(c.getByText('Not cited yet')).toBeTruthy();
    expect(card('Results').textContent).toContain('0 of 3 live answers cite you');
  });

  it('asks for a site when none was given, instead of counting who cites you', () => {
    const { site: _, ...noSite } = { ...CITED, citingYou: 0 };
    show({ cited: noSite });
    const c = within(card('Results'));
    expect(c.getByText('Checked')).toBeTruthy();
    expect(card('Results').textContent).toContain('3 answers');
    expect(c.getByText('Add your site to see if you are cited')).toBeTruthy();
    expect(card('Results').textContent).not.toMatch(/cite you|Not cited yet/);
  });

  it('asks for a few more answers when fewer than 3 are pasted', () => {
    show({ cited: { ...CITED, answers: 2 } });
    const c = within(card('Results'));
    expect(c.getByText('Paste a few more answers')).toBeTruthy();
    expect(card('Results').textContent).toContain('1 of 2 live answers cite you');
  });

  it('names at most two kinds, and none when no kind is known', () => {
    const first = show({ cited: { ...CITED, topKinds: ['video', 'forum', 'wiki'] } });
    expect(within(card('Results')).getByText('Most cited: Video, Forums')).toBeTruthy();
    first.unmount();
    show({ cited: { ...CITED, topKinds: [] } });
    expect(card('Results').textContent).not.toContain('Most cited');
  });

  it('is marked Example on the example', () => {
    show({ cited: { ...CITED, example: true } });
    const c = within(card('Results'));
    expect(c.getByText('Example')).toBeTruthy();
    expect(card('Results').textContent).toContain('1 of 3 live answers cite you');
  });
});
