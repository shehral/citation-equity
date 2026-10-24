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
const NAMES = [
  'Author name',
  'Dates',
  'Structured data (schema)',
  'Search can show it',
  'Main URL (canonical)',
  'AI crawlers allowed',
  'Text loads without JavaScript',
];

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

describe('/site', () => {
  it('opens on the input, with the seven checks listed and no result rows', () => {
    render(<SitePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Can AI read your page?');
    expect(screen.getByLabelText('Page HTML').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('robots.txt (optional)').tagName).toBe('TEXTAREA');
    const list = screen.getByRole('list', { name: 'What it checks' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(NAMES);
    expect(screen.queryByRole('region', { name: 'Results' })).toBeNull();
  });

  it('checks pasted HTML in the page, with a summary row and no request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    // blogposting.html: five page rows pass, the body is short, and no robots.txt was pasted.
    expect(within(results()).getByRole('status').textContent).toBe('5 of 7 pass, 1 to fix');
    expect(rowOf('Author name').textContent).toContain('Pass');
    expect(rowOf('Author name').textContent).toContain('Found: A');
    expect(rowOf('Main URL (canonical)').textContent).toContain('Pass');
    expect(rowOf('Text loads without JavaScript').textContent).toContain('Fix');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps Why it matters behind a tap on each row', () => {
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    const why = within(rowOf('Dates')).getByText('Why it matters').closest('details');
    expect(why?.open).toBe(false);
    expect(why?.textContent).toContain('AI rankers favor newer dates, so keep them accurate.');
    fireEvent.click(within(rowOf('Dates')).getByText('Why it matters'));
    expect(why?.open).toBe(true);
  });

  it('says in one line what needs the live site, with the command only on expand', () => {
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    expect(rowOf('AI crawlers allowed').textContent).toContain(
      'Needs your live site, or paste robots.txt above.',
    );
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
    expect(within(results()).getByRole('status').textContent).toBe('5 of 7 pass, 2 to fix');
    expect(within(results()).getByText('1 check needs your live site')).toBeTruthy();
  });

  it('marks the first failing row for Next up, and scrolls there when the URL asks', () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    window.history.replaceState(null, '', '#first-issue');
    try {
      render(<SitePage />);
      paste('robots.txt (optional)', 'User-agent: PerplexityBot\nDisallow: /\n');
      paste('Page HTML', BLOG_POSTING);
      // Two rows fail; the anchor and the one scroll go to the first of them.
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

  it('puts the anchor on no row when nothing fails', () => {
    render(<SitePage />);
    paste(
      'Page HTML',
      BLOG_POSTING.replace('</article>', `<p>${'word '.repeat(300)}</p></article>`),
    );
    expect(within(results()).getByRole('status').textContent).toBe('6 of 7 pass');
    expect(document.getElementById('first-issue')).toBeNull();
  });

  it('stores only the summary of the check', () => {
    render(<SitePage />);
    paste('Page HTML', BLOG_POSTING);
    expect(getSummary('site')).toMatchObject({
      pass: 5,
      warn: 0,
      fail: 1,
      total: 7,
      needsLiveSite: 2,
      example: false,
    });
    expect(JSON.stringify(window.localStorage)).not.toContain('BlogPosting');
  });

  it('shows a stored summary after a reload, with Paste again to see details', () => {
    const stored: SiteSummary = {
      pass: 5,
      warn: 1,
      fail: 1,
      total: 7,
      needsLiveSite: 1,
      example: false,
      at: '2026-10-24T10:00:00.000Z',
    };
    setSummary('site', stored);
    render(<SitePage />);
    const last = screen.getByRole('region', { name: 'Last check' });
    expect(last.textContent).toContain('5 of 7 pass, 1 warning, 1 to fix');
    expect(last.textContent).not.toContain('Example');
    expect(last.textContent).toContain('Paste again to see details.');
    // Next up's deep link still lands on a real target: this summary.
    expect(last.id).toBe('first-issue');
    expect(screen.queryByRole('list', { name: 'What it checks' })).toBeNull();
    paste('Page HTML', BLOG_POSTING);
    expect(screen.queryByRole('region', { name: 'Last check' })).toBeNull();
  });

  it("shows the example's rows while the stored summary is the example's", () => {
    runExample();
    render(<SitePage />);
    // The summary line, then its Example label.
    expect(within(results()).getByRole('status').textContent).toBe(
      '5 of 7 pass, 1 warning, 1 to fixExample',
    );
    expect(screen.queryByText('Paste again to see details.')).toBeNull();
    // The failing row carries Next up's anchor.
    expect(rowOf('AI crawlers allowed').id).toBe('first-issue');
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
    expect(within(results()).getByRole('status').textContent).toBe('6 of 7 pass, 1 to fix');
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
    expect(within(results()).getByRole('status').textContent).toContain('of 7 pass');
  });

  it('follows a stored summary written while the page is open', () => {
    render(<SitePage />);
    act(() => {
      setSummary('site', {
        pass: 7,
        warn: 0,
        fail: 0,
        total: 7,
        needsLiveSite: 1,
        example: false,
        at: '2026-10-24T10:00:00.000Z',
      });
    });
    expect(screen.getByRole('region', { name: 'Last check' }).textContent).toContain('7 of 7 pass');
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
