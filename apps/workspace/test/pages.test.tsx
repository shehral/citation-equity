import {
  BLOCKER_IDS,
  CHECK_DEFINITIONS,
  CHECK_IDS,
  type CheckId,
  deriveInputLabels,
  E1_COMBINED,
  E1_MODELS,
  E5_PATHS,
  E5_RESULTS,
  E5_TEXT,
  type E5Results,
  type E5Row,
  EVIDENCE,
  type Evidence,
  formatE1,
  formatE1Effect,
  helpedChecks,
  OFFPAGE_ADVICE,
  OWN_TEST_RESULTS,
  READINESS_EVIDENCE,
  SOURCE_KINDS,
  shortAnswer,
  splitSentences,
  TEST_LABEL_TEXT,
  TEST_LABELS,
  type TestLabel,
  testLabels,
} from '@citation-equity/engine';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ResearchPage, { metadata } from '@/app/research/page';
import { ROWS as SITE_ROWS } from '@/components/site/site-check';
import { checkDetails, REPO_URL, readEvidenceDoc } from '@/lib/evidence-doc';
import {
  CHECK_NAMES,
  E1_COMBINED_SENTENCE,
  E1_WORDS,
  ownTestWords,
  PLAIN_LEADS,
} from '@/lib/glossary';
import { E5_ROWS, e5Results, e5Row } from '../../../packages/engine/test/e5-fixture';
import { strayScores } from './quiet';

afterEach(cleanup);

const EM_DASH = '—';
const GRADE_WORD = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  mixed: 'Mixed evidence',
  untested: 'Untested',
} as const;

const firstSentence = (s: string) => splitSentences(s, 0)[0]?.text ?? '';

/** The details element of `section` whose summary starts with `start`. */
const detailsOf = (section: HTMLElement, start: string) =>
  [...section.querySelectorAll('details')].find((d) =>
    d.querySelector('summary')?.textContent?.startsWith(start),
  );

/** Opens every disclosure on the page, as a reader who opened them all would see it. */
const openAll = () => {
  for (const d of document.querySelectorAll('details')) d.open = true;
};

/** Each label with its count among the eleven checks, in the order the engine declares them. */
const tallyOf = (labels: Record<CheckId, TestLabel>) =>
  (Object.keys(TEST_LABEL_TEXT) as TestLabel[])
    .map((label) => ({ label, count: CHECK_IDS.filter((id) => labels[id] === label).length }))
    .filter((t) => t.count > 0)
    .map((t) => `${t.count} ${TEST_LABEL_TEXT[t.label]}`);

