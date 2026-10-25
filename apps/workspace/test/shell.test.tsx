import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREDIT } from '@/components/shell/about-dialog';
import { AppShell } from '@/components/shell/app-shell';
import { reloadAt } from '@/lib/base-path';
import { REPO_URL } from '@/lib/links';
import {
  clearAll,
  getActiveSlot,
  getLastView,
  getSummary,
  type SiteSummary,
  setLastView,
  setSummary,
} from '@/lib/store';

const nav = vi.hoisted(() => ({ pathname: '/', push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn() }),
}));
vi.mock('@/lib/base-path', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/base-path')>()),
  reloadAt: vi.fn(),
}));

const SITE: SiteSummary = {
  pass: 5,
  warn: 1,
  fail: 1,
  total: 7,
  needsLiveSite: 1,
  example: true,
  at: '2026-10-24T10:00:00.000Z',
};

/** A link's route. Under Vitest next/link drops the trailing slash that the static build keeps. */
const route = (a: Element) => (a.getAttribute('href') ?? '').replace(/(.)\/$/, '$1');

/** A page that reads the last view on mount, as the home does to land returning users. */
const probeSeen: (string | null)[] = [];
function Probe() {
  useEffect(() => {
    probeSeen.push(getLastView());
  }, []);
  return null;
}

function renderShell(pathname: string, children: React.ReactNode = <main>Page</main>) {
  nav.pathname = pathname;
  return render(<AppShell>{children}</AppShell>);
}

beforeEach(() => {
  window.localStorage.clear();
  clearAll();
  nav.push.mockReset();
  nav.replace.mockReset();
  vi.mocked(reloadAt).mockReset();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  clearAll();
});

