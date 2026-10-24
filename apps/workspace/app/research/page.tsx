import {
  CHECK_DEFINITIONS,
  type CheckDefinition,
  type CheckId,
  E1_MODELS,
  type EvidenceGrade,
  formatE1,
  formatE1Effect,
  GRADE_WEIGHTS,
  splitSentences,
  UNSCORED_CHECKS,
} from '@citation-equity/engine';
import type { Metadata } from 'next';
import { GradeLabel } from '@/components/grade-label';
import { Markdown } from '@/components/markdown';
import { PageShell, textLink } from '@/components/page-shell';
import { checkDetails, REPO_URL, readEvidenceDoc } from '@/lib/evidence-doc';
import {
  CHECK_NAMES,
  E1_COMBINED_SENTENCE,
  E1_WORDS,
  GRADE_MEANING,
  GRADE_WORDS,
  PLAIN_LEADS,
  UNSCORED_NOTES,
} from '@/lib/glossary';

export const metadata: Metadata = {
  title: 'Research | Citation Equity',
  description: 'How well published studies support each check of the AI-ready score, with sources.',
};

const GRADES: EvidenceGrade[] = ['strong', 'moderate', 'mixed', 'untested'];

/** Why the score is not a forecast. */
const LIMITS = [
  'Most tests hand the page straight to the AI; real search has to find it first.',
  'Studies disagree: tricks that helped in one failed in larger ones.',
  'Engines differ and change.',
  'Our weights are our choice, and you can change them.',
];

const STRONG = CHECK_DEFINITIONS.filter((d) => d.evidence.grade === 'strong').length;

/** The plain lead for a check, and the rest of its engine summary (all of it after a plain lead). */
function splitSummary(id: CheckId, summary: string): { lead: string; rest: string } {
  const plain = PLAIN_LEADS[id];
  if (plain) return { lead: plain, rest: summary };
  const sentences = splitSentences(summary, 0);
  const lead = sentences[0]?.text ?? summary;
  return {
    lead,
    rest: sentences
      .slice(1)
      .map((s) => s.text)
      .join(' '),
  };
}

const H2 = 'font-medium font-serif text-2xl';

const E1_RESULTS_URL = `${REPO_URL}/blob/main/experiments/RESULTS_E1.md`;

const summaryClass =
  'w-fit cursor-pointer rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring';

/** A check's result in our own test (E1): plain words, and the exact numbers on expand. */
function OwnTest({ def }: { def: CheckDefinition }) {
  const { e1 } = def.evidence;
  const words = E1_WORDS[e1.label];
  return (
    <details className="mt-3 text-sm">
      <summary className={summaryClass}>{def.scored ? words : `${words} · Not scored`}</summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>{formatE1(e1)}.</p>
        {e1.replication && <p>Replication: {formatE1Effect(e1.replication)}.</p>}
        <p className="text-muted-foreground">{E1_MODELS}.</p>
        {!def.scored && <p>{UNSCORED_NOTES[def.id]}</p>}
      </div>
    </details>
  );
}

/**
 * The research behind each check: per check one grade and one plain sentence (the engine's
 * summary), with the rest of the summary, what the studies did (docs/evidence.md), the weights
 * and the sources behind an expand; the method and its limits in one section at the end. The
 * document's intro is not rendered: credit for the design lives in the About dialog only.
 */
