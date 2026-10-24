import { describe, expect, it } from 'vitest';
import { check, findStatistics } from '../../src/checks/statistics';
import { analyze, EVIDENCE, gather, parseDraft } from '../../src/index';
import fail from '../fixtures/checks/statistics/fail.md?raw';
import pass from '../fixtures/checks/statistics/pass.md?raw';

const run = (md: string) => check(gather(parseDraft(md)));
const slice = (md: string, r: { start: number; end: number }) => md.slice(r.start, r.end);
/** Prose with no numbers: 8 words per sentence. */
const filler = (sentences: number) =>
  Array.from({ length: sentences }, () => 'Fresh coffee tastes sweet when brewed with care.').join(
    ' ',
  );
const found = (text: string) => findStatistics(text).map((r) => text.slice(r.start, r.end));

describe('statistics check', () => {
  it('passes a draft with enough numbers in context', () => {
    const result = run(pass);
    expect(result.checkId).toBe('statistics');
    expect(result.applicable).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.suggestions.filter((s) => s.kind === 'advisory')).toEqual([]);
    expect(result.metrics.statistics).toBeGreaterThanOrEqual(10);
  });

  it('fails a draft whose only numbers are a year, list numbers and code', () => {
    const result = run(fail);
    expect(result.applicable).toBe(true);
    expect(result.score).toBeLessThanOrEqual(0.2);
    expect(result.metrics.statistics).toBe(0);
    expect(result.suggestions).toHaveLength(1);
    const [s] = result.suggestions;
    expect(s?.kind).toBe('advisory');
    expect(s?.grade).toBe(EVIDENCE.statistics.grade);
    expect(slice(fail, s?.range ?? { start: 0, end: 0 })).toBe(s?.before);
    // The heading of the longest section without a statistic.
    expect(s?.before).toBe('Why did the menu change?');
    expect(result.findings.map((f) => f.range)).toEqual([s?.range]);
  });

  it('keeps the advisory id when the section text changes', () => {
    const id = (md: string) => run(md).suggestions[0]?.id;
    expect(id(fail.replace('Pull the shot.', 'Pull the shot slowly.'))).toBe(id(fail));
  });

  it('anchors on the top of the draft when the lead section is the target', () => {
    const md = `# Coffee notes\n\n${filler(20)}\n`;
    const [s] = run(md).suggestions;
    expect(s?.before).toBe('Coffee notes');
  });

  it('anchors on the first sentence when no heading leads the draft, so later edits keep the id', () => {
    const md = `Espresso is a small strong coffee. ${filler(20)}\n`;
    const [s] = run(md).suggestions;
    expect(s?.before).toBe('Espresso is a small strong coffee.');
    const edited = md.replace(
      'Espresso is a small strong coffee. ',
      'Espresso is a small strong coffee. Yes. ',
    );
    expect(run(edited).suggestions[0]?.id).toBe(s?.id);
  });

  it('does not count figures in footnote definitions', () => {
    const md = `${filler(20)} A study says so.[^1]\n\n[^1]: Example Lab report, 40 samples, 2024.\n`;
    expect(run(md).metrics.statistics).toBe(0);
  });

  it('does not apply under 150 words', () => {
    expect(run('Espresso uses 18 g of coffee.').applicable).toBe(false);
  });

  it('excludes bare years and counts numbers with units', () => {
    expect(found('Founded in 1998.')).toEqual([]);
    expect(found('Extraction takes 25 to 30 seconds and 18 g of coffee.')).toEqual([
      '25 to 30 seconds',
      '18 g',
    ]);
  });

  it.each([
    ['65% of baristas agree.', ['65%']],
    ['A grinder costs $250.', ['$250']],
    ['Prices run from $400 to $700.', ['$400 to $700']],
    ['Brew at 94 °C or 201°F.', ['94 °C', '201°F']],
    ['We asked 40 home baristas.', ['40 home baristas']],
    ['Sales grew 3x in 2 years.', ['3x', '2 years']],
    ['The cafe served 1,200 customers.', ['1,200 customers']],
    ['It reached 2.5 million downloads.', ['2.5 million']],
    ['A 28s shot tasted sweet.', ['28s']],
    ['A latte has about 2000 calories less than you fear.', ['2000 calories']],
    [
      'The app has 1.5M downloads and 10K reviews, and the model has 2B parameters.',
      ['1.5M', '10K', '2B'],
    ],
    ['The round raised $5M.', ['$5M']],
    ['A 5MB file.', ['5MB']],
  ])('finds statistics in %j', (text, expected) => {
    expect(found(text)).toEqual(expected);
  });

  it.each([
    'Step 3 is to tamp.',
    'Pull the 2nd shot.',
    'Use H2 headings and OCR-3 output.',
    'In 2024 the shop moved.',
    'Chapter 2 explains the idea.',
    'Section 4 covers milk.',
    'See figure 3 for details.',
    'A 1:2 ratio works.',
    'The shop opens at 7:30 daily.',
    'The 1990s were busy.',
    'See figure 3B for details.',
  ])('finds no statistic in %j', (text) => {
    expect(found(text)).toEqual([]);
  });

  it('ignores numbers in fenced code, inline code and front matter (Review Focus 2)', () => {
    const md = `---\nshare: 50%\n---\n\n${filler(20)}\n\n\`\`\`\nrate = "42%"\n\`\`\`\n\nThe value \`42%\` is code.\n`;
    const result = run(md);
    expect(result.applicable).toBe(true);
    expect(result.metrics.statistics).toBe(0);
  });

  it('counts statistics in table cells', () => {
    const md = `${filler(20)}\n\n| Setting | Value |\n| --- | --- |\n| Dose | 18 g |\n| Time | 28 s |\n`;
    expect(run(md).metrics.statistics).toBe(2);
  });

  it('scores statistics per 300 words', () => {
    const md = `${filler(40)} A shot uses 18 g of coffee.`;
    const result = run(md);
    expect(result.metrics.statistics).toBe(1);
    expect(result.score).toBeCloseTo(300 / result.metrics.words, 5);
  });

  it('gives the same suggestion ids on every run', () => {
    const ids = () =>
      analyze(fail)
        .checks.find((c) => c.checkId === 'statistics')
        ?.suggestions.map((s) => s.id);
    expect(ids()).toHaveLength(1);
    expect(ids()).toEqual(ids());
  });
});

describe('statistics advice copy', () => {
  it('asks for real, sourced figures and states the evidence grade', () => {
    const [s] = run(fail).suggestions;
    expect(s?.rationale).toContain('Add only real figures from a source you can name or link.');
    expect(s?.rationale).toContain(
      'In the larger studies, adding statistics for their own sake did not help and often lowered',
    );
    expect(s?.rationale).toContain(`Evidence grade: ${EVIDENCE.statistics.grade}.`);
    expect(s?.rationale).not.toMatch(new RegExp(['contra', 'dicted'].join(''), 'i'));
  });
});
