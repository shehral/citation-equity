import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SitePage from '@/app/site/page';
import { runExample } from '@/lib/examples';
import { clearPasted } from '@/lib/pasted';
import { clearAll, getSummary, type SiteSummary, setSummary } from '@/lib/store';

// Under jsdom import.meta.url is not a file: URL, so the fixture is found from __dirname.
const BLOG_POSTING = readFileSync(
  join(__dirname, '../../../packages/engine/test/fixtures/readiness/blogposting.html'),
  'utf8',
);
const EM_DASH = '—';
/** The blocker items, in the order the view lists them. */
const BLOCKERS = ['AI crawlers allowed', 'Search can show it', 'Text loads without JavaScript'];
const NOTES = ['Author name', 'Dates', 'Structured data (schema)', 'Main URL (canonical)'];

function blockStorage() {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });
}

beforeEach(() => {
  window.localStorage.clear();
  clearAll();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearAll();
  window.localStorage.clear();
});

const paste = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const results = () => screen.getByRole('region', { name: 'Results' });
const rowOf = (name: string) => within(results()).getByRole('listitem', { name });
/** The pills a row shows (exactly one is expected). */
const pillsOf = (name: string) =>
  [...rowOf(name).querySelectorAll('[data-pill]')].map((el) => el.textContent);
const namesIn = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('aria-labelledby'))
    .map((id) => (id ? document.getElementById(id)?.textContent : null));
const otherNotes = () =>
  within(results()).getByText('Other page notes (4)').closest('details') as HTMLDetailsElement;

describe('/site metadata', () => {
  it('describes the page by what blocks engines', async () => {
    const { metadata } = await import('@/app/site/page');
    expect(metadata.title).toBe('Your site | Citation Equity');
    expect(metadata.description).toBe(
      'Can AI search reach your page? Paste its HTML and robots.txt to find what blocks crawlers, indexing or reading. Stays in your browser.',
    );
  });
});

