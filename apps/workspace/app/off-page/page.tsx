import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { OffPageReport } from '@/components/offpage-report';
import { PageShell, textLink } from '@/components/page-shell';
import { Command } from '@/components/panel/ollama-help';
import { REPO_URL } from '@/lib/evidence-doc';

export const metadata: Metadata = {
  title: 'Off-page | Citation Equity',
  description:
    'Which sites AI answers cite for your own questions, grouped by kind, with evidence-graded advice on being present there honestly. Pasted answers are read in your browser and sent nowhere.',
};

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-10 mb-3 font-semibold text-xl">{children}</h2>;
}

/**
 * Off-page guidance: the author pastes answers copied from an AI assistant, one box per question;
 * the URLs are tallied in the browser with no network request.
 */
export default function OffPagePage() {
  return (
    <PageShell title="Off-page">
      <p className="my-3 leading-relaxed">
        AI answers cite other people's pages as well as yours: forums, Wikipedia, videos, reviews,
        news. Part of being cited is being present, accurately and openly, where answer engines
        already look. This page shows where that is for your own questions, and what you can do
        about each kind of site without spam, undisclosed self-promotion or fake reviews. Like site
        readiness, it is not part of the GEO Score.
      </p>
      <p className="my-3 leading-relaxed">
        Ask ChatGPT, Perplexity, Gemini or Copilot one of your questions, copy the answer with its
        sources, and paste it below, one box per question. The links are read in this browser and
        nothing is sent anywhere. This tool never posts, contacts anyone or reads AI apps for you.
        The{' '}
        <a
          href={`${REPO_URL}/blob/main/docs/evidence.md#off-page`}
          target="_blank"
          rel="noreferrer"
          className={textLink}
        >
          evidence notes
        </a>{' '}
        give the grading rules and every source.
      </p>

      <OffPageReport />

      <H2>From the command line</H2>
      <p className="my-3 leading-relaxed">
        <code className="font-mono text-sm">ce sources</code> prints the same report from a{' '}
        <code className="font-mono text-sm">ce live</code> report, or from a text file of pasted
        answers where each answer starts with a line{' '}
        <code className="font-mono text-sm">Q: your question</code>. It reads the file only and
        makes no request. In a copy of the repository:
      </p>
      <Command>
        {[
          'pnpm install && pnpm --filter "@citation-equity/bench..." build',
          'alias ce="node packages/bench/bin/ce.js"',
          'ce sources --pasted answers.txt --own example.com',
          'ce sources --live results/live-gemini.json',
        ].join('\n')}
      </Command>
    </PageShell>
  );
}
