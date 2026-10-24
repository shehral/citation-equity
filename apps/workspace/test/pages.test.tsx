import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CAVEAT } from '@citation-equity/bench';
import { CHECK_DEFINITIONS } from '@citation-equity/engine';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import AboutPage from '@/app/about/page';
import EvidencePage from '@/app/evidence/page';
import { evidenceIntro, REPO_URL, readEvidenceDoc } from '@/lib/evidence-doc';
import { EVIDENCE_STANCE } from '@/lib/presets';

afterEach(cleanup);

const EM_DASH = '—';

describe('/evidence', () => {
  it('lists every check with its grade, summary, sources and both preset weights', () => {
    render(<EvidencePage />);
    for (const def of CHECK_DEFINITIONS) {
      const section = screen.getByRole('region', { name: def.title });
      const text = section.textContent ?? '';
      expect(text).toContain(`Evidence: ${def.evidence.grade}`);
      expect(text).toContain(def.evidence.summary);
      expect(text).toContain(`Foundation design weight ${def.defaultWeights.foundation}`);
      expect(text).toContain(`Evidence-weighted weight ${def.defaultWeights.evidence}`);
      for (const source of def.evidence.sources) {
        const link = within(section).getByRole('link', { name: source.citation });
        expect(link.getAttribute('href')).toBe(source.url);
      }
    }
  });

  it('shows all ten checks, the two added for target questions and comparisons among them', () => {
    render(<EvidencePage />);
    expect(CHECK_DEFINITIONS).toHaveLength(10);
    for (const title of ['Target questions answered', 'Explicit comparisons'])
      expect(screen.getByRole('region', { name: title })).toBeTruthy();
  });

  it('renders the intro of docs/evidence.md, with relative links pointed at the repo', () => {
    render(<EvidencePage />);
    expect(screen.getByRole('heading', { name: 'Why the score is not a prediction' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How grades are assigned' })).toBeTruthy();
    const notes = screen.getByRole('link', { name: 'research/evidence-notes.md' });
    expect(notes.getAttribute('href')).toBe(
      `${REPO_URL}/blob/main/docs/research/evidence-notes.md`,
    );
    expect(document.body.textContent).toContain('None of the checks has strong evidence');
    expect(document.body.textContent).toContain('Prof. Akram Bayat');
    expect(document.body.textContent).not.toMatch(/\bDr\.? (Akram )?Bayat/);
    expect(document.body.textContent).not.toMatch(/contradicted/i);
    expect(document.body.textContent).not.toContain(EM_DASH);
  });
});

describe('evidenceIntro', () => {
  it('stops at the first per-check section of the document', () => {
    const intro = evidenceIntro(readEvidenceDoc());
    const headings = intro
      .filter((n) => n.type === 'heading')
      .map((n) =>
        'children' in n ? n.children.map((c) => ('value' in c ? c.value : '')).join('') : '',
      );
    expect(headings).toContain('Why the score is not a prediction');
    expect(headings.some((h) => h.includes('Standalone paragraphs'))).toBe(false);
    // The H1 is the page's own title, not repeated from the document.
    expect(intro.some((n) => n.type === 'heading' && n.depth === 1)).toBe(false);
  });
});

describe('/about', () => {
  it('credits the PI, the builders and the university, and links the repos', () => {
    render(<AboutPage />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Prof. Akram Bayat');
    expect(text).not.toMatch(/\bDr\.? (Akram )?Bayat/);
    expect(text).toMatch(/principal investigator/i);
    expect(text).toContain('Mohammad Ali Shehral');
    expect(text).toContain('Ishan Gupta');
    expect(text).toContain('Northeastern University');
    expect(text).toContain('Khoury College of Computer Sciences');
    expect(text).toContain('San Jose');
    expect(text).toContain('SPARK');
    expect(text).toContain(CAVEAT);
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toMatch(/\b(he|him|his)\b/);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://github.com/shehral/citation-equity');
    expect(hrefs).toContain('https://github.com/shehral/geo-measurement-prototype');
    expect(hrefs).toContain('https://github.com/shehral/footnoteone');
  });

  it('says the engine runs ten checks, four of them added to her six', () => {
    render(<AboutPage />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('runs ten checks');
    expect(text).toContain('four added checks weigh half as much');
    expect(text).not.toMatch(/\beight checks\b|\btwo added checks\b/);
  });

  it('describes the three modules', () => {
    render(<AboutPage />);
    for (const name of [/engine/i, /workspace/i, /test bench/i]) {
      expect(screen.getAllByRole('heading', { name }).length).toBeGreaterThan(0);
    }
  });
});

describe('evidence stance copy (R14)', () => {
  it('is rendered from the one EVIDENCE_STANCE string on /evidence and /about', () => {
    render(<EvidencePage />);
    expect(document.body.textContent).toContain(EVIDENCE_STANCE);
    cleanup();
    render(<AboutPage />);
    expect(document.body.textContent).toContain(EVIDENCE_STANCE);
  });

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