const tallyOnPage = () =>
  within(screen.getByRole('list', { name: 'What our tests found' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

/** The line under the short answer: whose questions the measured label covers, E5 in its tense. */
const SCOPE_LINE =
  "That label covers the reader's own questions; E5 tested guesses made from a keyword.";
const SCOPE_LINE_PENDING =
  "That label covers the reader's own questions; E5 tests guesses made from a keyword.";

describe('/research', () => {
  it('names each check as the draft view does (the plain-name glossary)', () => {
    render(<ResearchPage />);
    const names = screen
      .getAllByRole('heading', { level: 2 })
      .slice(0, CHECK_DEFINITIONS.length)
      .map((h) => h.textContent);
    expect(names).toEqual(CHECK_DEFINITIONS.map((d) => CHECK_NAMES[d.id]));
  });

  it('lists the 11 checks, each with one grade and one plain sentence', () => {
    render(<ResearchPage />);
    expect(CHECK_DEFINITIONS).toHaveLength(11);
    for (const def of CHECK_DEFINITIONS) {
      const section = screen.getByRole('region', { name: CHECK_NAMES[def.id] });
      expect(section.id).toBe(`check-${def.id}`);
      const grades = Object.values(GRADE_WORD).filter((w) =>
        within(section).queryByText(w, { exact: true }),
      );
      expect(grades).toEqual([GRADE_WORD[def.evidence.grade]]);
      const lead = section.querySelector(':scope > p');
      expect(lead?.textContent).toBe(PLAIN_LEADS[def.id] ?? firstSentence(def.evidence.summary));
      // Plain words: no study names or "GEO" in the one sentence.
      expect(lead?.textContent).not.toMatch(/\bGEO\b|C-SEO|Bench\b/);
    }
  });

  it('keeps the rest of the summary and the sources behind an expand, with no weights', () => {
    render(<ResearchPage />);
    for (const def of CHECK_DEFINITIONS) {
      const section = screen.getByRole('region', { name: CHECK_NAMES[def.id] });
      const details = [...section.querySelectorAll('details')].find((d) =>
        d.querySelector('summary')?.textContent?.startsWith('Studies'),
      );
      expect(details?.open).toBe(false);
      expect(details?.querySelector('summary')?.textContent).toBe(
        `Studies (${def.evidence.sources.length})`,
      );
      const inside = details as HTMLElement;
      // After a plain lead, the whole engine summary (with its study names) is inside.
      const rest = splitSentences(def.evidence.summary, 0).slice(PLAIN_LEADS[def.id] ? 0 : 1);
      for (const s of rest) expect(inside.textContent).toContain(s.text);
      expect(inside.textContent).not.toContain('Weights:');
      for (const source of def.evidence.sources) {
        const link = within(inside).getByRole('link', { name: source.citation });
        expect(link.getAttribute('href')).toBe(source.url);
      }
      // What the studies did, from docs/evidence.md.
      expect(inside.textContent).toContain('What the studies did.');
    }
  });

  it("words our own tests' outcomes in plain words", () => {
    expect(E1_WORDS).toEqual({
      helps: 'Tested: helped a little, maybe through wording overlap',
      'no-effect': 'Tested: no clear effect',
      'insufficient-n': 'Tested: too few pages',
      inconclusive: 'Tested: unclear',
      'not-run': 'Tested: no edit passed our checks',
      descriptive: 'Tested: no verdict by design',
    });
    expect(ownTestWords(EVIDENCE['expert-quotes'].e1)).toBe('Tested: unclear, leaning positive');
    expect(ownTestWords(EVIDENCE['question-headings'].e1)).toBe('Tested: no clear effect');
    expect(ownTestWords(EVIDENCE.tables.e1)).toBe('Tested: too few pages');
  });

  it("shows each check's own-test result in plain words, with the exact numbers on expand", () => {
    render(<ResearchPage />);
    for (const def of CHECK_DEFINITIONS) {
      const section = screen.getByRole('region', { name: CHECK_NAMES[def.id] });
      const e1 = [...section.querySelectorAll('details')].find((d) =>
        d.querySelector('summary')?.textContent?.startsWith('Tested'),
      );
      expect(e1, def.id).toBeDefined();
      expect(e1?.open).toBe(false);
      const summary = e1?.querySelector('summary')?.textContent;
      expect(summary, def.id).toBe(ownTestWords(def.evidence.e1));
      const inside = e1?.textContent ?? '';
      expect(inside, def.id).toContain(`${formatE1(def.evidence.e1)}.`);
      // The numbers link to the results of the test they come from.
      const results = within(e1 as HTMLElement).getByRole('link', {
        name: `${def.evidence.e1.test} results`,
      });
      expect(results.getAttribute('href')).toBe(
        `${REPO_URL}/blob/main/${OWN_TEST_RESULTS[def.evidence.e1.test]}`,
      );
      expect(inside, def.id).toContain(E1_MODELS);
      const rep = def.evidence.e1.replication;
      if (rep) expect(inside, def.id).toContain(`Replication: ${formatE1Effect(rep)}.`);
      const followUp = def.evidence.e1.followUp;
      if (followUp) expect(inside, def.id).toContain(followUp);
      expect(inside, def.id).not.toContain('Not scored');
      // The grade is unchanged next to it.
      expect(within(section).getAllByText(GRADE_WORD[def.evidence.grade])).toHaveLength(1);
    }
  });

  it("shows E3's pooled result for the checks it asked again, plain words first", () => {
    render(<ResearchPage />);
    const tested = (name: string) => {
      const section = screen.getByRole('region', { name });
      return [...section.querySelectorAll('details')].find((d) =>
        d.querySelector('summary')?.textContent?.startsWith('Tested'),
      );
    };
    const quotes = tested(CHECK_NAMES['expert-quotes']);
    expect(quotes?.querySelector('summary')?.textContent).toBe('Tested: unclear, leaning positive');
    expect(quotes?.textContent).toContain(
      'E3: inconclusive (d +0.026, 95% CI [+0.001, +0.053], n 62, Holm p 0.179).',
    );
    const headings = tested(CHECK_NAMES['question-headings']);
    expect(headings?.querySelector('summary')?.textContent).toBe('Tested: no clear effect');
    expect(headings?.textContent).toContain(
      'E3: no effect larger than 0.03 (d -0.016, 90% CI [-0.028, -0.004], n 57, Holm p 0.164).',
    );
    const tables = tested(CHECK_NAMES.tables);
    expect(tables?.querySelector('summary')?.textContent).toBe('Tested: too few pages');
    expect(tables?.textContent).toContain(
      'E3: insufficient n (d -0.027, 95% CI [-0.054, -0.001], n 11).',
    );
  });

  it("has an entry for your reader's words up top, with its grade, its test result and E2's numbers on expand", () => {
    render(<ResearchPage />);
    const section = screen.getByRole('region', { name: "Your reader's words up top" });
    expect(section.id).toBe('check-reader-words');
    expect(within(section).getAllByText('Mixed evidence')).toHaveLength(1);
    const tested = [...section.querySelectorAll('details')].find((d) =>
      d.querySelector('summary')?.textContent?.startsWith('Tested'),
    );
    expect(tested?.querySelector('summary')?.textContent).toBe(
      'Tested: helped a little, maybe through wording overlap',
    );
    expect(tested?.textContent).toContain(
      'E1: helps, possibly through length or query-term overlap (d +0.035, 95% CI [+0.008, +0.066], n 33, Holm p 0.037).',
    );
    expect(tested?.textContent).toContain(
      'the gain kept its sign (d +0.029, 95% CI [+0.003, +0.061], n 29)',
    );
    const studies = [...section.querySelectorAll('details')].find((d) =>
      d.querySelector('summary')?.textContent?.startsWith('Studies'),
    );
    expect(studies?.textContent).not.toContain('Weights:');
    expect(studies?.textContent).toContain('17.7');
  });

  it('states the combined result of applying every fix once, in one sentence', () => {
    expect(E1_COMBINED_SENTENCE).toBe(
      'In our own test, applying every fix together raised the citation score by +0.049 (95% CI [+0.024, +0.076], n 78) over the original page and by +0.071 over a paraphrase of the same passages, possibly through length or query-term overlap.',
    );
    expect(E1_COMBINED.vsOriginal.n).toBe(78);
    render(<ResearchPage />);
    const text = document.body.textContent ?? '';
    expect(text.split(E1_COMBINED_SENTENCE)).toHaveLength(2);
    const results = screen.getByRole('link', { name: 'our own test' });
    expect(results.getAttribute('href')).toBe(`${REPO_URL}/blob/main/experiments/RESULTS_E1.md`);
    const again = screen.getByRole('link', { name: 'a second run with more pages' });
    expect(again.getAttribute('href')).toBe(`${REPO_URL}/blob/main/experiments/RESULTS_E3.md`);
  });

  it('keeps what the working screens leave out: each site check and kind of cited site, by anchor', () => {
    render(<ResearchPage />);
    const groups: [string, string, { id: string; name: string; evidence: Evidence }[]][] = [
      [
        'site',
        'Your site checks',
        SITE_ROWS.map((r) => ({
          id: `site-${r.id}`,
          name: r.name,
          evidence: READINESS_EVIDENCE[r.id],
        })),
      ],
      [
        'off-page',
        'Who gets cited',
        SOURCE_KINDS.map((k) => ({
          id: `offpage-${k}`,
          name: OFFPAGE_ADVICE[k].title,
          evidence: OFFPAGE_ADVICE[k].evidence,
        })),
      ],
    ];
    for (const [id, title, items] of groups) {
      const part = screen.getByRole('region', { name: title });
      expect(part.id).toBe(id);
      for (const item of items) {
        const section = within(part).getByRole('region', { name: item.name });
        expect(section.id).toBe(item.id);
        expect(within(section).getByText(GRADE_WORD[item.evidence.grade])).toBeTruthy();
        expect(section.textContent).toContain(item.evidence.summary);
        for (const source of item.evidence.sources) {
          const link = within(section).getByRole('link', {
            name: source.citation.replace(/\s*Read \d{4}-\d{2}-\d{2}\.\s*$/, ''),
          });
          expect(link.getAttribute('href')).toBe(source.url);
          expect(section.textContent).toContain(source.claim);
        }
      }
    }
  });

  it('opens with a contents line that links each part by its anchor', () => {
    render(<ResearchPage />);
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#checks', '#e5', '#site', '#off-page', '#method']);
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual([
      'Writing checks',
      'When the question is a guess',
      'Your site',
      'Who gets cited',
      'Method and limits',
    ]);
    for (const href of hrefs) expect(document.getElementById(href?.slice(1) ?? '')).not.toBeNull();
  });

  it('ends with one short method and limits section', () => {
    render(<ResearchPage />);
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s.at(-1)?.textContent).toBe('Method and limits');
    const method = screen.getByRole('region', { name: 'Method and limits' });
    for (const word of Object.values(GRADE_WORD)) expect(method.textContent).toContain(word);
    const doc = within(method).getByRole('link', { name: 'full evidence document' });
    expect(doc.getAttribute('href')).toBe(`${REPO_URL}/blob/main/docs/evidence.md`);
    const notes = within(method).getByRole('link', { name: 'reading notes' });
    expect(notes.getAttribute('href')).toBe(
      `${REPO_URL}/blob/main/docs/research/evidence-notes.md`,
    );
  });

  it('says what a grade and a label describe, and that the count itself was not tested', () => {
    render(<ResearchPage />);
    const method = screen.getByRole('region', { name: 'Method and limits' });
    expect(method.textContent).toContain(
      'A grade describes the research, not your draft. A label says what our own tests found. Questions covered counts the questions where both tested edits are in place; the count itself was not tested.',
    );
    expect(within(method).getByText("Why the labels aren't a forecast")).toBeTruthy();
    const limits = within(method)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(limits).toEqual([
      'Most tests hand the page straight to the AI; real search has to find it first.',
      'Studies disagree: tricks that helped in one failed in larger ones.',
      'Engines differ and change.',
      'The effects we found are small: about 0.03 on a 0-to-1 citation score.',
    ]);
    expect(method.textContent).not.toMatch(/weights|unscored|Not scored/i);
  });

  it('introduces Your site as three blockers and the rest notes', () => {
    render(<ResearchPage />);
    const site = screen.getByRole('region', { name: 'Your site checks' });
    expect(BLOCKER_IDS).toHaveLength(3);
    expect(site.textContent).toContain(
      'Three of these can keep a page out of AI answers; the rest are notes.',
    );
  });

  it('describes itself as what studies and our own tests found', () => {
    expect(metadata.description).toBe(
      'What published studies and our own tests found for each writing check, with sources.',
    );
  });

  it("opens with the short answer computed from the checks labelled Helped, and the label's scope", () => {
    render(<ResearchPage />);
    const answer = screen.getByText(shortAnswer(helpedChecks()));
    expect(answer.tagName).toBe('P');
    // The line under it says whose questions the measured label covers, and that E5 has run.
    expect(E5_RESULTS).not.toBeNull();
    expect(answer.nextElementSibling?.textContent).toBe(SCOPE_LINE);
    expect(document.body.textContent).not.toContain('Treat the score');
  });

  it('tallies the labels of the eleven checks, as the engine sets them', () => {
    render(<ResearchPage />);
    const list = screen.getByRole('list', { name: 'What our tests found' });
    expect(list.id).toBe('labels');
    expect(tallyOnPage()).toEqual(tallyOf(TEST_LABELS));
    const total = tallyOnPage().reduce((sum, t) => sum + Number(t?.match(/^\d+/)?.[0] ?? 0), 0);
    expect(total).toBe(11);
    // Each count's label reads as a chip.
    for (const li of within(list).getAllByRole('listitem'))
      expect(li.querySelectorAll('[data-label-chip]')).toHaveLength(1);
  });

  it("with E5's results (step 5 keeps the question section at helps): 2 Helped (the question checks), 4 No effect, 5 Unclear", () => {
    render(<ResearchPage />);
    expect(tallyOnPage()).toEqual([
      `2 ${TEST_LABEL_TEXT.helped}`,
      `4 ${TEST_LABEL_TEXT['no-effect']}`,
      `5 ${TEST_LABEL_TEXT.unclear}`,
    ]);
    expect(helpedChecks()).toEqual(['question-coverage', 'reader-words']);
    expect(screen.getByText(shortAnswer(helpedChecks())).textContent).toBe(
      "Short answer: of the single checks, only your reader's words near the top helped in our tests.",
    );
  });

  it('puts a label chip beside the grade on every check card', () => {
    render(<ResearchPage />);
    for (const def of CHECK_DEFINITIONS) {
      const section = screen.getByRole('region', { name: CHECK_NAMES[def.id] });
      const chips = section.querySelectorAll<HTMLElement>('[data-label-chip]');
      expect(chips, def.id).toHaveLength(1);
      const chip = chips[0] as HTMLElement;
      expect(chip.textContent, def.id).toBe(TEST_LABEL_TEXT[TEST_LABELS[def.id]]);
      // Beside the grade, in the card's header.
      expect(chip.parentElement?.textContent, def.id).toContain(GRADE_WORD[def.evidence.grade]);
      expect(section.querySelector('h2')?.parentElement?.contains(chip), def.id).toBe(true);
      // One plain sentence, no number.
      expect(chip.title, def.id).toMatch(/\.$/);
      expect(chip.title, def.id).not.toMatch(/\d/);
      expect(chip.title.split(/(?<=\.)\s+/), def.id).toHaveLength(1);
    }
  });

  it('shows no weights, no "Not scored", and says "score" only as "citation score"', () => {
    render(<ResearchPage />);
    openAll();
    const text = document.body.textContent ?? '';
    for (const gone of [
      'Weights:',
      'Not scored',
      'Treat the score',
      "Why the score isn't a forecast",
      'Short answer: none of the checks',
      'Scoring',
      'AI-ready',
    ])
      expect(text, gone).not.toContain(gone);
    // Every word on the page with every disclosure open, the Studies and Sources expands included:
    // what the page quotes from the registries and docs/evidence.md follows the rule too.
    expect(strayScores(text)).toEqual([]);
  });

  it('opens with a tally of the grades', () => {
    render(<ResearchPage />);
    const tally = screen.getByRole('list', { name: 'Grades of the 11 checks' });
    const total = within(tally)
      .getAllByRole('listitem')
      .reduce((sum, li) => sum + Number(li.textContent?.match(/^\d+/)?.[0] ?? 0), 0);
    expect(total).toBe(11);
  });

  it('carries no credit, no "GEO Score", no retired grade word and no em dash', () => {
    render(<ResearchPage />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Bayat/);
    expect(text).not.toMatch(/GEO Score/i);
    expect(text).not.toMatch(/Foundation design/);
    expect(text).not.toMatch(new RegExp(['contra', 'dicted'].join(''), 'i'));
    expect(text).not.toContain(EM_DASH);
  });
});

describe('checkDetails', () => {
  it('returns, for every check, the doc paragraphs between its summary and its sources', () => {
    const details = checkDetails(readEvidenceDoc());
    for (const id of CHECK_IDS) {
      const nodes = details[id];
      expect(nodes, id).toBeDefined();
      const text = JSON.stringify(nodes);
      expect(text, id).toContain('What the studies did.');
      expect(text, id).not.toContain('Grade:');
      expect(text, id).not.toContain('"Sources"');
      expect(
        nodes?.every((n) => n.type !== 'heading' && n.type !== 'list'),
        id,
      ).toBe(true);
    }
  });
});

/**
 * The rows of a full E5 run without the local model's question (9L) on the main set, cut for
 * time, and with step 5 (the pooled 9 vs original) finding no effect.
 */
const CUT_9L: E5Row[] = E5_ROWS.filter(
  (r) => !(r.set === 'main' && r.contrast.startsWith('9L')),
).map((r) => (r.step === 'step5' ? { ...r, label: 'no effect larger than δ' } : r));

/**
 * A finished E5 run: the gate passed, the keyword keeps the gain, 9L was cut, and step 5 (the
 * pooled 9 vs original) found no effect, which relabels the question section.
 */
const DONE = e5Results(
  { retention: { '9K': 'keeps the gain' }, readers_words_label: 'no effect larger than δ' },
  CUT_9L,
);
const DONE_TEXT = {
  summary: 'E5 found the keyword keeps the gain.',
  toolNote: 'The tool says so.',
};
const DONE_LABELS = testLabels(deriveInputLabels(DONE));

/** A row's numbers as the page words them: d with its 95% interval, n, and Holm p where corrected. */
const effect = (row: E5Row) =>
  formatE1Effect({
    d: row.d ?? Number.NaN,
    ci: row.ci95 ?? [Number.NaN, Number.NaN],
    level: 95,
    n: row.n ?? 0,
    ...(row.p_holm === null ? {} : { holmP: row.p_holm }),
  });

const planLink = `${REPO_URL}/blob/main/${E5_PATHS.plan}`;
const resultsLink = `${REPO_URL}/blob/main/${E5_PATHS.results}`;

/** The items of the E5 list named `name`, as text. */
const e5Items = (name: string) =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('/research, E5: when the question is a guess', () => {
  it('says E5 is pending, with a link to its plan, while there are no results', () => {
    render(<ResearchPage e5={null} />);
    expect(screen.getByText(SCOPE_LINE_PENDING)).toBeTruthy();
    expect(screen.queryByText(SCOPE_LINE)).toBeNull();
    const section = screen.getByRole('region', { name: 'When the question is a guess' });
    expect(section.id).toBe('e5');
    expect(section.textContent).toContain(
      'E5 asks whether the gain holds when the writer has only a keyword, or a question a local model wrote from it. Results are not in yet.',
    );
    const plan = within(section).getByRole('link', { name: 'The plan' });
    expect(plan.getAttribute('href')).toBe(planLink);
    expect(within(section).queryByRole('link', { name: 'E5 results' })).toBeNull();
    expect(detailsOf(section, 'The numbers')).toBeUndefined();
  });

  it("gives E5's results on the page today: its two paragraphs, the planned numbers and both links", () => {
    render(<ResearchPage />);
    const section = screen.getByRole('region', { name: 'When the question is a guess' });
    const results = E5_RESULTS as E5Results;
    expect(section.textContent).not.toContain('Results are not in yet.');
    const paragraphs = [...section.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs.slice(0, 2)).toEqual([E5_TEXT.summary, E5_TEXT.toolNote]);
    expect(detailsOf(section, 'The numbers')?.open).toBe(false);
    expect(within(section).getByRole('link', { name: 'E5 results' }).getAttribute('href')).toBe(
      resultsLink,
    );
    const main = (step: string, contrast: string) =>
      results.contrasts.find(
        (r) => r.set === 'main' && r.step === step && r.contrast === contrast,
      ) as E5Row;
    const noted = 'helps, possibly through length or query-term overlap';
    const items = e5Items('Main set');
    expect(items.slice(0, 9)).toEqual([
      `The gate, 9 vs original on new queries (115 with a valid edit): ${noted} (${effect(main('gate', '9 vs original'))})`,
      `9K vs original: ${noted} (${effect(main('family', '9K vs original'))})`,
      `9K vs 9P: ${noted} (${effect(main('family', '9K vs 9P'))})`,
      `9L vs original: no effect larger than 0.03 (${effect(main('family', '9L vs original'))})`,
      `9L vs 9P: no effect larger than 0.03 (${effect(main('family', '9L vs 9P'))})`,
      `9K vs 9: loses the gain (${effect(main('retention', '9K vs 9'))})`,
      `9L vs 9: loses the gain (${effect(main('retention', '9L vs 9'))})`,
      `12K vs P12K: no effect larger than 0.03 (${effect(main('arm12', '12K vs P12K'))})`,
      `Step 5, 9 vs original over every main query with a valid edit (169), a cumulative estimate that includes E1's queries: ${noted} (${effect(main('step5', '9 vs original'))})`,
    ]);
    // The gate's numbers as the results give them.
    expect(items[0]).toContain('d +0.039, 95% CI [+0.023, +0.056], n 115');
    // Step 5's pooled result on the question section's card.
    const card = screen.getByRole('region', { name: CHECK_NAMES['question-coverage'] });
    expect(card.textContent).toContain(
      `E5 step 5, 9 vs original over every main query with a valid edit (169), a cumulative estimate that includes E1's queries: ${noted} (${effect(main('step5', '9 vs original'))}).`,
    );
  });

  it('sits between the writing checks and Your site', () => {
    render(<ResearchPage />);
    const h2s = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const at = h2s.indexOf('When the question is a guess');
    expect(at).toBe(CHECK_DEFINITIONS.length);
    expect(h2s[at + 1]).toBe('Your site checks');
  });

  describe('once E5 is done (a finished run passed in)', () => {
    const renderDone = () =>
      render(<ResearchPage e5={DONE} e5Text={DONE_TEXT} labels={DONE_LABELS} />);

    it('gives its two sentences, the numbers behind an expand, and links to the plan and the results', () => {
      renderDone();
      const section = screen.getByRole('region', { name: 'When the question is a guess' });
      expect(section.textContent).toContain(DONE_TEXT.summary);
      expect(section.textContent).toContain(DONE_TEXT.toolNote);
      expect(section.textContent).not.toContain('Results are not in yet.');
      const numbers = detailsOf(section, 'The numbers');
      expect(numbers?.open).toBe(false);
      expect(within(section).getByRole('link', { name: 'The plan' }).getAttribute('href')).toBe(
        planLink,
      );
      expect(within(section).getByRole('link', { name: 'E5 results' }).getAttribute('href')).toBe(
        resultsLink,
      );
    });

    it("lists the main set in the plan's order, with the gate, the Holm tests, the retention words and step 5 named cumulative", () => {
      renderDone();
      const main = (step: string, contrast: string) =>
        CUT_9L.find((r) => r.set === 'main' && r.step === step && r.contrast === contrast) as E5Row;
      expect(e5Items('Main set')).toEqual([
        `The gate, 9 vs original on new queries (${main('gate', '9 vs original').n} with a valid edit): helps (${effect(main('gate', '9 vs original'))})`,
        `9K vs original: helps (${effect(main('family', '9K vs original'))})`,
        `9K vs 9P: helps (${effect(main('family', '9K vs 9P'))})`,
        '9L vs original: not run',
        '9L vs 9P: not run',
        `9K vs 9: keeps the gain (${effect(main('retention', '9K vs 9'))})`,
        '9L vs 9: not run',
        `12K vs P12K: no effect larger than 0.03 (${effect(main('arm12', '12K vs P12K'))})`,
        `Step 5, 9 vs original over every main query with a valid edit (${main('step5', '9 vs original').n}), a cumulative estimate that includes E1's queries: no effect larger than 0.03 (${effect(main('step5', '9 vs original'))})`,
        `12K vs original: reported without a verdict (${effect(main('arm12 rule', '12K vs original'))})`,
      ]);
      // The four Holm tests carry their corrected p.
      expect(e5Items('Main set')[1]).toContain('Holm p 0.012');
    });

    it('then the replication family, with its flags, and the reported rows', () => {
      renderDone();
      const replication = e5Items('Replication set');
      expect(replication).toHaveLength(4);
      expect(replication[0]).toMatch(/^9K vs original: inconclusive \(d /);
      expect(replication[2]).toMatch(/^9L vs original: helps \(.*\), Gemma only$/);
      expect(replication[3]).toMatch(/^9L vs 9P: helps \(.*\), earlier run$/);
      expect(e5Items('Reported')).toEqual([
        expect.stringMatching(/^9G vs original: reported without a verdict \(d .*, n 147\)$/),
      ]);
    });

    it('words a gate that did not pass, and a label of no effect, plainly', () => {
      const failed = e5Results({ gate_passed: false, gate_label: 'inconclusive' }, [
        { ...(E5_ROWS[0] as E5Row), label: 'inconclusive' },
        { ...(E5_ROWS[1] as E5Row), label: 'descriptive (gate failed)' },
        { ...(E5_ROWS[2] as E5Row), label: 'no effect larger than δ' },
      ]);
      render(<ResearchPage e5={failed} e5Text={DONE_TEXT} />);
      const items = e5Items('Main set');
      expect(items[0]).toMatch(
        /^The gate, 9 vs original on new queries \(\d+ with a valid edit\): inconclusive \(/,
      );
      expect(items[1]).toMatch(/^9K vs original: no verdict \(the gate did not pass\) \(/);
      expect(items[2]).toMatch(/^9K vs 9P: no effect larger than 0\.03 \(/);
      expect(
        within(screen.getByRole('region', { name: 'When the question is a guess' })).queryByRole(
          'list',
          { name: 'Replication set' },
        ),
      ).toBeNull();
    });

    it('says "score" only as "citation score" there too, with every disclosure open', () => {
      renderDone();
      openAll();
      expect(strayScores(document.body.textContent ?? '')).toEqual([]);
    });

    it('changes the tally, the short answer and the question section chip, from the data alone', () => {
      renderDone();
      // The fixture moves one label: the question section reads as step 5 found.
      expect(DONE_LABELS['question-coverage']).not.toBe(TEST_LABELS['question-coverage']);
      expect(tallyOnPage()).toEqual(tallyOf(DONE_LABELS));
      expect(tallyOnPage()).not.toEqual(tallyOf(TEST_LABELS));
      const answer = shortAnswer(helpedChecks(DONE_LABELS));
      expect(answer).not.toBe(shortAnswer(helpedChecks()));
      expect(screen.getByText(answer)).toBeTruthy();
      const card = screen.getByRole('region', { name: CHECK_NAMES['question-coverage'] });
      expect(card.querySelector('[data-label-chip]')?.textContent).toBe(
        TEST_LABEL_TEXT[DONE_LABELS['question-coverage']],
      );
    });

    it("shows step 5's pooled result on the question section card, beside E1's, named cumulative", () => {
      renderDone();
      const card = screen.getByRole('region', { name: CHECK_NAMES['question-coverage'] });
      const tested = detailsOf(card, 'Tested') as HTMLElement;
      expect(tested.textContent).toContain(`${formatE1(EVIDENCE['question-coverage'].e1)}.`);
      const step5 = CUT_9L.find((r) => r.step === 'step5') as E5Row;
      expect(tested.textContent).toContain(
        `E5 step 5, 9 vs original over every main query with a valid edit (${step5.n}), a cumulative estimate that includes E1's queries: no effect larger than 0.03 (${effect(step5)}).`,
      );
      // No other card carries it.
      const other = screen.getByRole('region', { name: CHECK_NAMES['reader-words'] });
      expect(other.textContent).not.toContain('E5 step 5');
    });

    it('says step 5 was not run on the card when the run has no step 5', () => {
      const noStep5 = e5Results(
        {},
        E5_ROWS.filter((r) => r.step !== 'step5'),
      );
      render(<ResearchPage e5={noStep5} e5Text={DONE_TEXT} />);
      const card = screen.getByRole('region', { name: CHECK_NAMES['question-coverage'] });
      expect(card.textContent).toContain(
        "E5 step 5, 9 vs original over every main query with a valid edit, a cumulative estimate that includes E1's queries: not run.",
      );
    });

    it("says why the question section reads Unclear when step 5's judges disagreed", () => {
      const split = e5Results({ readers_words_label: 'model-dependent' });
      const labels = testLabels(deriveInputLabels(split));
      expect(labels['question-coverage']).toBe('unclear');
      render(<ResearchPage e5={split} e5Text={DONE_TEXT} labels={labels} />);
      const card = screen.getByRole('region', { name: CHECK_NAMES['question-coverage'] });
      const chip = card.querySelector<HTMLElement>('[data-label-chip]');
      expect(chip?.textContent).toBe(TEST_LABEL_TEXT.unclear);
      expect(chip?.title).toBe("Our test's two judge models disagreed.");
    });

    it('names the replication set on a row it reported without a verdict', () => {
      const both = e5Results({}, [
        ...E5_ROWS,
        e5Row('reported', '9G vs original', {
          set: 'replication',
          n: 41,
          p_holm: null,
          label: 'reported without a verdict',
        }),
      ]);
      render(<ResearchPage e5={both} e5Text={DONE_TEXT} />);
      expect(e5Items('Reported')).toEqual([
        expect.stringMatching(/^9G vs original: reported without a verdict \(d .*, n 147\)$/),
        expect.stringMatching(
          /^9G vs original, replication set: reported without a verdict \(d .*, n 41\)$/,
        ),
      ]);
    });
  });
});
