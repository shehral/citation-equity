import { describe, expect, it } from 'vitest';
import { check } from '../../src/checks/standalone-paragraphs';
import { EVIDENCE, gather, parseDraft } from '../../src/index';
import fail from '../fixtures/checks/standalone-paragraphs/fail.md?raw';
import pass from '../fixtures/checks/standalone-paragraphs/pass.md?raw';

const run = (md: string) => check(gather(parseDraft(md)));
const slice = (md: string, r: { start: number; end: number }) => md.slice(r.start, r.end);

describe('standalone-paragraphs', () => {
  it('passes paragraphs of 40 to 150 words that name their subject', () => {
    const r = run(pass);
    expect(r.checkId).toBe('standalone-paragraphs');
    expect(r.applicable).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.suggestions.filter((s) => s.kind === 'advisory')).toEqual([]);
    expect(r.findings).toEqual([]);
    // The list items and the blockquote are not judged as paragraphs.
    expect(r.metrics).toMatchObject({ paragraphs: 3, standalone: 3 });
  });

  it('flags paragraphs that open with an unresolved reference or miss the length window', () => {
    const r = run(fail);
    expect(r.applicable).toBe(true);
    expect(r.score).toBeLessThanOrEqual(0.2);
    expect(r.metrics).toMatchObject({
      paragraphs: 4,
      standalone: 0,
      unresolvedOpeners: 3,
      tooShort: 3,
      tooLong: 0,
    });
    expect(r.suggestions).toHaveLength(4);
    for (const s of r.suggestions) {
      expect(s.kind).toBe('advisory');
      expect(s.checkId).toBe('standalone-paragraphs');
      expect(s.grade).toBe(EVIDENCE['standalone-paragraphs'].grade);
      expect(slice(fail, s.range)).toBe(s.before);
    }
    expect(r.suggestions.map((s) => s.before)).toEqual([
      expect.stringMatching(/^This is the part most people get wrong/),
      'It depends on the beans.',
      'As mentioned above, freshness matters.',
      'Grind finer if the shot runs fast.',
    ]);
    expect(r.findings.map((f) => f.range)).toEqual(r.suggestions.map((s) => s.range));
    expect(r.findings[0]?.message).toMatch(/"This"/);
    expect(r.findings[3]?.message).toMatch(/7 words/);
  });

  it('flags a paragraph over 150 words even when it names its subject', () => {
    const long = `Espresso ${'needs fresh beans and an even grind every day. '.repeat(20)}`;
    const r = run(long);
    expect(r.metrics).toMatchObject({ paragraphs: 1, tooLong: 1, unresolvedOpeners: 0 });
    expect(r.score).toBe(0);
    expect(r.findings[0]?.message).toMatch(/181 words/);
  });

  it('reads the opener through inline markup and is case-insensitive', () => {
    const r = run('**These** are all fine.\n\n[It](https://example.com) works too.');
    expect(r.metrics.unresolvedOpeners).toBe(2);
    const ok = run('Itself a classic, the lever machine works. Theses are long.');
    expect(ok.metrics.unresolvedOpeners).toBe(0);
  });

  it('does not flag a demonstrative used as a determiner before a noun', () => {
    const r = run(
      'This grinder works well.\n\nThese new burrs last for years.\n\nThis is the part people miss.\n\nThat means a slower shot.\n',
    );
    expect(r.metrics.unresolvedOpeners).toBe(2);
    expect(r.findings.map((f) => /opens with/.test(f.message))).toEqual([false, false, true, true]);
  });

  it('leaves a list or table lead-in out of the length window and the denominator', () => {
    const body = `Espresso ${'needs fresh beans and an even grind every day. '.repeat(5)}`;
    const md = `${body}\n\nThere are a few smaller things worth checking:\n\n- Dose\n- Yield\n\nCompare them:\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nA short closing line:\n`;
    const r = run(md);
    // The closing line ends in ":" but no list follows it, so it is still judged.
    expect(r.metrics).toMatchObject({ paragraphs: 2, standalone: 1, tooShort: 1 });
    expect(r.suggestions.map((s) => s.before)).toEqual(['A short closing line:']);
  });

  it('is not applicable without a prose paragraph', () => {
    const r = run('# Title\n\n- one item\n- another item\n\n> A quote.\n');
    expect(r.applicable).toBe(false);
    expect(r.suggestions).toEqual([]);
  });

  it('gives identical paragraphs distinct, stable suggestion ids', () => {
    const md = 'It works.\n\nIt works.\n';
    const ids = run(md).suggestions.map((s) => s.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(run(md).suggestions.map((s) => s.id)).toEqual(ids);
  });
});
