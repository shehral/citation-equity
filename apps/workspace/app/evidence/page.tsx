import { CHECK_DEFINITIONS, GRADE_WEIGHTS } from '@citation-equity/engine';
import type { Metadata } from 'next';
import { Markdown } from '@/components/markdown';
import { PageShell, textLink } from '@/components/page-shell';
import { evidenceIntro, REPO_URL, readEvidenceDoc } from '@/lib/evidence-doc';
import { EVIDENCE_STANCE, PRESET_LABELS } from '@/lib/presets';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Evidence | Citation Equity',
  description: 'How well published studies support each check of the GEO Score, with sources.',
};

const GRADE_CLASS = {
  strong: 'border-grade-strong/50 text-grade-strong',
  moderate: 'border-grade-moderate/50 text-grade-moderate',
  mixed: 'border-grade-mixed/50 text-grade-mixed',
  untested: 'border-grade-untested/50 text-grade-untested',
} as const;

/**
 * The check registry as a page: each check's grade, summary, sources and both
 * preset weights, after the intro of docs/evidence.md (read at build time).
 */
export default function EvidencePage() {
  const intro = evidenceIntro(readEvidenceDoc());
  return (
    <PageShell title="Evidence behind the checks">
      <p className="mt-4 rounded-md border-l-2 border-grade-mixed/60 pl-3 leading-relaxed">
        {EVIDENCE_STANCE}
      </p>
      <Markdown nodes={intro} />

      <h2 className="mt-10 mb-2 font-semibold text-xl">The checks</h2>
      <p className="leading-relaxed">
        In the {PRESET_LABELS.evidence} preset a check's weight follows its grade: strong{' '}
        {GRADE_WEIGHTS.strong}, moderate {GRADE_WEIGHTS.moderate}, mixed {GRADE_WEIGHTS.mixed},
        untested {GRADE_WEIGHTS.untested}. The {PRESET_LABELS.foundation} preset follows Prof. Akram
        Bayat's design. You can change every weight in the workspace. The{' '}
        <a
          href={`${REPO_URL}/blob/main/docs/evidence.md`}
          target="_blank"
          rel="noreferrer"
          className={textLink}
        >
          full evidence document
        </a>{' '}
        describes what each study did.
      </p>
      <div className="mt-6 space-y-6">
        {CHECK_DEFINITIONS.map((def) => {
          const headingId = `check-${def.id}`;
          return (
            <section
              key={def.id}
              aria-labelledby={headingId}
              className="rounded-lg border bg-card p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id={headingId} className="font-semibold text-lg">
                  {def.title}
                </h3>
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 font-medium text-xs',
                    GRADE_CLASS[def.evidence.grade],
                  )}
                >
                  Evidence: {def.evidence.grade}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground text-xs">
                <code className="font-mono">{def.id}</code>,{' '}
                {def.inFoundationDesign
                  ? "in Prof. Bayat's foundation design"
                  : 'added from the research literature'}
              </p>
              <p className="mt-2 leading-relaxed">{def.description}</p>
              <p className="mt-2 leading-relaxed">{def.evidence.summary}</p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm">
                <li>
                  {PRESET_LABELS.foundation} weight {def.defaultWeights.foundation}
                </li>
                <li>
                  {PRESET_LABELS.evidence} weight {def.defaultWeights.evidence}
                </li>
              </ul>
              <h4 className="mt-3 font-medium text-sm">Sources</h4>
              <ul className="mt-1 space-y-2 text-sm">
                {def.evidence.sources.map((source) => (
                  <li key={source.id}>
                    <a href={source.url} target="_blank" rel="noreferrer" className={textLink}>
                      {source.citation}
                    </a>
                    <p className="mt-0.5 text-muted-foreground">{source.claim}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </PageShell>
  );
}
