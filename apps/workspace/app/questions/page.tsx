import type { Metadata } from 'next';
import { PageShell } from '@/components/page-shell';
import { QuestionsView } from '@/components/questions/questions-view';

export const metadata: Metadata = {
  title: 'Your questions | Citation Equity',
  description:
    'Turn your keywords or your Search Console and Bing queries into the questions readers ask AI, ranked by search volume, with the searches behind each one. Stays in your browser.',
};

/** Your questions: the view itself is client-side, since the list lives in this browser. */
export default function QuestionsPage() {
  return (
    <PageShell title="What do your readers ask?">
      <QuestionsView />
    </PageShell>
  );
}
