// The draft view says nothing about the evidence (test/quiet.ts), with everything opened.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftView } from '@/components/draft/draft-view';
import { AppShell } from '@/components/shell/app-shell';
import { SAMPLES } from '@/lib/samples';
import { setActiveSlot } from '@/lib/store';
import { expectQuiet, openDraftView, resetScreens } from './quiet';

const path = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => path.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// CodeMirror needs layout that jsdom lacks; the stand-in holds the draft, which is not checked.
vi.mock('@/components/editor/markdown-editor', async () => {
  const { forwardRef } = await import('react');
  return {
    MarkdownEditor: forwardRef<unknown, { value: string; ariaLabel: string }>(function FakeEditor({
      value,
      ariaLabel,
    }) {
      return <textarea aria-label={ariaLabel} value={value} readOnly />;
    }),
  };
});

beforeEach(resetScreens);
afterEach(() => {
  cleanup();
  resetScreens();
});

describe('the draft view says nothing about the evidence', () => {
  for (const sample of SAMPLES) {
    it(`everything open, on the ${sample.slug} example`, () => {
      path.current = '/draft/';
      setActiveSlot(sample.slug);
      render(
        <AppShell>
          <DraftView />
        </AppShell>,
      );
      expect(screen.getByRole('region', { name: 'Start here' })).toBeTruthy();
      openDraftView();
      // The editor and the groups are open, with the notes' cards inside.
      expect(screen.getByRole('textbox', { name: 'New question' })).toBeTruthy();
      expect(
        within(screen.getByRole('region', { name: 'Writing notes' })).getAllByRole('article')
          .length,
      ).toBeGreaterThan(0);
      expectQuiet(`draft (${sample.slug})`);
    });
  }
});
