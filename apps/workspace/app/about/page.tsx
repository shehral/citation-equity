import { CAVEAT, DEFAULT_OLLAMA_HOST } from '@citation-equity/bench';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageShell, textLink } from '@/components/page-shell';
import { REPO_URL } from '@/lib/evidence-doc';
import { EVIDENCE_STANCE } from '@/lib/presets';

export const metadata: Metadata = {
  title: 'About | Citation Equity',
  description:
    "What Citation Equity is, the three modules of Prof. Akram Bayat's design, what the test bench is and is not, and who built it.",
};

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-10 mb-3 font-semibold text-xl">{children}</h2>;
}
function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 mb-2 font-semibold text-lg">{children}</h3>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="my-3 leading-relaxed">{children}</p>;
}
function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={textLink}>
      {children}
    </a>
  );
}

export default function AboutPage() {
  return (
    <PageShell title="About Citation Equity">
      <P>
        Citation Equity is a writing workspace for independent creators who want their pages to be
        easy for AI answer engines to use and cite. It checks a draft, shows how well research
        supports each check, and changes nothing in the draft unless the author clicks Apply on one
        suggestion. It is an open-source build of a three-module design by Prof. Akram Bayat. Her
        design document is not public; this page describes it in our own words.
      </P>

      <H2>The three modules</H2>
      <H3>Module A: the analysis engine</H3>
      <P>
        The engine reads a Markdown draft and runs ten checks. Six come from Prof. Bayat's design:
        standalone paragraphs, question headings, lists, statistics, tables and attributed quotes.
        Four more, cited sources, a direct answer first, target questions answered and explicit
        comparisons, were added because studies test them. Target questions start from a sample's
        pack, or from the questions the draft's own title and headings ask; more can be suggested
        from its title, headings and first paragraph with one click, and you can edit every one. The
        engine combines the checks into a GEO Score under two presets. The foundation preset follows
        her design: her six checks weigh the same and the four added checks weigh half as much. The
        evidence-weighted preset weights each check by how well studies support it. Her design names
        the checks; every threshold and weight in the code is ours, and you can change the weights.
      </P>
      <H3>Module B: the citation test bench</H3>
      <P>
        The bench puts a draft among a fixed set of competitor pages, retrieves the top pages for
        each reader question, and asks a small model running on your own computer (through Ollama)
        to answer with numbered citations. Repeated over several runs with different seeds and
        source orders, it reports how often the draft was retrieved and cited, and how much of each
        answer it supplied, with intervals, before and after a revision. Where Prof. Bayat's design
        has a nightly pipeline that watches live engines, this build ships the offline part, a
        disabled nightly template, and a command-line check of one live engine (Gemini with Google
        Search, through a Gemini API key you supply) that records whether its sources include your
        page.
      </P>
      <H3>Module C: the workspace</H3>
      <P>
        This site. The draft is on the left; the score, the checks with their evidence and weights,
        the suggestions and the bench are on the right. Each suggestion is either an edit you can
        preview side by side and apply, or advice you carry out yourself and mark done. An optional
        local model can propose wording for a piece of advice; it is shown side by side and applied
        only if you click. There is no button that applies everything at once.
      </P>

      <H2>What the bench is and is not</H2>
      <p className="my-3 rounded-md border-l-2 border-grade-mixed/60 pl-3 leading-relaxed">
        {CAVEAT}
      </p>
      <P>
        The bench is a controlled check of your content: the same questions, the same competitor
        pages and the same seeds for the before and after drafts, so a difference comes from your
        edit. It is not a measurement of ChatGPT, Perplexity, Google or any other live engine. It
        does not search the web, the model is small, and the competitor pages in the sample packs
        are synthetic, written for this project. A change that helps on the bench may do nothing on
        a live engine.
      </P>

      <H2>The evidence stance</H2>
      <P>
        {EVIDENCE_STANCE} Each check carries one of four grades (strong, moderate, mixed, untested),
        with the studies behind it. Where a study found no effect or a negative one, the check is
        graded mixed and the{' '}
        <Link href="/evidence" prefetch={false} className={textLink}>
          evidence page
        </Link>{' '}
        says so.
      </P>

      <H2>Privacy</H2>
      <P>
        Your draft stays in your browser. The site has no server and makes no network request,
        except to a local Ollama at {DEFAULT_OLLAMA_HOST} (or localhost:11434), and only after you
        click a button that says so.
      </P>

      <H2>Who made it</H2>
      <P>
        Prof. Akram Bayat is the principal investigator and the author of the original design: the
        three modules and the checks of the foundation preset. Mohammad Ali Shehral and Ishan Gupta
        built this version as part of SPARK research work at Northeastern University, Khoury College
        of Computer Sciences, San Jose.
      </P>

      <H2>Links</H2>
      <ul className="my-3 list-disc space-y-2 pl-6 leading-relaxed">
        <li>
          <Ext href={REPO_URL}>Source code: shehral/citation-equity</Ext> (MIT license)
        </li>
        <li>
          <Ext href="https://github.com/shehral/geo-measurement-prototype">
            shehral/geo-measurement-prototype
          </Ext>
          : the August 2026 pre-work for this project
        </li>
        <li>
          <Ext href="https://github.com/shehral/footnoteone">shehral/footnoteone</Ext>: FootnoteOne,
          a separate project; Citation Equity does not use or connect to it
        </li>
      </ul>
    </PageShell>
  );
}
