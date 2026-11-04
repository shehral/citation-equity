import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AboutRedirect from '@/app/about/page';
import EvidenceRedirect from '@/app/evidence/page';
import OffPageRedirect, { metadata as offPageMetadata } from '@/app/off-page/page';
import QuestionsRedirect, { metadata as questionsMetadata } from '@/app/questions/page';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, prefetch: vi.fn() }),
}));

beforeEach(() => {
  nav.replace.mockReset();
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

// router.replace and next/link add NEXT_PUBLIC_BASE_PATH themselves, so the targets here are
// base-path free; test/base-path-build.test.ts checks the built links under /citation-equity/.
describe.each([
  ['/questions/', QuestionsRedirect, '/', 'Your questions'],
  ['/off-page/', OffPageRedirect, '/cited/', 'Results'],
  ['/evidence/', EvidenceRedirect, '/research/', 'Research'],
  ['/about/', AboutRedirect, '/#about', 'About'],
])('%s', (_old, Page, target, label) => {
  it(`replaces the URL with ${target} and shows a link there meanwhile`, () => {
    render(<Page />);
    expect(nav.replace).toHaveBeenCalledWith(target);
    const link = screen.getByRole('link', { name: label });
    // Under Vitest next/link drops the trailing slash that the static build keeps.
    expect(link.getAttribute('href')?.replace(/(.)\/$/, '$1')).toBe(target.replace(/(.)\/$/, '$1'));
    expect(document.body.textContent).toContain('This page moved');
  });
});

describe('/questions/, now the home', () => {
  it('is kept out of search results, under its old title', () => {
    expect(questionsMetadata).toMatchObject({
      title: 'Your questions | Citation Equity',
      robots: 'noindex',
    });
  });

  it('keeps the hash', () => {
    window.history.replaceState(null, '', '/questions/#list');
    render(<QuestionsRedirect />);
    expect(nav.replace).toHaveBeenCalledWith('/#list');
  });
});

describe('/off-page/, now Results', () => {
  it("is kept out of search results, under its new page's title", () => {
    expect(offPageMetadata).toMatchObject({
      title: 'Results | Citation Equity',
      robots: 'noindex',
    });
  });
});

describe('a redirect with a hash', () => {
  it('keeps the old anchor when the target has none', () => {
    window.history.replaceState(null, '', '/evidence/#lists');
    render(<EvidenceRedirect />);
    expect(nav.replace).toHaveBeenCalledWith('/research/#lists');
  });

  it('keeps its own anchor otherwise', () => {
    window.history.replaceState(null, '', '/about/#team');
    render(<AboutRedirect />);
    expect(nav.replace).toHaveBeenCalledWith('/#about');
  });
});
