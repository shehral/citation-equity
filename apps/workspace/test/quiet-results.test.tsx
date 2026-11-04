// Results (Test before and after, Who gets cited) says nothing about the evidence (test/quiet.ts).
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CitedPage from '@/app/cited/page';
import { AppShell } from '@/components/shell/app-shell';
import { runExample } from '@/lib/examples';
import { MY_DRAFT_SLUG } from '@/lib/samples';
import { saveDraft } from '@/lib/storage';
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

const renderResults = () => {
  path.current = '/cited/';
  render(
    <AppShell>
      <CitedPage />
    </AppShell>,
  );
  for (const d of document.querySelectorAll('details')) d.open = true;
};

describe('Results says nothing about the evidence', () => {
  it('Test before and after and Who gets cited, on the example, every detail open', () => {
    act(() => runExample());
    renderResults();
    expect(screen.getByRole('region', { name: 'Sample result' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /^Learn more/ }).length).toBeGreaterThan(0);
    expectQuiet('cited');
  });

  it('Test before and after on My post', () => {
    saveDraft(MY_DRAFT_SLUG, '# Cold brew at home\n\nSteep coarse grounds overnight.');
    renderResults();
    expect(screen.getByLabelText('Load a test pack')).toBeTruthy();
    expectQuiet('cited, my post');
  });
});
