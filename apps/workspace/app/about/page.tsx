import type { Metadata } from 'next';
import { Redirect } from '@/components/redirect';
import { ABOUT_HREF } from '@/lib/views';

export const metadata: Metadata = { title: 'About | Citation Equity', robots: 'noindex' };

/** The old About page; About is now a dialog, opened on the home by its #about hash. */
export default function AboutRedirect() {
  return <Redirect to={ABOUT_HREF} label="About" />;
}
