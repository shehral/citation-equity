import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell, textLink } from '@/components/page-shell';
import { SiteView } from '@/components/site/site-view';
import { RESEARCH_HREF } from '@/lib/views';

export const metadata: Metadata = {
  title: 'Your site | Citation Equity',
  description:
    'Can AI search reach your page? Paste its HTML and robots.txt to find what blocks crawlers, indexing or reading. Stays in your browser.',
};

/**
 * Your site: input first, then a compact result led by what blocks engines. Everything is
 * checked in the browser on pasted text; what needs the live page points to `ce site`.
 */
export default function SitePage() {
  return (
    <PageShell title="Can engines reach it?">
      <p className="mt-3 text-ink-soft leading-relaxed">
        Engines can't cite a page they can't fetch, index or read. Paste your page to check.
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
