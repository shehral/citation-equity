import type { Metadata } from 'next';
import { Redirect } from '@/components/redirect';
import { RESEARCH_HREF } from '@/lib/views';

export const metadata: Metadata = { title: 'Research | Citation Equity', robots: 'noindex' };

/** The old Evidence URL; the page is now Research. Anchors such as #lists carry over. */
export default function EvidenceRedirect() {
  return <Redirect to={RESEARCH_HREF} label="Research" />;
}
