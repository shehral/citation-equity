import type { Metadata } from 'next';
import { CitedView } from '@/components/cited/cited-view';
import { TestPanel } from '@/components/cited/test-panel';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = {
  title: 'Results | Citation Equity',
  description:
    'Test your draft before and after on a local AI, and see which sites AI answers cite. Stays in your browser.',
};

const H2 = 'font-medium font-serif text-2xl';

/**
 * Results, the last step: Test before and after on the open draft (#test), then who live AI
 * search cites (#cited). Both views are client-side; this page only lays them out.
 */
export default function CitedPage() {
  return (
    <PageShell title="Did it change anything?">
      <p className="mt-3 text-ink-soft leading-relaxed">
        Test your draft before and after on a local AI, or see who live AI search cites.
      </p>

      <section id="test" aria-labelledby="test-title" className="mt-10 scroll-mt-20">
        <h2 id="test-title" className={H2}>
          Test before and after
        </h2>
        <p className="mt-2 text-ink-soft">
          Open models answer from fixed sources, so this shows a direction at most.
        </p>
        {/* The panel's own text sizes were set for a small-text container. */}
        <div className="mt-4 rounded-lg border bg-surface p-4 text-sm shadow-card">
          <TestPanel />
        </div>
      </section>

      <section id="cited" aria-labelledby="cited-title" className="mt-14 scroll-mt-20">
        <h2 id="cited-title" className={H2}>
          Who AI search cites
        </h2>
        <CitedView />
      </section>
    </PageShell>
  );
}
