// The draft view shows at most 350 words of interface text on load, not counting the
// draft itself. Counted on the real engine and the real example (26 fixes on the espresso
// draft), inside the app shell, so the header and footer count too.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftView } from '@/components/draft/draft-view';
import { AppShell } from '@/components/shell/app-shell';
import { SAMPLES } from '@/lib/samples';
import { clearAll, MY_POST_SLOT, setActiveSlot } from '@/lib/store';

vi.mock('next/navigation', () => ({
  usePathname: () => '/draft/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// CodeMirror needs layout that jsdom lacks; the stand-in holds the draft, which is not counted.
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

/** Words a reader sees in the document, leaving out the draft (the editor's text). */
function interfaceWords(): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('textarea, script, style')) continue;
    out.push(...(node.textContent ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)));
  }
  return out;
}

beforeEach(() => {
  localStorage.clear();
  clearAll();
});
afterEach(() => {
  cleanup();
  clearAll();
});

describe('draft view word budget', () => {
  for (const sample of SAMPLES) {
    it(`shows at most 350 words of interface text on load, for the ${sample.slug} example`, () => {
      setActiveSlot(sample.slug);
      render(
        <AppShell>
          <DraftView />
        </AppShell>,
      );
      // The example is loaded and analyzed: its fixes are on screen.
      expect(screen.getByRole('region', { name: 'Start here' })).toBeTruthy();
      const words = interfaceWords();
      expect(words.length, words.join(' ')).toBeLessThanOrEqual(350);
    });
  }

  it('shows at most 350 words for a new visitor on the empty My post', () => {
    setActiveSlot(MY_POST_SLOT);
    render(
      <AppShell>
        <DraftView />
      </AppShell>,
    );
    expect(interfaceWords().length).toBeLessThanOrEqual(350);
  });
});
