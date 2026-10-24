import { describe, expect, it } from 'vitest';
import { check } from '../../src/checks/lists';
import { countWords, EVIDENCE, gather, parseDraft } from '../../src/index';
import fail from '../fixtures/checks/lists/fail.md?raw';
import pass from '../fixtures/checks/lists/pass.md?raw';

const run = (md: string) => check(gather(parseDraft(md)));
const slice = (md: string, r: { start: number; end: number }) => md.slice(r.start, r.end);

/** fail.md with one more paragraph inserted before its last paragraph. */
const withParagraph = (paragraph: string) =>
  fail.replace('A clean machine', `${paragraph}\n\nA clean machine`);

describe('lists', () => {
  it('scores 1 when the draft has a list of three or more items', () => {
    const r = run(pass);
    expect(r.checkId).toBe('lists');
    expect(r.applicable).toBe(true);
    expect(r.score).toBe(1);
    expect(r.suggestions).toEqual([]);
    expect(r.metrics).toMatchObject({ lists: 1, longestList: 3 });
  });

  it('scores 0 without a list or an enumeration and points at the longest paragraph', () => {
    const r = run(fail);
    expect(r.applicable).toBe(true);
    expect(r.score).toBeLessThanOrEqual(0.2);
    expect(r.metrics).toMatchObject({ lists: 0, enumeratingParagraphs: 0 });
    expect(r.suggestions).toHaveLength(1);
    const [s] = r.suggestions;
    expect(s?.kind).toBe('advisory');
    expect(s?.grade).toBe(EVIDENCE.lists.grade);
    expect(slice(fail, s?.range ?? { start: 0, end: 0 })).toBe(s?.before);
    expect(s?.before).toMatch(/^Once a week the machine needs a deeper clean/);
  });

  it('scores 0.5 and advises on a paragraph that enumerates three items', () => {
    const para = 'Bitter shots usually come from a fine grind, a high dose, or hot water.';
    const md = withParagraph(para);
    const r = run(md);
    expect(r.score).toBe(0.5);
    expect(r.metrics.enumeratingParagraphs).toBe(1);
    expect(r.suggestions.map((s) => s.before)).toEqual([para]);
    expect(slice(md, r.suggestions[0]?.range ?? { start: 0, end: 0 })).toBe(para);
    expect(r.findings).toHaveLength(1);
  });

  it('still suggests, and says every suggestion is not scored and why', () => {
    const note =
      'Not scored in Standard or By evidence: our own test (E1) found no effect larger than 0.03 (d -0.007, 90% CI [-0.027, +0.013], n 33).';
    const enumerating = run(
      withParagraph('Bitter shots usually come from a fine grind, a high dose, or hot water.'),
    );
    for (const r of [run(fail), enumerating]) {
      expect(r.suggestions.length).toBeGreaterThan(0);
      for (const s of r.suggestions) expect(s.rationale).toContain(note);
    }
  });

  it('detects semicolon-separated enumerations', () => {
    const para =
      'Each morning we check the scale for drift; we taste a test shot; we wipe the steam wand.';
    expect(run(withParagraph(para)).score).toBe(0.5);
  });

  it('detects an enumeration longer than the capped comma run', () => {
    const items = Array.from({ length: 20 }, (_, i) => `bean ${i + 1}`);
    const para = `We tasted ${items.slice(0, -1).join(', ')}, and ${items.at(-1)}.`;
    expect(run(withParagraph(para)).score).toBe(0.5);
  });

  it('does not treat clauses joined by commas as an enumeration', () => {
    const para = 'When the grind is fine, the shot runs slow, and the taste turns bitter.';
    expect(run(withParagraph(para)).metrics.enumeratingParagraphs).toBe(0);
    expect(run(withParagraph('Grind and dose matter, and so does water.')).score).toBe(0);
  });

  it('does not count an introductory phrase as an item', () => {
    for (const para of [
      'For example, salt and pepper both change taste.',
      'However, grind and dose matter most.',
      'In 2024, roasters and cafes raised prices.',
    ])
      expect(run(withParagraph(para)).metrics.enumeratingParagraphs, para).toBe(0);
    // Three items after the opener still enumerate.
    expect(run(withParagraph('For example, salt, pepper and oil all change taste.')).score).toBe(
      0.5,
    );
  });

  it('does not count a two-item list as a list', () => {
    const r = run(withParagraph('- Grind\n- Dose'));
    expect(r.metrics).toMatchObject({ lists: 1, longestList: 2 });
    expect(r.score).toBe(0);
  });

  it('is not applicable under 300 words', () => {
    const short = 'A short draft about grind, dose, and water.';
    expect(countWords(short)).toBeLessThan(300);
    const r = run(short);
    expect(r.applicable).toBe(false);
    expect(r.suggestions).toEqual([]);
  });

  it('fixtures sit above the 300-word floor', () => {
    expect(gather(parseDraft(fail)).wordCount).toBeGreaterThanOrEqual(300);
    expect(gather(parseDraft(pass)).wordCount).toBeGreaterThanOrEqual(300);
  });
});
