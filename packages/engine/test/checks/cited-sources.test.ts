import { describe, expect, it } from 'vitest';
import { check } from '../../src/checks/cited-sources';
import { analyze, EVIDENCE, gather, parseDraft } from '../../src/index';
import fail from '../fixtures/checks/cited-sources/fail.md?raw';
import pass from '../fixtures/checks/cited-sources/pass.md?raw';

const run = (md: string) => check(gather(parseDraft(md)));
const slice = (md: string, r: { start: number; end: number }) => md.slice(r.start, r.end);

describe('cited-sources check', () => {
  it('still suggests, and says every suggestion is not scored and why', () => {
    const note =
      'Not scored in Standard or By evidence: our own test (E3) found no effect larger than 0.03 (d -0.010, 90% CI [-0.023, +0.002], n 49, Holm p 0.228).';
    const r = run(fail);
    expect(r.suggestions.length).toBeGreaterThan(0);
    for (const s of r.suggestions) expect(s.rationale).toContain(note);
  });

  it('passes when every claim sits next to a link', () => {
    const result = run(pass);
    expect(result.checkId).toBe('cited-sources');
    expect(result.applicable).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.suggestions.filter((s) => s.kind === 'advisory')).toEqual([]);
    expect(result.metrics).toMatchObject({ claims: 3, sourced: 3 });
  });

  it('fails unsourced claims and points at each sentence', () => {
    const result = run(fail);
    expect(result.applicable).toBe(true);
    expect(result.score).toBeLessThanOrEqual(0.2);
    expect(result.metrics).toMatchObject({ claims: 4, sourced: 0 });
    expect(result.suggestions.map((s) => s.before)).toEqual([
      'Research shows that most bitter shots are brewed with water that is too hot.',
      'Brewing water between 90 and 96 °C works for most roasts.',
      'A small study of home machines found that many ran cooler than their display showed.',
      'According to one industry report, 30% of owners never check the temperature at all.',
    ]);
    for (const s of result.suggestions) {
      expect(s.kind).toBe('advisory');
      expect(s.grade).toBe(EVIDENCE['cited-sources'].grade);
      expect(slice(fail, s.range)).toBe(s.before);
    }
  });

  it('does not apply when no sentence makes a claim or gives a statistic', () => {
    const result = run('# Espresso\n\nPull a shot and taste it. Adjust the grind if it is sour.\n');
    expect(result.applicable).toBe(false);
  });

  it('does not read "found" or "report" as research phrasing on their own', () => {
    const md =
      'Check whether the retriever found the passages. I found that a lower setting tasted sour. Press the report button.\n';
    expect(run(md).applicable).toBe(false);
    const research = run('The survey found sweeter shots. Researchers noted the same.\n');
    expect(research.metrics).toMatchObject({ claims: 2, sourced: 0 });
  });

  it('reads an attribution verb with "that" as a claim, unless the author or reader is the subject', () => {
    for (const claim of [
      'Gartner reported that espresso sales doubled.',
      'A Google paper found that longer pages were cited less.',
      'In practice teams report that most bad RAG answers trace back to retrieval.',
    ])
      expect(run(`${claim}\n`).metrics, claim).toMatchObject({ claims: 1, sourced: 0 });
    for (const note of [
      'I found that a lower setting tasted sour.',
      "We've found that a coarser grind helps.",
      'You may find that a finer grind helps.',
      'This shows that the grind matters.',
      'Check whether the retriever found the passages.',
    ])
      expect(run(`${note}\n`).applicable, note).toBe(false);
  });

  it('does not treat a figure in an instruction or a Key: value item as a claim', () => {
    const md =
      'Use 18 g of coffee for a double shot. Then pour 36 g of espresso. Stir for 10 seconds.\n\n- Weight: 2 kg\n- Boiler: 1.5 l\n\nMost machines run at 9 bar.\n';
    const r = run(md);
    expect(r.metrics).toMatchObject({ claims: 1, sourced: 0 });
    expect(r.suggestions.map((s) => s.before)).toEqual(['Most machines run at 9 bar.']);
    // Research phrasing in an instruction is still a claim.
    expect(run('Use 18 g, as a study found.\n').metrics).toMatchObject({ claims: 1 });
  });

  it('counts a link anywhere in the same paragraph', () => {
    const md =
      'A study found that 30% of shots run long. See [the data](https://example.org/data).\n';
    expect(run(md).score).toBe(1);
  });

  it('does not count a link in another paragraph or a relative link', () => {
    const md =
      'A study found that 30% of shots run long.\n\nSee [the data](https://example.org/data).\n\nA report found the same. Read [our guide](/guide).\n';
    const result = run(md);
    expect(result.metrics).toMatchObject({ claims: 2, sourced: 0 });
  });

  it('counts a footnote reference as a source', () => {
    const md = 'A study found that 30% of shots run long.[^1]\n\n[^1]: Example Lab, 2024.\n';
    expect(run(md).metrics).toMatchObject({ claims: 1, sourced: 1 });
  });

  it('does not read a footnote definition as a claim', () => {
    const md = 'A study found that 30% of shots run long.[^1]\n\n[^1]: Example Lab report, 2024.\n';
    expect(run(md).metrics).toMatchObject({ claims: 1, sourced: 1 });
  });

  it('does not read a footnote definition on continuation lines as a claim', () => {
    const md =
      'A study found that 30% of shots run long.[^2]\n\n[^2]:\n    Example Lab report on 40 samples, 2024.\n';
    expect(run(md).metrics).toMatchObject({ claims: 1, sourced: 1, unsourced: 0 });
  });

  it('does not count a footnote marker inside inline code', () => {
    const md = 'A study found that 30% of shots run long. Write `[^1]` to cite it.\n';
    expect(run(md).metrics).toMatchObject({ claims: 1, sourced: 0 });
  });

  it('ignores claim words in code', () => {
    const md = 'Run `research --found 30%` to start. Pull a shot.\n';
    expect(run(md).applicable).toBe(false);
  });

  it('caps advice at 5 sentences but reports every finding', () => {
    const md = Array.from(
      { length: 7 },
      (_, i) => `Study ${'abcdefg'[i]} found a sweeter shot.`,
    ).join('\n\n');
    const result = run(md);
    expect(result.metrics).toMatchObject({ claims: 7, sourced: 0 });
    expect(result.findings).toHaveLength(7);
    expect(result.suggestions).toHaveLength(5);
  });

  it('gives the same suggestion ids on every run', () => {
    const ids = () =>
      analyze(fail)
        .checks.find((c) => c.checkId === 'cited-sources')
        ?.suggestions.map((s) => s.id);
    expect(ids()).toHaveLength(4);
    expect(new Set(ids()).size).toBe(4);
    expect(ids()).toEqual(ids());
  });
});

describe('cited-sources advice copy', () => {
  it('asks for a real source only, says internal links do not count and states the grade', () => {
    const [s] = run(fail).suggestions;
    expect(s?.rationale).toContain('Link only a real source that supports this exact claim');
    expect(s?.rationale).toContain('internal (relative) links do not count');
    expect(s?.rationale).toContain(
      'In the larger studies, adding references for their own sake did not raise citation rank',
    );
    expect(s?.rationale).toContain(`Evidence grade: ${EVIDENCE['cited-sources'].grade}.`);
    expect(s?.rationale).not.toMatch(new RegExp(['contra', 'dicted'].join(''), 'i'));
  });
});
