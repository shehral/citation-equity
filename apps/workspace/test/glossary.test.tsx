import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  CHECK_IDS,
  type CheckId,
  QUESTION_LABELS,
  type QuestionInput,
  TEST_LABEL_TEXT,
  TEST_LABELS,
  type TestLabel,
} from '@citation-equity/engine';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as chips from '@/components/check-chip';
import { LabelChip } from '@/components/check-chip';
import { GradeLabel } from '@/components/grade-label';
import * as glossary from '@/lib/glossary';
import {
  CHECK_NAMES,
  GRADE_MEANING,
  GRADE_WORDS,
  type LabelContext,
  labelFor,
  labelTooltip,
  labelWords,
} from '@/lib/glossary';

// One grade label (on /research only), one label chip for what our tests found and one
// plain-name glossary, so a grade, a label or a check reads the same everywhere.

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

  it('never retypes a label phrase: the engine holds them', () => {
    for (const phrase of Object.values(TEST_LABEL_TEXT)) expect(typing(phrase), phrase).toEqual([]);
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

describe('what is left of the score build', () => {
  it('keeps only the words the screens use: names, grades, labels and our tests in words', () => {
    expect(Object.keys(glossary).sort()).toEqual([
      'CHECK_NAMES',
      'E1_COMBINED_SENTENCE',
      'E1_WORDS',
      'GRADE_MEANING',
      'GRADE_WORDS',
      'PLAIN_LEADS',
      'labelFor',
      'labelTooltip',
      'labelWords',
      'ownTestWords',
    ]);
  });

  it('has one chip, the label chip: no "Helps" or "Not scored" chip', () => {
    expect(Object.keys(chips)).toEqual(['LabelChip']);
  });
});

const LABELS = Object.keys(TEST_LABEL_TEXT) as TestLabel[];
const INPUTS: QuestionInput[] = ['reader', 'keyword', 'local-model', 'page'];
const OWN_TESTS: LabelContext['e1'][] = [
  'helps',
  'no-effect',
  'insufficient-n',
  'inconclusive',
  'not-run',
  'descriptive',
  'model-dependent',
];

/** Every context a label can be shown in: none, each question input, each own-test result, a readiness note, the card. */
const CONTEXTS: LabelContext[] = [
  {},
  ...INPUTS.map((input) => ({ input })),
  ...OWN_TESTS.map((e1) => ({ e1 })),
  { readiness: true },
  { card: true },
  { card: true, input: 'reader' },
];

describe('labelFor', () => {
  it("gives each of the 11 checks the engine's label", () => {
    expect(CHECK_IDS).toHaveLength(11);
    for (const id of CHECK_IDS) expect(labelFor(id), id).toBe(TEST_LABELS[id]);
  });

  it('reads another label table when given one', () => {
    const labels = Object.fromEntries(CHECK_IDS.map((id) => [id, 'hurt'])) as Record<
      CheckId,
      TestLabel
    >;
    for (const id of CHECK_IDS) expect(labelFor(id, labels), id).toBe('hurt');
  });
});

describe('labelTooltip', () => {
  it('gives one plain sentence with no digit for every label in every context', () => {
    for (const label of LABELS) {
      for (const context of CONTEXTS) {
        const tip = labelTooltip(label, context);
        const where = `${label} ${JSON.stringify(context)}`;
        expect(tip.trim(), where).not.toBe('');
        expect(tip, where).not.toMatch(/\d/);
        expect(tip.split(/(?<=\.)\s+/), where).toHaveLength(1);
        expect(tip, where).toMatch(/\.$/);
      }
    }
  });

  it('words the measured labels', () => {
    expect(labelTooltip('helped', { input: 'reader' })).toBe(
      "In our test this raised citation a little when the question was the reader's own.",
    );
    expect(labelTooltip('helped')).toBe(labelTooltip('helped', { input: 'reader' }));
    expect(labelTooltip('may-help-less', { input: 'keyword' })).toBe(
      'Our test found a smaller gain when the question was a guess.',
    );
    expect(labelTooltip('no-effect', { e1: 'no-effect' })).toBe(
      'Our test ruled out a large effect; a small one either way is possible.',
    );
    expect(labelTooltip('hurt')).toBe('In our test this lowered citation a little.');
  });

  it("words a guess's measured labels by where the question came from", () => {
    // A guess's question that helped less than the reader's own, on a row or for the card.
    expect(labelTooltip('may-help-less', { input: 'local-model', card: true })).toBe(
      'Our test found a smaller gain when the question was a guess.',
    );
    // A local model's question that showed no clear gain.
    const localModel =
      'Our test found no clear gain when a local model wrote the question from a keyword.';
    expect(labelTooltip('no-effect', { input: 'local-model' })).toBe(localModel);
    expect(labelTooltip('no-effect', { input: 'local-model', card: true })).toBe(localModel);
    // Elsewhere No effect keeps its general sentence: a keyword's words up top, a note.
    const general = 'Our test ruled out a large effect; a small one either way is possible.';
    expect(labelTooltip('no-effect', { input: 'keyword' })).toBe(general);
    expect(labelTooltip('no-effect', { input: 'reader' })).toBe(general);
    expect(labelTooltip('no-effect')).toBe(general);
  });

  it('says why a result is unclear, by its own-test result', () => {
    const tips: Record<Exclude<LabelContext['e1'], undefined>, string> = {
      inconclusive: 'Our test could not tell either way.',
      'insufficient-n': 'Too few pages in our test to judge.',
      descriptive: 'Our test setup cannot judge this check.',
      'not-run': "No edit passed our test's checks.",
      'model-dependent': "Our test's two judge models disagreed.",
      // An Unclear label that came from somewhere else (a later test) reads as undecided.
      helps: 'Our test could not tell either way.',
      'no-effect': 'Our test could not tell either way.',
    };
    for (const [e1, tip] of Object.entries(tips))
      expect(labelTooltip('unclear', { e1: e1 as LabelContext['e1'] }), e1).toBe(tip);
    expect(labelTooltip('unclear')).toBe('Our test could not tell either way.');
  });

  it('says what our tests did not cover, by question input or for a readiness note', () => {
    expect(labelTooltip('not-tested', { input: 'page' })).toBe(
      "Our tests used the reader's own question, not one made from your page.",
    );
    expect(labelTooltip('not-tested', { input: 'keyword' })).toBe(
      "Our tests used the reader's own question, not a guess from a keyword.",
    );
    // A local AI's question was tested for a section that answers it, not for its words up top.
    expect(labelTooltip('not-tested', { input: 'local-model' })).toBe(
      "Our test did not work a local AI's question into the top.",
    );
    expect(labelTooltip('not-tested', { readiness: true })).toBe('Our tests did not cover this.');
    expect(labelTooltip('not-tested')).toBe('Our tests did not cover this.');
  });

  it("keeps the local AI's Not tested tooltip on the words line only", () => {
    // The tooltip is chosen by input, not by line, so it is only right while the local AI's
    // answered line carries a measured label (E5 tested that line); a change to E5's data that
    // left it Not tested would need a line-aware tooltip.
    expect(QUESTION_LABELS['local-model'].answer).not.toBe('not-tested');
    expect(QUESTION_LABELS['local-model'].words).toBe('not-tested');
  });

  it("gives the card's Helped chip its own tooltip: the count itself was not tested", () => {
    const card =
      "Each edit raised citation a little in our test, with the reader's own question; the count was not tested.";
    expect(labelTooltip('helped', { card: true })).toBe(card);
    expect(labelTooltip('helped', { card: true, input: 'reader' })).toBe(card);
    // Any other label on the card reads as it does on a row.
    expect(labelTooltip('not-tested', { card: true, input: 'page' })).toBe(
      labelTooltip('not-tested', { input: 'page' }),
    );
  });
});

describe('labelWords', () => {
  it("words E5's labels as the results file does, with the gate's and a cut contrast's plainly", () => {
    expect(labelWords('helps')).toBe('helps');
    expect(labelWords('helps, possibly through length or query-term overlap')).toBe(
      'helps, possibly through length or query-term overlap',
    );
    expect(labelWords('no effect larger than δ')).toBe('no effect larger than 0.03');
    expect(labelWords('inconclusive')).toBe('inconclusive');
    expect(labelWords('insufficient n')).toBe('insufficient n');
    expect(labelWords('hurts')).toBe('hurts');
    expect(labelWords('model-dependent')).toBe('model-dependent');
    expect(labelWords('descriptive (gate failed)')).toBe('no verdict (the gate did not pass)');
    expect(labelWords('not run')).toBe('not run');
    expect(labelWords(null)).toBe('not run');
  });
});

describe('LabelChip', () => {
  const STYLE: Record<TestLabel, string[]> = {
    helped: ['bg-done-soft', 'text-done'],
    'may-help-less': ['bg-stale-soft', 'text-stale'],
    hurt: ['bg-stale-soft', 'text-stale'],
    'no-effect': ['border', 'bg-surface', 'text-ink-soft'],
    unclear: ['border', 'bg-surface', 'text-ink-soft'],
    'not-tested': ['border', 'bg-surface', 'text-ink-soft'],
  };

  it("shows the engine's phrase for each label, its tooltip as the title, and marks itself", () => {
    for (const label of LABELS) {
      const tip = labelTooltip(label);
      const { container, unmount } = render(<LabelChip label={label} tooltip={tip} />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.textContent, label).toBe(TEST_LABEL_TEXT[label]);
      expect(el.title, label).toBe(tip);
      expect(el.hasAttribute('data-label-chip'), label).toBe(true);
      for (const cls of STYLE[label])
        expect(el.classList.contains(cls), `${label} ${cls}`).toBe(true);
      unmount();
    }
  });

  it('keeps the tones apart: done only for helped, stale only for may-help-less and hurt', () => {
    for (const label of LABELS) {
      const { container, unmount } = render(<LabelChip label={label} />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.classList.contains('text-done'), label).toBe(label === 'helped');
      expect(el.classList.contains('text-stale'), label).toBe(
        label === 'may-help-less' || label === 'hurt',
      );
      // No tooltip given, no title.
      expect(el.hasAttribute('title'), label).toBe(false);
      unmount();
    }
  });

  it('takes extra classes', () => {
    const { container } = render(<LabelChip label="unclear" className="ml-2" />);
    expect((container.firstElementChild as HTMLElement).classList.contains('ml-2')).toBe(true);
  });
});
