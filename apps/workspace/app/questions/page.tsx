import type { Metadata } from 'next';
import { Redirect } from '@/components/redirect';
import { VIEW_HREF } from '@/lib/views';

export const metadata: Metadata = { title: 'Your questions | Citation Equity', robots: 'noindex' };

/** The old Your questions URL; the view is now the home. Anchors carry over. */
export default function QuestionsRedirect() {
  return <Redirect to={VIEW_HREF.home} label="Your questions" />;
}
