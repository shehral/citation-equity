import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { analyze, CHECK_IDS, CHECKS, PRESET_WEIGHTS } from '../src/index';
import basic from './fixtures/basic.md?raw';
import empty from './fixtures/empty.md?raw';

describe('analyze', () => {
  it.each([
    ['empty string', ''],
    ['whitespace only', '   \n'],
    ['empty.md', empty],
    ['front matter only', '---\ntitle: Draft\n---\n'],
  ])('reports no content for %s without throwing', (_name, source) => {
    const result = analyze(source);
    expect(result.scores).toEqual({ foundation: null, evidence: null, custom: null });
    expect(result.wordCount).toBe(0);
    expect(result.checks.map((c) => c.checkId)).toEqual([...CHECK_IDS]);
    for (const c of result.checks) {
      expect(c).toEqual({
        checkId: c.checkId,
        applicable: false,
        score: 0,
        findings: [],
        suggestions: [],
        metrics: {},
      });
    }
  });

  it('runs every check in CHECK_IDS order on a real draft', () => {
    const result = analyze(basic);
    expect(result.schemaVersion).toBe(1);
    expect(result.engineVersion).toBe(pkg.version);
    expect(result.markdown).toBe(basic);
    expect(result.wordCount).toBeGreaterThan(50);
    expect(result.checks.map((c) => c.checkId)).toEqual([...CHECK_IDS]);
    expect(result.scores.custom).toBeNull();
  });

  it('analyzes HTML input against the converted Markdown', () => {
    const result = analyze('<h2>Why?</h2><p>Because.</p>', { format: 'html' });
    expect(result.markdown).toContain('## Why?');
    expect(result.wordCount).toBe(2);
  });

  it('wires every check into the registry of check functions', () => {
    expect(Object.keys(CHECKS)).toEqual([...CHECK_IDS]);
  });

  it('passes target questions to the checks and keeps working without them', () => {
    const draft =
      '## How long should an espresso shot take?\n\nAn espresso shot should take 25 to 30 seconds from the first drip.\n';
    const coverage = (r: ReturnType<typeof analyze>) =>
      r.checks.find((c) => c.checkId === 'question-coverage');
    expect(coverage(analyze(draft))?.applicable).toBe(false);
    const withQuestions = coverage(
      analyze(draft, { questions: ['How long should an espresso shot take?'] }),
    );
    expect(withQuestions).toMatchObject({ applicable: true, score: 1 });
    expect(withQuestions?.metrics).toEqual({ questions: 1, covered: 1 });
  });

  it('PRESET_WEIGHTS pins the foundation preset', () => {
    expect(PRESET_WEIGHTS.foundation.tables).toBe(1);
    expect(PRESET_WEIGHTS.foundation['cited-sources']).toBe(0.5);
  });
});
