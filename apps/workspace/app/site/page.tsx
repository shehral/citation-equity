import { AI_CRAWLERS } from '@citation-equity/bench';
import { READINESS_NOTE } from '@citation-equity/engine';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PageShell, textLink } from '@/components/page-shell';
import { Command } from '@/components/panel/ollama-help';
import { CE_SITE_EXAMPLE, ReadinessReport } from '@/components/readiness-report';
import { REPO_URL } from '@/lib/evidence-doc';

export const metadata: Metadata = {
  title: 'Site readiness | Citation Equity',
  description:
    'Whether a published page can be found and read by AI answer engines: crawler access, rendering without JavaScript and page metadata. Reported apart from the GEO Score.',
};

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-10 mb-3 font-semibold text-xl">{children}</h2>;
}

/**
 * Site readiness: page-level items run in the browser on pasted HTML (no network request);
 * crawler access and rendering need `ce site <url>`, since the browser cannot fetch other sites.
 */
export default function SitePage() {
  return (
    <PageShell title="Site readiness">
      <p className="mt-4 rounded-md border-l-2 border-grade-mixed/60 pl-3 leading-relaxed">
        {READINESS_NOTE} Readiness describes the published page and its site, not your draft, and no
        readiness item changes a score.
      </p>
      <p className="my-3 leading-relaxed">
        An answer engine can only use a page it is allowed to fetch, can read, and may quote. These
        seven items check that. Five read the page's own HTML and run here: paste the HTML below.
        The other two, crawler access and rendering without JavaScript, need a fetch of the live
        site, so they run from the command line. Each item carries an evidence grade, the same four
        grades as the checks; for readiness, an answer engine's own documentation counts as
        evidence. The{' '}
        <a
          href={`${REPO_URL}/blob/main/docs/evidence.md#site-readiness`}
          target="_blank"
          rel="noreferrer"
          className={textLink}
        >
          evidence notes
        </a>{' '}
        give the rules and the sources.
      </p>

      <ReadinessReport />

      <H2>From the command line</H2>
      <p className="my-3 leading-relaxed">
        <code className="font-mono text-sm">ce site</code> reads the site's robots.txt, fetches the
        page once without running JavaScript, and reports all seven items. In a copy of the
        repository:
      </p>
      <Command>
        {[
          'pnpm install && pnpm --filter "@citation-equity/bench..." build',
          'alias ce="node packages/bench/bin/ce.js"',
          CE_SITE_EXAMPLE,
          `${CE_SITE_EXAMPLE} --json`,
        ].join('\n')}
      </Command>

      <H2>The crawlers it checks</H2>
      <p className="my-3 leading-relaxed">
        Each token, operator and purpose comes from the operator's own documentation, linked below.
        Blocking an AI search, user-fetch or search engine crawler (Googlebot, Bingbot, Applebot)
        fails the crawler check, since a page those crawlers may not fetch can drop out of that
        engine's results and the answers built on them. Blocking training crawlers is a fair choice
        and gives a warning. OpenAI and Perplexity say their user-fetch agents may not follow
        robots.txt, because a person asked for the page.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">AI crawlers checked by ce site</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Token
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Operator
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Purpose
              </th>
              <th scope="col" className="py-2 font-medium">
                Documentation
              </th>
            </tr>
          </thead>
          <tbody>
            {AI_CRAWLERS.map((c) => (
              <tr key={c.userAgent} className="border-b last:border-b-0">
                <th scope="row" className="py-2 pr-4 font-mono font-normal">
                  {c.userAgent}
                </th>
                <td className="py-2 pr-4">{c.operator}</td>
                <td className="py-2 pr-4">{c.purpose}</td>
                <td className="py-2">
                  <a href={c.docsUrl} target="_blank" rel="noreferrer" className={textLink}>
                    {new URL(c.docsUrl).hostname}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
