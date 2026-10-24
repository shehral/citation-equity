import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CHECK_DEFINITIONS, CHECK_IDS, splitSentences } from '@citation-equity/engine';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ResearchPage from '@/app/research/page';
import { checkDetails, REPO_URL, readEvidenceDoc } from '@/lib/evidence-doc';
import { CHECK_NAMES, PLAIN_LEADS } from '@/lib/glossary';

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
      const details = section.querySelector('details');
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
