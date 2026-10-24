import { describe, expect, it } from 'vitest';
import { hasComparisonLanguage, isComparisonHeading } from '../../src/checks/comparison-language';
import { check } from '../../src/checks/comparisons';
import { EVIDENCE, gather, parseDraft } from '../../src/index';
import none from '../fixtures/checks/comparisons/none.md?raw';
import pass from '../fixtures/checks/comparisons/pass.md?raw';

const run = (md: string) => check(gather(parseDraft(md)));
const slice = (md: string, r: { start: number; end: number }) => md.slice(r.start, r.end);

describe('comparisons', () => {
  it('does not apply to drafts under 300 words', () => {
    expect(run('# Roasts\n\nLight roasts taste brighter than dark roasts.\n').applicable).toBe(
      false,
    );
  });

  it('finds an explicit comparison in prose', () => {
    expect(hasComparisonLanguage('Light roasts taste brighter than dark roasts.')).toBe(true);
    const r = run(pass);
    expect(r).toMatchObject({ checkId: 'comparisons', applicable: true, score: 1 });
    expect(r.metrics.comparisons).toBeGreaterThanOrEqual(1);
    expect(r.suggestions).toEqual([]);
  });

  it('scores 0 on a long draft with no comparison language and advises without inventing', () => {
    expect(gather(parseDraft(none)).wordCount).toBeGreaterThanOrEqual(400);
    const r = run(none);
    expect(r.applicable).toBe(true);
    expect(r.score).toBe(0);
    expect(r.metrics.comparisons).toBe(0);
    expect(r.suggestions).toHaveLength(1);
    const [s] = r.suggestions;
    expect(s?.kind).toBe('advisory');
    expect(s?.grade).toBe(EVIDENCE.comparisons.grade);
    expect(slice(none, s?.range ?? { start: 0, end: 0 })).toBe(s?.before);
    expect(s?.rationale).toContain(
      'If readers choose between options here, compare them explicitly: what each is better for, with real differences.',
    );
    expect(s?.rationale).toContain(`Evidence grade: ${EVIDENCE.comparisons.grade}.`);
    expect(s?.rationale).not.toMatch(/invent (?:a|some)|make up/i);
  });

  it('turns to 1 when one comparison sentence is added', () => {
    const md = `${none}\nLight roasts taste brighter than dark roasts.\n`;
    expect(run(md).score).toBe(1);
  });

  it('counts comparison headings, X-or-Y question headings and table rows', () => {
    expect(isComparisonHeading('Burr vs blade grinders')).toBe(true);
    expect(isComparisonHeading('Should you buy a burr or a blade grinder?')).toBe(true);
    expect(isComparisonHeading('Light or dark roast?')).toBe(true);
    expect(isComparisonHeading('Pros and cons of pods')).toBe(true);
    expect(isComparisonHeading('Salt and pepper')).toBe(false);
    expect(isComparisonHeading('Milk or sugar')).toBe(false);
    const table =
      '\n| Grinder | Notes |\n| --- | --- |\n| Burr | grinds more evenly than a blade |\n';
    expect(run(`${none}${table}`).score).toBe(1);
    expect(run(`${none}\n## Moka pot or espresso machine?\n\nBoth work.\n`).score).toBe(1);
  });

  it('recognises the listed comparison phrases and skips quantity bounds', () => {
    for (const s of [
      'The burr grinder versus the blade grinder.',
      'Moka pot vs. espresso machine.',
      'Compared with a moka pot, the machine is quicker.',
      'Unlike pods, fresh beans keep their aroma.',
      'Use filtered water instead of tap water.',
      'Here are three alternatives to a lever machine.',
      'The pros and cons of a single boiler.',
      'Which is better for milk drinks?',
    ])
      expect(hasComparisonLanguage(s), s).toBe(true);
    for (const s of [
      'Pull the shot for more than 25 seconds.',
      'Use less than 20 grams of coffee.',
      'Nobody other than the barista touches the machine.',
      'Grind the beans and brew.',
      'For me coffee is more than a hobby.',
      'The result was less than ideal.',
      'One scoop is more than enough.',
    ])
      expect(hasComparisonLanguage(s), s).toBe(false);
    // A real comparison next to an idiom still counts.
    expect(hasComparisonLanguage('It is more than a hobby, and cheaper than a gym.')).toBe(true);
    expect(hasComparisonLanguage('Light roasts taste brighter than a dark roast.')).toBe(true);
  });

  it('counts "more than a ..." as a comparison unless it follows "is" or a similar verb', () => {
    for (const s of [
      'A home espresso costs more than a latte.',
      'A burr grinder weighs less than a moka pot.',
    ])
      expect(hasComparisonLanguage(s), s).toBe(true);
    for (const s of [
      "It's more than a hobby.",
      'Coffee is much more than a drink.',
      'Espresso became more than an habit for her.',
      'It felt like no more than a guess.',
    ])
      expect(hasComparisonLanguage(s), s).toBe(false);
  });

  it('needs a "?" for an "X or Y" heading', () => {
    expect(isComparisonHeading('How to clean or descale the boiler')).toBe(false);
    expect(isComparisonHeading('How to clean or descale the boiler?')).toBe(true);
  });
});
