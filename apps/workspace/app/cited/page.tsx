import type { Metadata } from 'next';
import { CitedView } from '@/components/cited/cited-view';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = {
  title: 'Who gets cited | Citation Equity',
  description:
    'Paste AI answers to your questions and see which sites they cite, with your own site first and one Do and one Avoid line for each kind of site.',
};

/** Who gets cited: the view itself is client-side, since it tallies pasted answers. */
export default function CitedPage() {
  return (
    <PageShell title="Who does AI cite?">
      <CitedView />
    </PageShell>
  );
}
