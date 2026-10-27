import {
  CHECK_DEFINITIONS,
  type CheckDefinition,
  type CheckId,
  E1_DELTA,
  E1_MODELS,
  type Evidence,
  type EvidenceGrade,
  formatE1,
  formatE1Effect,
  GRADE_WEIGHTS,
  OFFPAGE_ADVICE,
  OWN_TEST_RESULTS,
  READINESS_EVIDENCE,
  SOURCE_KINDS,
  splitSentences,
  UNSCORED_CHECKS,
} from '@citation-equity/engine';
import type { Metadata } from 'next';
import { GradeLabel } from '@/components/grade-label';
import { Markdown } from '@/components/markdown';
import { PageShell, textLink } from '@/components/page-shell';
import { ROWS as SITE_ROWS } from '@/components/site/site-check';
import { checkDetails, REPO_URL, readEvidenceDoc } from '@/lib/evidence-doc';
import {
  CHECK_NAMES,
  E1_COMBINED_SENTENCE,
  GRADE_MEANING,
  GRADE_WORDS,
  ownTestWords,
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

/** Where each part of the page starts, so a link from a working screen lands on its detail. */
const CONTENTS = [
  ['#checks', 'Writing checks'],
  ['#site', 'Your site'],
  ['#off-page', 'Who gets cited'],
  ['#method', 'Method and limits'],
] as const;

/** The "Read <date>." stamp on a documentation source, which stays in docs. */
const undated = (citation: string) => citation.replace(/\s*Read \d{4}-\d{2}-\d{2}\.\s*$/, '');

/**
 * One site check or kind of cited site: its name, its grade, the evidence summary, and its
 * sources with what each says behind an expand. The working screens link here by `id`.
 */
function EvidenceCard({ id, name, evidence }: { id: string; name: string; evidence: Evidence }) {
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="scroll-mt-20 rounded-lg border bg-surface p-5 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="font-semibold text-lg">
          {name}
        </h3>
        <GradeLabel grade={evidence.grade} />
      </div>
      <p className="mt-2 leading-relaxed">{evidence.summary}</p>
      <details className="mt-3 text-sm">
        <summary className={summaryClass}>Sources ({evidence.sources.length})</summary>
        <ul className="mt-2 space-y-2 leading-relaxed">
          {evidence.sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer" className={textLink}>
                {undated(source.citation)}
              </a>
              <p className="mt-0.5 text-muted-foreground">{source.claim}</p>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** The results file of each of our own tests, on GitHub. */
const resultsUrl = (test: keyof typeof OWN_TEST_RESULTS) =>
  `${REPO_URL}/blob/main/${OWN_TEST_RESULTS[test]}`;

const summaryClass =
  'w-fit cursor-pointer rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring';

/**
 * A check's result in our own test (E1, or E3 for the seven checks it asked again): plain words,
 * and the exact numbers on expand, with a link to that test's results.
 */
function OwnTest({ def }: { def: CheckDefinition }) {
  const { e1 } = def.evidence;
  const words = ownTestWords(e1);
  return (
    <details className="mt-3 text-sm">
      <summary className={summaryClass}>{def.scored ? words : `${words} · Not scored`}</summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>
          {formatE1(e1)}.{' '}
          <a href={resultsUrl(e1.test)} target="_blank" rel="noreferrer" className={textLink}>
            {e1.test} results
          </a>
        </p>
        {e1.replication && <p>Replication: {formatE1Effect(e1.replication)}.</p>}
        {e1.followUp && <p>{e1.followUp}</p>}
        <p className="text-muted-foreground">{E1_MODELS}.</p>
        {!def.scored && <p>{UNSCORED_NOTES[def.id]}</p>}
      </div>
    </details>
  );
}

/**
 * The research behind each check: per check one grade and one plain sentence (the engine's
 * summary), our own tests' numbers and the rest of the summary, what the studies did
 * (docs/evidence.md), the weights and the sources behind an expand; then the same for each check
 * on Your site and each kind of site on Who gets cited; the method and its limits at the end.
 * Everything the working screens leave out lives here, at an anchor they link to (#check-<id>,
 * #site-<id>, #offpage-<kind>). The document's intro is not rendered: credit for the design
 * lives in the About dialog only.
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
        <a href={resultsUrl('E1')} target="_blank" rel="noreferrer" className={textLink}>
          our own test
        </a>{' '}
        found (or, for seven checks,{' '}
        <a href={resultsUrl('E3')} target="_blank" rel="noreferrer" className={textLink}>
          a second run with more pages
        </a>
        ), and links to the studies.
      </p>
      <p className="mt-3 leading-relaxed">{E1_COMBINED_SENTENCE}</p>
      <p className="mt-3 text-muted-foreground leading-relaxed">
        The data is open:{' '}
        <a
          href="https://huggingface.co/datasets/Shehral/citation-equity-experiments"
          target="_blank"
          rel="noreferrer"
          className={textLink}
        >
          every result and score
        </a>{' '}
        and, for research use,{' '}
        <a
          href="https://huggingface.co/datasets/Shehral/citation-equity-experiments-pages"
          target="_blank"
          rel="noreferrer"
          className={textLink}
        >
          the pages, prompts and answers
        </a>
        .
      </p>
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
      <nav aria-label="On this page" className="mt-6 text-sm">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {CONTENTS.map(([href, label]) => (
            <li key={href}>
              <a href={href} className={textLink}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div id="checks" className="mt-8 scroll-mt-20 space-y-4">
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

      <section id="site" aria-labelledby="site-title" className="mt-14 scroll-mt-20">
        <h2 id="site-title" className={H2}>
          Your site checks
        </h2>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          What the studies and the engines' own documentation say about each check on Your site.
          These are reported apart from the score.
        </p>
        <div className="mt-4 space-y-4">
          {SITE_ROWS.map((row) => (
            <EvidenceCard
              key={row.id}
              id={`site-${row.id}`}
              name={row.name}
              evidence={READINESS_EVIDENCE[row.id]}
            />
          ))}
        </div>
      </section>

      <section id="off-page" aria-labelledby="off-page-title" className="mt-14 scroll-mt-20">
        <h2 id="off-page-title" className={H2}>
          Who gets cited
        </h2>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          What the studies say about each kind of site AI answers cite, and the rules behind each
          Avoid line.
        </p>
        <div className="mt-4 space-y-4">
          {SOURCE_KINDS.map((kind) => (
            <EvidenceCard
              key={kind}
              id={`offpage-${kind}`}
              name={OFFPAGE_ADVICE[kind].title}
              evidence={OFFPAGE_ADVICE[kind].evidence}
            />
          ))}
        </div>
      </section>

      <section id="method" aria-labelledby="method-title" className="mt-14 scroll-mt-20">
        <h2 id="method-title" className={H2}>
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
          from four sources. A second run asked again, with more pages, for the seven checks the
          first had too few pages for, and its result replaces the first for them. Neither changes a
          grade. d is the change in citation score, where a page cited first scores 1 and an uncited
          page 0. No effect larger than {E1_DELTA} means a small effect either way is not ruled out.
        </p>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {GRADES.map((g) => (
            <div key={g} className="contents">
              <dt className="font-medium">{GRADE_WORDS[g]}</dt>
              <dd className="text-muted-foreground">{GRADE_MEANING[g]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 leading-relaxed">
          Your questions and the searches behind each question are helpers for planning what to
          write. They are not part of the score, and we have not tested whether they change which
          pages AI cites.
        </p>
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
