import type { Metadata } from 'next';
import { Redirect } from '@/components/redirect';
import { VIEW_HREF } from '@/lib/views';

export const metadata: Metadata = { title: 'Who gets cited | Citation Equity', robots: 'noindex' };

/** The old Off-page URL; the view is now Who gets cited. */
export default function OffPageRedirect() {
  return <Redirect to={VIEW_HREF.cited} label="Who gets cited" />;
}