export default function ResearchPage() {
  const details = checkDetails(readEvidenceDoc());
  const tally = GRADES.map((g) => ({
    grade: g,
    count: CHECK_DEFINITIONS.filter((d) => d.evidence.grade === g).length,
  })).filter((t) => t.count > 0);

  return (
    <PageShell title="The research behind each check">
      <p className="mt-4 font-serif text-xl leading-snug">
        {STRONG === 0
          ? 'Short answer: none of the checks is proven yet. Treat the score as a writing checklist.'
          : `Short answer: ${STRONG} of ${CHECK_DEFINITIONS.length} checks have strong evidence. Treat the score as a writing checklist.`}
      </p>
      <p className="mt-3 text-muted-foreground leading-relaxed">
        Each check below shows its grade, what the studies found, what{' '}
        <a href={E1_RESULTS_URL} target="_blank" rel="noreferrer" className={textLink}>
          our own test
        </a>{' '}
        found, and links to the studies.
      </p>
      <p className="mt-3 leading-relaxed">{E1_COMBINED_SENTENCE}</p>
      <ul
        aria-label={`Grades of the ${CHECK_DEFINITIONS.length} checks`}
        className="mt-4 flex flex-wrap gap-2"
      >
        {tally.map((t) => (
          <li
            key={t.grade}
            className="flex items-center gap-2 rounded-full border bg-surface px-3 py-1 text-sm"
          >
            <span className="font-semibold tabular-nums">{t.count}</span>
            <GradeLabel grade={t.grade} />
          </li>
        ))}
      </ul>

      <div className="mt-8 space-y-4">
        {CHECK_DEFINITIONS.map((def) => {
          const headingId = `check-${def.id}-title`;
          const { lead, rest } = splitSummary(def.id, def.evidence.summary);
          return (
            <section
              key={def.id}
              id={`check-${def.id}`}
              aria-labelledby={headingId}
              className="scroll-mt-20 rounded-lg border bg-surface p-5 shadow-card"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 id={headingId} className="font-semibold text-lg">
                  {CHECK_NAMES[def.id]}
                </h2>
                <GradeLabel grade={def.evidence.grade} />
              </div>
              <p className="mt-2 leading-relaxed">{lead}</p>
              <OwnTest def={def} />
              <details className="mt-3 text-sm">
                <summary className={summaryClass}>Studies ({def.evidence.sources.length})</summary>
                <div className="mt-2 leading-relaxed">
                  {rest && <p className="my-3">{rest}</p>}
                  <p className="my-3">
                    <span className="font-medium">What it checks. </span>
                    {def.description}
                  </p>
                  <Markdown nodes={details[def.id] ?? []} />
                  <p className="my-3 text-muted-foreground">
                    Weights: {def.defaultWeights.foundation} standard ·{' '}
                    {def.defaultWeights.evidence} by evidence
                  </p>
                  <ul className="mt-3 space-y-2">
                    {def.evidence.sources.map((source) => (
                      <li key={source.id}>
                        <a href={source.url} target="_blank" rel="noreferrer" className={textLink}>
                          {source.citation}
                        </a>
                        <p className="mt-0.5 text-muted-foreground">{source.claim}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </section>
          );
        })}
      </div>

      <section aria-labelledby="method" className="mt-14">
        <h2 id="method" className={H2}>
          Method and limits
        </h2>
        <p className="mt-3 leading-relaxed">
          A grade describes the research, not your draft. Scoring by evidence uses it as the weight:
          strong {GRADE_WEIGHTS.strong}, moderate {GRADE_WEIGHTS.moderate}, mixed{' '}
          {GRADE_WEIGHTS.mixed}, untested {GRADE_WEIGHTS.untested}.
          {UNSCORED_CHECKS.map((id) => ` ${UNSCORED_NOTES[id]}`).join('')}
        </p>
        <p className="mt-3 leading-relaxed">
          Our own test applied each check's fix to real pages and asked two local models to answer
          from four sources. It changes no grade. d is the change in citation score, where a page
          cited first scores 1 and an uncited page 0.
        </p>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {GRADES.map((g) => (
            <div key={g} className="contents">
              <dt className="font-medium">{GRADE_WORDS[g]}</dt>
              <dd className="text-muted-foreground">{GRADE_MEANING[g]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 font-medium">Why the score isn't a forecast</p>
        <ul className="mt-2 list-disc space-y-1 pl-6 leading-relaxed">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-5 text-muted-foreground text-sm">
          The{' '}
          <a
            href={`${REPO_URL}/blob/main/docs/evidence.md`}
            target="_blank"
            rel="noreferrer"
            className={textLink}
          >
            full evidence document
          </a>{' '}
          has the grading rules and the studies; the{' '}
          <a
            href={`${REPO_URL}/blob/main/docs/research/evidence-notes.md`}
            target="_blank"
            rel="noreferrer"
            className={textLink}
          >
            reading notes
          </a>{' '}
          have the quotes.
        </p>
      </section>
    </PageShell>
  );
}
