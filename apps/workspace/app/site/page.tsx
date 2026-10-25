import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell, textLink } from '@/components/page-shell';
import { SiteView } from '@/components/site/site-view';
import { RESEARCH_HREF } from '@/lib/views';

export const metadata: Metadata = {
  title: 'Your site | Citation Equity',
  description:
    'Can AI read your published page? Paste its HTML and robots.txt to check the author name, dates, schema, crawler access and text that loads without JavaScript, in your browser.',
};

/**
 * Your site: input first, then a compact result. Everything is checked in the browser
 * on pasted text; what needs the live page points to `ce site`.
 */
export default function SitePage() {
  return (
    <PageShell title="Can AI read your page?">
      <p className="mt-3 text-ink-soft leading-relaxed">
        AI search can only quote pages it can fetch and read. Paste your page's HTML to check it
        here.
      </p>
      <SiteView />
      <p className="mt-12 text-sm">
        <Link href={`${RESEARCH_HREF}#site`} className={textLink}>
          See the research
        </Link>
      </p>
    </PageShell>
  );
}
