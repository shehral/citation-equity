import {
  CHECK_DEFINITIONS,
  CHECK_IDS,
  type CheckDefinition,
  type CheckId,
  E1_DELTA,
  E1_MODELS,
  E5_PATHS,
  E5_RESULTS,
  E5_TEXT,
  type E5Results,
  type E5Row,
  type Evidence,
  type EvidenceGrade,
  formatE1,
  formatE1Effect,
  helpedChecks,
  OFFPAGE_ADVICE,
  OWN_TEST_RESULTS,
  plannedRows,
  QUESTION_CHECKS,
  READINESS_EVIDENCE,
  SOURCE_KINDS,
  shortAnswer,
  splitSentences,
  TEST_LABEL_TEXT,
  TEST_LABELS,
  type TestLabel,
} from '@citation-equity/engine';
import type { Metadata } from 'next';
import { LabelChip } from '@/components/check-chip';
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
  type LabelContext,
  labelFor,
  labelTooltip,
  labelWords,
  ownTestWords,
  PLAIN_LEADS,
} from '@/lib/glossary';

export const metadata: Metadata = {
  title: 'Research | Citation Equity',
  description:
    'What published studies and our own tests found for each writing check, with sources.',
};

const GRADES: EvidenceGrade[] = ['strong', 'moderate', 'mixed', 'untested'];

/** Why the labels are not a forecast. */
const LIMITS = [
  'Most tests hand the page straight to the AI; real search has to find it first.',
  'Studies disagree: tricks that helped in one failed in larger ones.',
  'Engines differ and change.',
  'The effects we found are small: about 0.03 on a 0-to-1 citation score.',
];

/**
 * Whose questions the measured label covers, under the short answer; E5 reads in the past once
 * it has run.
 */
const labelScope = (e5Done: boolean) =>
  `That label covers the reader's own questions; E5 ${e5Done ? 'tested' : 'tests'} guesses made from a keyword.`;

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
  ['#e5', 'When the question is a guess'],
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
 * What E5's step 5 measured: the reader's own question section over every main query with a valid
 * edit, E1's included, with the run's count of them when it has one.
 */
const step5Name = (row: E5Row | null) =>
  `9 vs original over every main query with a valid edit${row?.n == null ? '' : ` (${row.n})`}, a cumulative estimate that includes E1's queries`;

/** A contrast's numbers as /research words them: d with its 95% interval, n, and Holm p where corrected. */
function e5Numbers(row: E5Row): string | null {
  if (row.d === null || row.ci95 === null || row.n === null) return null;
  return formatE1Effect({
    d: row.d,
    ci: row.ci95,
    level: 95,
    n: row.n,
    ...(row.p_holm === null ? {} : { holmP: row.p_holm }),
  });
}

/**
 * One E5 contrast's result: its label in words (for a retention contrast, the reading of whether
 * the guess keeps the gain), its numbers, and the flags for a single judge model and for answers
 * from an earlier run; "not run" when the run has no row for it.
 */
function e5Result(row: E5Row | null, results: E5Results): string {
  if (row === null) return 'not run';
  const reading =
    row.step === 'retention' ? results.readings.retention[row.arm as '9K' | '9L'] : undefined;
  const numbers = e5Numbers(row);
  const flags = [row.single_model && 'Gemma only', row.cross_run && 'earlier run'].filter(Boolean);
  return [
    `${reading ?? labelWords(row.label)}${numbers === null ? '' : ` (${numbers})`}`,
    ...flags,
  ].join(', ');
}

/**
 * How a planned contrast is named in the list: the gate and step 5 say what they measure, with
 * the run's count of queries that had a valid edit.
 */
function plannedName({
  step,
  contrast,
  row,
}: {
  step: string;
  contrast: string;
  row: E5Row | null;
}): string {
  if (step === 'gate')
    return `The gate, ${contrast} on new queries${row?.n == null ? '' : ` (${row.n} with a valid edit)`}`;
  if (step === 'step5') return `Step 5, ${step5Name(row)}`;
  return contrast;
}

/** Step 5's result, for the question section's card beside E1's. */
function step5Sentence(results: E5Results): string {
  const step5 = plannedRows(results).find((p) => p.step === 'step5')?.row ?? null;
  return `E5 step 5, ${step5Name(step5)}: ${e5Result(step5, results)}.`;
}

/** The own-test result behind step 5's words, for the tooltip of an Unclear label it set. */
const STEP5_REASONS: Record<string, LabelContext['e1']> = {
  inconclusive: 'inconclusive',
  'insufficient n': 'insufficient-n',
  'model-dependent': 'model-dependent',
};