describe('header', () => {
  it('on a first visit to the home: wordmark, privacy chip, theme toggle and More, no view tabs', () => {
    renderShell('/');
    const header = screen.getByRole('banner');
    expect(
      within(header).getByRole('link', { name: 'Citation Equity home' }).getAttribute('href'),
    ).toBe('/');
    expect(within(header).getByRole('button', { name: 'Stays in your browser' })).toBeTruthy();
    expect(
      within(header).getByRole('button', { name: /Switch to (dark|light) theme/ }),
    ).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Views' })).toBeNull();
  });

  it('shows the three view tabs on a view, marks the current one and records it', () => {
    renderShell('/site/');
    const tabs = screen.getByRole('navigation', { name: 'Views' });
    const links = within(tabs).getAllByRole('link');
    expect(links.map((a) => [a.textContent, route(a)])).toEqual([
      ['Your draft', '/draft'],
      ['Your site', '/site'],
      ['Who gets cited', '/cited'],
    ]);
    expect(within(tabs).getByRole('link', { name: 'Your site' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(tabs).getByRole('link', { name: 'Your draft' }).hasAttribute('aria-current'),
    ).toBe(false);
    expect(getLastView()).toBe('site');
  });

  it('keeps the tabs on the home once the user has left it', () => {
    const { rerender } = renderShell('/draft/');
    nav.pathname = '/';
    rerender(
      <AppShell>
        <main>Home</main>
      </AppShell>,
    );
    expect(getLastView()).toBe('home');
    expect(screen.getByRole('navigation', { name: 'Views' })).toBeTruthy();
  });

  it('records no view for pages that are not views (Research)', () => {
    setLastView('cited');
    renderShell('/research/');
    expect(getLastView()).toBe('cited');
    expect(screen.getByRole('navigation', { name: 'Views' })).toBeTruthy();
  });

  it('lets a page read the previous last view on mount, before the shell records the new one', () => {
    setLastView('draft');
    probeSeen.length = 0;
    renderShell('/', <Probe />);
    expect(probeSeen).toEqual(['draft']);
    expect(getLastView()).toBe('home');
  });

  it('opens the privacy note from the chip', async () => {
    renderShell('/');
    await userEvent.click(screen.getByRole('button', { name: 'Stays in your browser' }));
    expect(await screen.findByText(/Everything you paste stays in this browser/)).toBeTruthy();
  });
});

describe('footer', () => {
  it('is one line: About, Research, GitHub', () => {
    renderShell('/');
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toBe('About·Research·GitHub');
    expect(within(footer).getByRole('button', { name: 'About' })).toBeTruthy();
    expect(route(within(footer).getByRole('link', { name: 'Research' }))).toBe('/research');
    expect(within(footer).getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe(
      REPO_URL,
    );
  });
});

describe('About dialog', () => {
  it('holds the exact credit sentence and nothing else about attribution', async () => {
    renderShell('/');
    // Attribution appears nowhere in the shell while the dialog is closed.
    expect(document.body.textContent).not.toMatch(/Bayat|Shehral|Gupta|Northeastern/);

    await userEvent.click(
      within(screen.getByRole('contentinfo')).getByRole('button', { name: 'About' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'About' });
    const text = dialog.textContent ?? '';
    expect(CREDIT).toBe(
      'Original design by Prof. Akram Bayat. Built by Mohammad Ali Shehral and Ishan Gupta, Northeastern University, San Jose.',
    );
    expect(text.split(CREDIT)).toHaveLength(2);
    const rest = text.replace(CREDIT, '');
    expect(rest).not.toMatch(
      /Bayat|Shehral|Gupta|Northeastern|San Jose|SPARK|Khoury|principal investigator|design by|built by|FootnoteOne/i,
    );
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\bGEO\b/);
    expect(
      within(dialog)
        .getByRole('link', { name: /GitHub/ })
        .getAttribute('href'),
    ).toBe(REPO_URL);
    expect(route(within(dialog).getByRole('link', { name: 'How we tested this' }))).toBe(
      '/research',
    );
    expect(text).not.toMatch(/grade/i);
  });

  it('opens from a #about link (the /about/ redirect) and drops the hash', async () => {
    window.history.replaceState(null, '', '/#about');
    renderShell('/');
    expect(await screen.findByRole('dialog', { name: 'About' })).toBeTruthy();
    expect(window.location.hash).toBe('');
  });
});

describe('More menu', () => {
  async function openMore() {
    const trigger = screen.getByRole('button', { name: 'More' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    return screen.findByRole('menu');
  }

  it('is keyboard reachable and lists Examples, Research, About, Clear my data, GitHub', async () => {
    renderShell('/');
    const menu = await openMore();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Bitter espresso', 'RAG explainer', 'Research', 'About', 'Clear my data', 'GitHub']);
    expect(within(menu).getByText('Examples')).toBeTruthy();
  });

  it('opens an example in the draft view', async () => {
    renderShell('/');
    const menu = await openMore();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'RAG explainer' }));
    expect(getActiveSlot()).toBe('rag-explained');
    expect(nav.push).toHaveBeenCalledWith('/draft/');
  });

  it('opens the About dialog', async () => {
    renderShell('/');
    const menu = await openMore();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'About' }));
    expect(await screen.findByRole('dialog', { name: 'About' })).toBeTruthy();
  });

  it('asks before Clear my data, then clears the store and reloads the home', async () => {
    setSummary('site', SITE);
    renderShell('/site/');

    let menu = await openMore();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Clear my data' }));
    let confirm = await screen.findByRole('alertdialog', { name: 'Clear my data?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(getSummary('site')).toEqual(SITE);
    expect(reloadAt).not.toHaveBeenCalled();

    menu = await openMore();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Clear my data' }));
    confirm = await screen.findByRole('alertdialog', { name: 'Clear my data?' });
    await act(() => userEvent.click(within(confirm).getByRole('button', { name: 'Clear' })));
    expect(getSummary('site')).toBeNull();
    expect(getLastView()).toBeNull();
    expect(reloadAt).toHaveBeenCalledWith('/');

    // A view still on screen may save again before the page unloads; that is cleared too.
    setSummary('site', SITE);
    window.localStorage.setItem('ce:v1:statuses:my-draft', '{}');
    window.dispatchEvent(new Event('pagehide'));
    expect(getSummary('site')).toBeNull();
    expect(window.localStorage.getItem('ce:v1:statuses:my-draft')).toBeNull();
  });
});