describe('/site', () => {
  it('opens on the input, with the three blockers and the page notes listed, no result rows', () => {
    render(<SitePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Can engines reach it?');
    expect(
      screen.getByText(
        "Engines can't cite a page they can't fetch, index or read. Paste your page to check.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Page HTML').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('robots.txt (optional)').tagName).toBe('TEXTAREA');
    const list = screen.getByRole('list', { name: 'What it checks' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([...BLOCKERS, 'Four page notes']);
    expect(screen.queryByRole('region', { name: 'Results' })).toBeNull();
  });

  it('checks pasted HTML in the page, with a summary row and no request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    // blogposting.html: five page rows pass, the body is short, and no robots.txt was pasted.
    expect(within(results()).getByRole('status').textContent).toBe('1 blocker');
    expect(pillsOf('Author name')).toEqual(['Pass']);
    expect(rowOf('Author name').textContent).toContain('Found: A');
    expect(pillsOf('Main URL (canonical)')).toEqual(['Pass']);
    expect(pillsOf('Text loads without JavaScript')).toEqual(['Blocker']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lists the three blocker items under the Blockers overline, each with its pill', () => {
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    expect(within(results()).getByRole('heading', { level: 2 }).textContent).toBe('Blockers');
    const list = within(results()).getByRole('list', { name: 'Blockers' });
    expect(namesIn(list)).toEqual(BLOCKERS);
    // No robots.txt yet: crawler access waits for the live site; the short body blocks.
    expect(pillsOf('AI crawlers allowed')).toEqual(['Needs live site']);
    expect(pillsOf('Search can show it')).toEqual(['Clear']);
    expect(pillsOf('Text loads without JavaScript')).toEqual(['Blocker']);
    // Only training crawlers blocked: worth a check, not a blocker.
    paste('robots.txt (optional)', 'User-agent: GPTBot\nDisallow: /\n');
    expect(pillsOf('AI crawlers allowed')).toEqual(['Check']);
    // Each pill's tone: destructive, stale, done and muted.
    const tone = (name: string, pill: string) =>
      within(rowOf(name)).getByText(pill).className.split(' ');
    expect(tone('Text loads without JavaScript', 'Blocker')).toContain('text-destructive');
    expect(tone('AI crawlers allowed', 'Check')).toContain('text-stale');
    expect(tone('Search can show it', 'Clear')).toContain('text-done');
    paste('robots.txt (optional)', '');
    expect(tone('AI crawlers allowed', 'Needs live site')).toContain('text-muted-foreground');
  });

  it('keeps the other page notes closed, marked Not tested, with four rows inside', () => {
    render(<SitePage />);
    paste('Page HTML', '<html><body><p>Hello.</p></body></html>');
    const notes = otherNotes();
    expect(notes.open).toBe(false);
    const chip = notes.querySelector('summary [data-label-chip]') as HTMLElement;
    expect(chip.dataset.labelChip).toBe('not-tested');
    expect(chip.textContent).toBe('Not tested');
    expect(chip.title).toBe('Our tests did not cover this.');
    // Inside: the four notes with their own pills, apart from the blockers.
    const list = within(notes).getByRole('list', { name: 'Other page notes' });
    expect(namesIn(list)).toEqual(NOTES);
    for (const name of NOTES) expect(pillsOf(name)).toEqual(['Warning']);
    expect(namesIn(within(results()).getByRole('list', { name: 'Blockers' }))).toEqual(BLOCKERS);
    fireEvent.click(within(notes).getByText('Other page notes (4)'));
    expect(notes.open).toBe(true);
  });

  it('keeps Why it matters behind a tap on each row', () => {
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    const why = within(rowOf('Dates')).getByText('Why it matters').closest('details');
    expect(why?.open).toBe(false);
    expect(why?.textContent).toContain('AI rankers favor newer dates, so keep them accurate.');
    fireEvent.click(within(rowOf('Dates')).getByText('Why it matters'));
    expect(why?.open).toBe(true);
    // A blocker row keeps it too.
    const blocker = within(rowOf('Search can show it')).getByText('Why it matters');
    expect(blocker.closest('details')?.textContent).toContain(
      'Google and Bing drop blocked pages from AI answers.',
    );
  });

  it('says in one line what needs the live site, with the command only on expand', () => {
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    expect(rowOf('AI crawlers allowed').textContent).toContain(
      'Needs your live site, or paste robots.txt above.',
    );
    expect(pillsOf('AI crawlers allowed')).toEqual(['Needs live site']);
    const live = within(results()).getByText('2 checks need your live site').closest('details');
    expect(live?.open).toBe(false);
    expect(live?.textContent).toContain('ce site https://example.com/your-page');
    // The command appears once on the page.
    expect(document.body.textContent?.split('ce site ').length).toBe(2);
  });

  it('checks crawlers from a pasted robots.txt', () => {
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    paste('robots.txt (optional)', 'User-agent: PerplexityBot\nDisallow: /\n');
    expect(rowOf('AI crawlers allowed').textContent).toContain('Blocked: PerplexityBot.');
    expect(pillsOf('AI crawlers allowed')).toEqual(['Blocker']);
    expect(within(results()).getByRole('status').textContent).toBe('2 blockers');
    expect(within(results()).getByText('1 check needs your live site')).toBeTruthy();
  });

  it('marks the first blocker row for the home, and scrolls there when the URL asks', () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    window.history.replaceState(null, '', '#first-issue');
    try {
      render(<SitePage />);
      paste('robots.txt (optional)', 'User-agent: PerplexityBot\nDisallow: /\n');
      paste('Page HTML', BLOG_POSTING);
      // Two blockers; the anchor and the one scroll go to the first of them.
      const first = rowOf('AI crawlers allowed');
      expect(first.id).toBe('first-issue');
      expect(document.querySelectorAll('#first-issue')).toHaveLength(1);
      expect(rowOf('Text loads without JavaScript').id).toBe('');
      expect(scrolled).toEqual([first]);
    } finally {
      window.history.replaceState(null, '', window.location.pathname);
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('anchors the first blocker in the order the rows and the home show them, not the check order', () => {
    // The check lists indexing rules before crawler access; the view, the banner and the anchor
    // put AI crawlers allowed first.
    render(<SitePage />);
    paste('robots.txt (optional)', 'User-agent: PerplexityBot\nDisallow: /\n');
    paste(
      'Page HTML',
      BLOG_POSTING.replace('</head>', '<meta name="robots" content="noindex"></head>').replace(
        '</article>',
        `<p>${'word '.repeat(300)}</p></article>`,
      ),
    );
    expect(within(results()).getByRole('status').textContent).toBe('2 blockers');
    expect(pillsOf('AI crawlers allowed')).toEqual(['Blocker']);
    expect(pillsOf('Search can show it')).toEqual(['Blocker']);
    expect(rowOf('AI crawlers allowed').id).toBe('first-issue');
    expect(rowOf('Search can show it').id).toBe('');
    expect(getSummary('site')?.blockers).toEqual(['crawler-access', 'indexing-directives']);
  });

  it('puts the anchor on no row when nothing blocks engines', () => {
    render(<SitePage />);
    paste(
      'Page HTML',
      BLOG_POSTING.replace('</article>', `<p>${'word '.repeat(300)}</p></article>`),
    );
    expect(within(results()).getByRole('status').textContent).toBe('No blockers found');
    expect(document.getElementById('first-issue')).toBeNull();
    // A blocker item to check is not a blocker: still no anchor.
    paste('robots.txt (optional)', 'User-agent: GPTBot\nDisallow: /\n');
    expect(pillsOf('AI crawlers allowed')).toEqual(['Check']);
    expect(document.getElementById('first-issue')).toBeNull();
  });

  it('stores only the summary of the check: its blockers and checks', () => {
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    expect(getSummary('site')).toEqual({
      blockers: ['renders-without-js'],
      checks: [],
      needsLiveSite: 2,
      example: false,
      at: expect.any(String),
    });
    expect(JSON.stringify(window.localStorage)).not.toContain('BlogPosting');
  });

  it('shows a stored summary after a reload, with Paste again to see details', () => {
    const stored: SiteSummary = {
      blockers: ['crawler-access'],
      checks: ['renders-without-js'],
      needsLiveSite: 1,
      example: false,
      at: '2026-10-24T10:00:00.000Z',
    };
    setSummary('site', stored);
    render(<SitePage />);
    const last = screen.getByRole('region', { name: 'Last check' });
    expect(last.textContent).toBe('1 blocker: AI crawlers allowedPaste again to see details.');
    // The home's See blockers still lands on a real target: this summary.
    expect(last.id).toBe('first-issue');
    expect(screen.queryByRole('list', { name: 'What it checks' })).toBeNull();
    paste('Page HTML', BLOG_POSTING);
    expect(screen.queryByRole('region', { name: 'Last check' })).toBeNull();
  });

  it('says No blockers found after a reload, with no anchor', () => {
    setSummary('site', {
      blockers: [],
      checks: ['crawler-access'],
      needsLiveSite: 1,
      example: false,
      at: '2026-10-24T10:00:00.000Z',
    });
    render(<SitePage />);
    const last = screen.getByRole('region', { name: 'Last check' });
    expect(last.textContent).toBe('No blockers foundPaste again to see details.');
    expect(last.id).toBe('');
  });

  it("shows the example's rows while the stored summary is the example's", () => {
    runExample();
    render(<SitePage />);
    // The headline, then its Example label.
    expect(within(results()).getByRole('status').textContent).toBe('1 blockerExample');
    expect(screen.queryByText('Paste again to see details.')).toBeNull();
    // The example's robots.txt blocks an AI search crawler: the crawler row is the blocker, and
    // it carries the home's anchor.
    expect(pillsOf('AI crawlers allowed')).toEqual(['Blocker']);
    expect(rowOf('AI crawlers allowed').textContent).toContain('Blocked: PerplexityBot.');
    expect(rowOf('AI crawlers allowed').id).toBe('first-issue');
    expect(pillsOf('Search can show it')).toEqual(['Clear']);
    expect(pillsOf('Text loads without JavaScript')).toEqual(['Clear']);
    expect(getSummary('site')?.example).toBe(true);
    expect(JSON.stringify(window.localStorage)).not.toContain('espresso-bitter/');
  });

  it('keeps pasted HTML across a view switch, but not across a reload', () => {
    const first = render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    paste('robots.txt (optional)', 'User-agent: *\nAllow: /\n');
    first.unmount();
    // Another view and back: the view mounts afresh within the same page.
    const second = render(<SitePage />);
    expect((screen.getByLabelText('Page HTML') as HTMLTextAreaElement).value).toBe(BLOG_POSTING);
    expect(within(results()).getByRole('status').textContent).toBe('1 blocker');
    second.unmount();
    clearPasted(); // what a reload does to page memory
    render(<SitePage />);
    expect((screen.getByLabelText('Page HTML') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByRole('region', { name: 'Last check' }).textContent).toContain(
      'Paste again to see details.',
    );
  });

  it('works with storage blocked', () => {
    blockStorage();
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    expect(within(results()).getByRole('status').textContent).toBe('1 blocker');
    expect(getSummary('site')?.blockers).toEqual(['renders-without-js']);
  });

  it('follows a stored summary written while the page is open', () => {
    render(<SitePage />);
    act(() => {
      setSummary('site', {
        blockers: [],
        checks: [],
        needsLiveSite: 1,
        example: false,
        at: '2026-10-24T10:00:00.000Z',
      });
    });
    expect(screen.getByRole('region', { name: 'Last check' }).textContent).toContain(
      'No blockers found',
    );
  });

  it('uses no em dash, no GEO and never the retired grade word', () => {
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    for (const d of document.querySelectorAll('details')) d.open = true;
    const text = document.body.textContent ?? '';
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toMatch(/\bGEO\b/);
    expect(text).not.toMatch(new RegExp(['contra', 'dicted'].join(''), 'i'));
  });
});
