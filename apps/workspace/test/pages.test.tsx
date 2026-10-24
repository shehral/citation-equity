import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  CHECK_DEFINITIONS,
  CHECK_IDS,
  E1_COMBINED,
  E1_MODELS,
  formatE1,
  formatE1Effect,
  splitSentences,
} from '@citation-equity/engine';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ResearchPage from '@/app/research/page';
import { checkDetails, REPO_URL, readEvidenceDoc } from '@/lib/evidence-doc';
import {
  CHECK_NAMES,
  E1_COMBINED_SENTENCE,
  E1_WORDS,
  PLAIN_LEADS,
  UNSCORED_NOTES,
} from '@/lib/glossary';

afterEach(cleanup);

const EM_DASH = '—';
const GRADE_WORD = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  mixed: 'Mixed evidence',
  untested: 'Untested',
} as const;

const firstSentence = (s: string) => splitSentences(s, 0)[0]?.text ?? '';

describe('/research', () => {
  it('names each check as the draft view does (the plain-name glossary)', () => {
    render(<ResearchPage />);
    const names = screen
      .getAllByRole('heading', { level: 2 })
      .slice(0, CHECK_DEFINITIONS.length)
      .map((h) => h.textContent);
    expect(names).toEqual(CHECK_DEFINITIONS.map((d) => CHECK_NAMES[d.id]));
  });

  it('lists the 10 checks, each with one grade and one plain sentence', () => {
    render(<ResearchPage />);
    expect(CHECK_DEFINITIONS).toHaveLength(10);
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

  it('keeps the rest of the summary, the weights and the sources behind an expand', () => {
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
      expect(inside.textContent).toContain(
        `Weights: ${def.defaultWeights.foundation} standard · ${def.defaultWeights.evidence} by evidence`,
      );
      for (const source of def.evidence.sources) {
        const link = within(inside).getByRole('link', { name: source.citation });
        expect(link.getAttribute('href')).toBe(source.url);
      }
      // What the studies did, from docs/evidence.md.
      expect(inside.textContent).toContain('What the studies did.');
    }
  });

  it("words E1's outcomes in plain words", () => {
    expect(E1_WORDS).toEqual({
      helps: 'Tested: helped a little, maybe through wording overlap',
      'no-effect': 'Tested: no clear effect',
      'insufficient-n': 'Tested: too few pages',
      'not-run': 'Tested: no edit passed our checks',
      descriptive: 'Tested: no verdict by design',
    });
    expect(UNSCORED_NOTES.lists).toBe(
      'Lists count only if you give them a weight, because a test found no effect larger than 0.03.',
    );
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
      const words = E1_WORDS[def.evidence.e1.label];
      expect(summary, def.id).toBe(def.scored ? words : `${words} · Not scored`);
      const inside = e1?.textContent ?? '';
      expect(inside, def.id).toContain(`${formatE1(def.evidence.e1)}.`);
      expect(inside, def.id).toContain(E1_MODELS);
      const rep = def.evidence.e1.replication;
      if (rep) expect(inside, def.id).toContain(`Replication: ${formatE1Effect(rep)}.`);
      if (!def.scored) expect(inside, def.id).toContain(UNSCORED_NOTES[def.id] ?? 'missing note');
      // The grade is unchanged next to it.
      expect(within(section).getAllByText(GRADE_WORD[def.evidence.grade])).toHaveLength(1);
    }
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

  it('opens with the short answer and a tally of the grades', () => {
    render(<ResearchPage />);
    const text = document.body.textContent ?? '';
    const strong = CHECK_DEFINITIONS.filter((d) => d.evidence.grade === 'strong').length;
    if (strong === 0) expect(text).toContain('Short answer: none of the checks is proven yet.');
    const tally = screen.getByRole('list', { name: 'Grades of the 10 checks' });
    const total = within(tally)
      .getAllByRole('listitem')
      .reduce((sum, li) => sum + Number(li.textContent?.match(/^\d+/)?.[0] ?? 0), 0);
    expect(total).toBe(10);
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

describe('evidence stance copy', () => {
  it('is not re-typed anywhere in the app source outside lib/presets.ts', () => {
    // __dirname, not import.meta.url: under jsdom the module URL is not a file: URL.
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', '.next', 'out', 'test', 'generated'].includes(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    for (const dir of ['app', 'components', 'lib']) walk(join(root, dir));
    const offenders = files
      .filter((f) => readFileSync(f, 'utf8').includes('not a prediction of citations'))
      .map((f) => relative(root, f));
    expect(offenders).toEqual(['lib/presets.ts']);
  });
});
