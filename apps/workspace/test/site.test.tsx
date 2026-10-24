import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_CRAWLERS } from '@citation-equity/bench';
import { READINESS_EVIDENCE, READINESS_NOTE, READINESS_TITLES } from '@citation-equity/engine';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SitePage from '@/app/site/page';
import { PageShell } from '@/components/page-shell';

// Under jsdom import.meta.url is not a file: URL, so the fixture is found from __dirname.
const BLOG_POSTING = readFileSync(
  join(__dirname, '../../../packages/engine/test/fixtures/readiness/blogposting.html'),
  'utf8',
);
const EM_DASH = '—';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const region = (title: string) => screen.getByRole('region', { name: title });

describe('/site', () => {
  it('renders the seven readiness items, each with its grade and plain-language summary', () => {
    render(<SitePage />);
    const titles = Object.values(READINESS_TITLES);
    expect(titles).toHaveLength(7);
    for (const [id, title] of Object.entries(READINESS_TITLES)) {
      const text = region(title).textContent ?? '';
      const evidence = READINESS_EVIDENCE[id as keyof typeof READINESS_EVIDENCE];
      expect(text, id).toContain(`Evidence: ${evidence.grade}`);
      expect(text, id).toContain(evidence.summary);
      expect(text, id).toContain('Not checked');
    }
    expect(document.body.textContent).toContain(READINESS_NOTE);
  });

  it('marks byline pass when the BlogPosting fixture HTML is pasted, without any request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<SitePage />);
    fireEvent.change(screen.getByLabelText('Page HTML'), { target: { value: BLOG_POSTING } });
    expect(region('Byline').textContent).toContain('Pass');
    expect(region('Byline').textContent).toContain('JSON-LD author (A)');
    expect(region('Structured data').textContent).toContain('BlogPosting');
    expect(region('Indexing directives').textContent).toContain('Pass');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the ce site command for the two checks the browser cannot run', () => {
    render(<SitePage />);
    for (const title of ['AI crawler access', 'Renders without JavaScript']) {
      expect(within(region(title)).getByText(/ce site https:\/\//)).toBeTruthy();
    }
  });

  it('lists every crawler ce site checks, linked to its operator documentation', () => {
    render(<SitePage />);
    const table = screen.getByRole('table', { name: 'AI crawlers checked by ce site' });
    for (const c of AI_CRAWLERS) {
      const row = within(table).getByRole('row', { name: new RegExp(`^${c.userAgent} `) });
      expect(row.textContent).toContain(c.operator);
      expect(row.textContent).toContain(c.purpose);
      expect(within(row).getByRole('link').getAttribute('href')).toBe(c.docsUrl);
    }
  });

  it('uses no em dash and never the retired grade word', () => {
    render(<SitePage />);
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
    expect(within(nav).getByRole('link', { name: 'Site readiness' }).getAttribute('href')).toBe(
      '/site',
    );
  });
});
