import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CHECK_IDS, EVIDENCE, PRESET_WEIGHTS, UNSCORED_CHECKS } from '@citation-equity/engine';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckChip } from '@/components/check-chip';
import { GradeLabel } from '@/components/grade-label';
import { CHECK_NAMES, CHIP_TEXT, chipFor, GRADE_MEANING, GRADE_WORDS } from '@/lib/glossary';

// One grade label (on /research only), one chip for the working screens and one plain-name
// glossary, so a grade, a chip or a check reads the same everywhere.

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

/** Files that type `line` as a string literal, in single quotes or (for a line with an apostrophe) double. */
const typing = (line: string) => [
  ...new Set([...containing(`'${line}'`), ...containing(`"${line}"`)]),
];

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
    for (const line of lines) expect(typing(line), line).toEqual(['lib/glossary.ts']);
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
});

describe('CheckChip', () => {
  it('gives "Helps" to the checks our tests found to help and "Not scored" to the unscored notes', () => {
    for (const id of CHECK_IDS) {
      const chip = chipFor(id, PRESET_WEIGHTS.foundation[id]);
      if (UNSCORED_CHECKS.includes(id)) expect(chip, id).toBe('not-scored');
      else if (EVIDENCE[id].e1.label === 'helps') expect(chip, id).toBe('helps');
      else expect(chip, id).toBeNull();
    }
    expect(CHECK_IDS.filter((id) => chipFor(id, 1) === 'helps')).toEqual([
      'question-coverage',
      'reader-words',
    ]);
    // A custom weight that counts an unscored note drops its "Not scored".
    expect(chipFor('question-headings', 0.5)).toBeNull();
  });

  it('shows one word and a one-sentence tooltip, with no numbers', () => {
    expect(CHIP_TEXT['not-scored'].title).toBe('Our tests found no clear effect on AI citation.');
    for (const chip of ['helps', 'not-scored'] as const) {
      const { container, unmount } = render(<CheckChip chip={chip} />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.textContent).toBe(CHIP_TEXT[chip].label);
      expect(el.title).toBe(CHIP_TEXT[chip].title);
      expect(el.title).not.toMatch(/\d/);
      unmount();
    }
    const { container } = render(<CheckChip chip={null} />);
    expect(container.textContent).toBe('');
  });
});
