import type { Metadata } from 'next';
import { Redirect } from '@/components/redirect';
import { VIEW_HREF } from '@/lib/views';

export const metadata: Metadata = { title: 'Results | Citation Equity', robots: 'noindex' };

/** The old Off-page URL; its view is now part of Results. */
export default function OffPageRedirect() {
  return <Redirect to={VIEW_HREF.cited} label="Results" />;
}
