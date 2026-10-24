import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CHECK_IDS, E1_MODELS, EVIDENCE, formatE1 } from '@citation-equity/engine';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GradeLabel } from '@/components/grade-label';
import { CHECK_NAMES, E1_WORDS, GRADE_MEANING, GRADE_WORDS, UNSCORED_NOTES } from '@/lib/glossary';

// One grade label and one plain-name glossary for the draft groups, the site rows,
// /cited and /research, so a grade or a check reads the same everywhere.

afterEach(cleanup);

const root = join(__dirname, '..');

/** Every app source file (app/, components/, lib/), relative to the app root. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.next', 'out', 'generated'].includes(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) out.push(relative(root, path));
    }
  };
  for (const dir of ['app', 'components', 'lib']) walk(join(root, dir));
  return out;
}

const containing = (text: string) =>
  sources().filter((f) => readFileSync(join(root, f), 'utf8').includes(text));

describe('the glossary', () => {
  it('names every check and every grade once', () => {
    expect(Object.keys(CHECK_NAMES).sort()).toEqual([...CHECK_IDS].sort());
    expect(Object.keys(GRADE_WORDS).sort()).toEqual(['mixed', 'moderate', 'strong', 'untested']);
    expect(Object.keys(GRADE_MEANING).sort()).toEqual(Object.keys(GRADE_WORDS).sort());
  });

  it('is the only place a grade word, a grade meaning or a check name is typed', () => {
    const lines = [
      ...Object.values(GRADE_WORDS).filter((w) => w !== 'Untested'),
      ...Object.values(GRADE_MEANING),
      ...Object.values(CHECK_NAMES),
    ];
    for (const line of lines) expect(containing(`'${line}'`), line).toEqual(['lib/glossary.ts']);
  });

  it('leaves one grade label component, and no old panel files', () => {
    expect(containing('export function GradeLabel')).toEqual(['components/grade-label.tsx']);
    for (const old of [
      'components/draft/grade-label.tsx',
      'components/cited/grade-label.tsx',
      'components/panel',
    ]) {
      expect(existsSync(join(root, old)), old).toBe(false);
    }
  });
});

describe('GradeLabel', () => {
  it('shows four pips and the grade word, quietly, for every grade', () => {
    for (const grade of ['strong', 'moderate', 'mixed', 'untested'] as const) {
      const { container, unmount } = render(<GradeLabel grade={grade} />);
      expect(container.textContent).toBe(GRADE_WORDS[grade]);
      expect(container.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(4);
      expect(container.querySelector('button')).toBeNull();
      unmount();
    }
  });

  it("with a check, opens that check's meaning and links its studies", async () => {
    const id = CHECK_IDS.find((c) => c !== 'lists' && EVIDENCE[c].grade === 'mixed') ?? 'tables';
    render(<GradeLabel grade={EVIDENCE[id].grade} checkId={id} />);
    fireEvent.click(screen.getByRole('button', { name: GRADE_WORDS[EVIDENCE[id].grade] }));
    const pop = await screen.findByRole('dialog');
    expect(pop.textContent).toContain(GRADE_MEANING[EVIDENCE[id].grade]);
    expect(within(pop).getByRole('link', { name: 'See the studies' }).getAttribute('href')).toMatch(
      new RegExp(`/research/?#check-${id}$`),
    );
  });

  it('with a check, says what our own test found, with numbers for a measured check', async () => {
    for (const id of CHECK_IDS) {
      const { unmount } = render(<GradeLabel grade={EVIDENCE[id].grade} checkId={id} />);
      fireEvent.click(screen.getByRole('button', { name: GRADE_WORDS[EVIDENCE[id].grade] }));
      const pop = await screen.findByRole('dialog');
      expect(pop.textContent, id).toContain(E1_WORDS[EVIDENCE[id].e1.label]);
      if (EVIDENCE[id].e1.label === 'helps') {
        expect(pop.textContent, id).toContain(formatE1(EVIDENCE[id].e1));
        expect(pop.textContent, id).toContain(E1_MODELS);
      }
      if (id === 'lists') expect(pop.textContent).toContain(UNSCORED_NOTES.lists ?? 'missing');
      unmount();
    }
  });
});