/**
 * The tooltip of a check card's label. The two question checks speak of the reader's own
 * questions; an Unclear label says why from the own-test result behind it (step 5's, once it ran,
 * for the question section).
 */
function cardTooltip(def: CheckDefinition, label: TestLabel, e5: E5Results | null): string {
  const e1 = def.evidence.e1.label;
  if (!QUESTION_CHECKS.includes(def.id)) return labelTooltip(label, { e1 });
  const step5 =
    def.id === 'question-coverage' && e5 !== null
      ? STEP5_REASONS[e5.readings.readers_words_label]
      : undefined;
  return labelTooltip(label, { input: 'reader', e1: step5 ?? e1 });
}

/** How many of the eleven checks carry each label, in the engine's order of the labels. */
function labelTally(labels: Record<CheckId, TestLabel>): { label: TestLabel; count: number }[] {
  return (Object.keys(TEST_LABEL_TEXT) as TestLabel[])
    .map((label) => ({ label, count: CHECK_IDS.filter((id) => labels[id] === label).length }))
    .filter((t) => t.count > 0);
}

/**
 * A check's result in our own test (E1, or E3 for the seven checks it asked again): plain words,
 * and the exact numbers on expand, with a link to that test's results. Once E5 has run, the
 * question section's card also gives step 5's pooled result.
 */
function OwnTest({ def, e5 }: { def: CheckDefinition; e5: E5Results | null }) {
  const { e1 } = def.evidence;
  return (
    <details className="mt-3 text-sm">
      <summary className={summaryClass}>{ownTestWords(e1)}</summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>
          {formatE1(e1)}.{' '}
          <a href={resultsUrl(e1.test)} target="_blank" rel="noreferrer" className={textLink}>
            {e1.test} results
          </a>
        </p>
        {e1.replication && <p>Replication: {formatE1Effect(e1.replication)}.</p>}
        {e1.followUp && <p>{e1.followUp}</p>}
        {def.id === 'question-coverage' && e5 !== null && <p>{step5Sentence(e5)}</p>}
        <p className="text-muted-foreground">{E1_MODELS}.</p>
      </div>
    </details>
  );
}

