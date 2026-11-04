// Your site says nothing about the evidence (test/quiet.ts), with every row open.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SitePage from '@/app/site/page';
import { AppShell } from '@/components/shell/app-shell';
import { runExample } from '@/lib/examples';
import { expectQuiet, resetScreens } from './quiet';

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

describe('Your site says nothing about the evidence', () => {
  it('on the example page, every row open', () => {
    path.current = '/site/';
    act(() => runExample());
    render(
      <AppShell>
        <SitePage />
      </AppShell>,
    );
    expect(screen.getAllByText('Why it matters').length).toBeGreaterThan(0);
    // The other page notes, with their label chip, are part of the screen checked.
    expect(screen.getByText('Other page notes (4)')).toBeTruthy();
    expect(document.querySelector('[data-label-chip="not-tested"]')).not.toBeNull();
    for (const d of document.querySelectorAll('details')) d.open = true;
    expectQuiet('site');
  });
});