/** One list of E5 contrasts under a small heading that names it. */
function E5List({ id, title, items }: { id: string; title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 id={id} className="mt-3 font-medium">
        {title}
      </h3>
      <ul aria-labelledby={id} className="mt-1 list-disc space-y-1 pl-6">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * E5, when the question is a guess, from the E5 module: while it is pending, what it asks and its
 * plan; once it has run, its two paragraphs and the numbers behind an expand, in the plan's order
 * (the gate, the four Holm tests, the retention readings, 12K vs P12K, step 5), then the
 * replication family and the rows reported without a verdict. A planned contrast the run has no
 * row for reads "not run".
 */
function E5Entry({
  results,
  text,
}: {
  results: E5Results | null;
  text: { summary: string | null; toolNote: string | null };
}) {
  const plan = (
    <a
      href={`${REPO_URL}/blob/main/${E5_PATHS.plan}`}
      target="_blank"
      rel="noreferrer"
      className={textLink}
    >
      The plan
    </a>
  );
  if (results === null) {
    return (
      <>
        <p className="mt-3 leading-relaxed">
          E5 asks whether the gain holds when the writer has only a keyword, or a question a local
          model wrote from it. Results are not in yet.
        </p>
        <p className="mt-3 text-sm">{plan}</p>
      </>
    );
  }
  const planned = plannedRows(results);
  const used = new Set(planned.map((p) => p.row));
  const rest = results.contrasts.filter((r) => !used.has(r));
  const line = (name: string, row: E5Row | null) => `${name}: ${e5Result(row, results)}`;
  const main = [
    ...planned.map((p) => line(plannedName(p), p.row)),
    ...rest
      .filter((r) => r.set === 'main' && r.step !== 'reported')
      .map((r) => line(r.contrast, r)),
  ];
  const replication = rest
    .filter((r) => r.set === 'replication' && r.step !== 'reported')
    .map((r) => line(r.contrast, r));
  const reported = rest
    .filter((r) => r.step === 'reported')
    .map((r) => line(r.set === 'main' ? r.contrast : `${r.contrast}, replication set`, r));
  return (
    <>
      {text.summary && <p className="mt-3 leading-relaxed">{text.summary}</p>}
      {text.toolNote && <p className="mt-3 leading-relaxed">{text.toolNote}</p>}
      <details className="mt-3 text-sm">
        <summary className={summaryClass}>The numbers</summary>
        <div className="mt-2 leading-relaxed">
          <E5List id="e5-main" title="Main set" items={main} />
          <E5List id="e5-replication" title="Replication set" items={replication} />
          <E5List id="e5-reported" title="Reported" items={reported} />
        </div>
      </details>
      <p className="mt-3 text-sm">
        {plan}
        {' · '}
        <a
          href={`${REPO_URL}/blob/main/${E5_PATHS.results}`}
          target="_blank"
          rel="noreferrer"
          className={textLink}
        >
          E5 results
        </a>
      </p>
    </>
  );
}

/**
 * The research behind each check: per check one label, one grade and one plain sentence (the
 * engine's summary), our own tests' numbers and the rest of the summary, what the studies did
 * (docs/evidence.md) and the sources behind an expand; then E5, which asks how far the labels
 * carry when the question is a guess; then the same for each check on Your site and each kind of
 * site on Who gets cited; the method and its limits at the end. Everything the working screens
 * leave out lives here, at an anchor they link to (#check-<id>, #labels, #e5, #site-<id>,
 * #offpage-<kind>). The document's intro is not rendered: credit for the design lives in the
 * About dialog only.
 *
 * The short answer, the label tally, the label chips and the E5 entry are computed from `e5`,
 * `e5Text` and `labels`, which default to the engine's, so a finished E5 run changes them from
 * its data alone.
 */
export default function ResearchPage({
  e5 = E5_RESULTS,
  e5Text = E5_TEXT,
  labels = TEST_LABELS,
}: {
  e5?: E5Results | null;
  e5Text?: { summary: string | null; toolNote: string | null };
  labels?: Record<CheckId, TestLabel>;
} = {}) {
  const details = checkDetails(readEvidenceDoc());
  const tally = GRADES.map((g) => ({
    grade: g,
    count: CHECK_DEFINITIONS.filter((d) => d.evidence.grade === g).length,
  })).filter((t) => t.count > 0);

  return (
    <PageShell title="The research behind each check">
      <p className="mt-4 font-serif text-xl leading-snug">{shortAnswer(helpedChecks(labels))}</p>
      <p className="mt-2 text-muted-foreground leading-relaxed">{labelScope(e5 !== null)}</p>
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
          every result and citation score
        </a>
        , with where each page came from and a hash of its text. The page text, edited versions,
        prompts and answers are not shared, since the pages belong to their publishers.
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
      <ul
        id="labels"
        aria-label="What our tests found"
        className="mt-3 flex scroll-mt-20 flex-wrap gap-x-4 gap-y-2"
      >
        {labelTally(labels).map((t) => (
          <li key={t.label} className="flex items-center gap-1.5 text-sm">
            <span className="font-semibold tabular-nums">{t.count}</span>{' '}
            <LabelChip label={t.label} />
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
          const label = labelFor(def.id, labels);
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
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <LabelChip label={label} tooltip={cardTooltip(def, label, e5)} />
                  <GradeLabel grade={def.evidence.grade} />
                </div>
              </div>
              <p className="mt-2 leading-relaxed">{lead}</p>
              <OwnTest def={def} e5={e5} />
              <details className="mt-3 text-sm">
                <summary className={summaryClass}>Studies ({def.evidence.sources.length})</summary>
                <div className="mt-2 leading-relaxed">
                  {rest && <p className="my-3">{rest}</p>}
                  <p className="my-3">
                    <span className="font-medium">What it checks. </span>
                    {def.description}
                  </p>
                  <Markdown nodes={details[def.id] ?? []} />
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

      <section id="e5" aria-labelledby="e5-title" className="mt-14 scroll-mt-20">
        <h2 id="e5-title" className={H2}>
          When the question is a guess
        </h2>
        <E5Entry results={e5} text={e5Text} />
      </section>

      <section id="site" aria-labelledby="site-title" className="mt-14 scroll-mt-20">
        <h2 id="site-title" className={H2}>
          Your site checks
        </h2>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          What the studies and the engines' own documentation say about each check on Your site.
          Three of these can keep a page out of AI answers; the rest are notes.
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
          A grade describes the research, not your draft. A label says what our own tests found.
          Questions covered counts the questions where both tested edits are in place; the count
          itself was not tested.
        </p>
        <p className="mt-3 leading-relaxed">
          Our own test applied each check's fix to real pages and asked two local models to answer
          from four sources. A second run asked again, with more pages, for the seven checks the
          first had too few pages for, and its result replaces the first for them. Neither changes a
          grade. d is the change in citation score, where a page cited first gets 1 and an uncited
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
        <p className="mt-5 font-medium">Why the labels aren't a forecast</p>
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
