import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import {
  analyze,
  CHECK_IDS,
  CHECKS,
  gather,
  pageQuestions,
  parseDraft,
  questionReport,
} from '../src/index';
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
    expect(result).not.toHaveProperty('scores');
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
    expect(result.schemaVersion).toBe(2);
    expect(result.engineVersion).toBe(pkg.version);
    expect(result.markdown).toBe(basic);
    expect(result.wordCount).toBeGreaterThan(50);
    expect(result.checks.map((c) => c.checkId)).toEqual([...CHECK_IDS]);
    // No total of any kind: the checks and the question report are the whole result.
    expect(result).not.toHaveProperty('scores');
  });

  it('analyzes HTML input against the converted Markdown', () => {
    const result = analyze('<h2>Why?</h2><p>Because.</p>', { format: 'html' });
    expect(result.markdown).toContain('## Why?');
    expect(result.wordCount).toBe(2);
  });

  it('wires every check into the registry of check functions', () => {
    expect(Object.keys(CHECKS)).toEqual([...CHECK_IDS]);
  });

  it('passes the given questions to the question checks', () => {
    const draft =
      '## How long should an espresso shot take?\n\nAn espresso shot should take 25 to 30 seconds from the first drip.\n';
    const coverage = analyze(draft, {
      questions: ['How long should an espresso shot take?'],
    }).checks.find((c) => c.checkId === 'question-coverage');
    expect(coverage).toMatchObject({ applicable: true, score: 1 });
    expect(coverage?.metrics).toEqual({ questions: 1, covered: 1 });
  });

  describe('the question report', () => {
    const DRAFT =
      '# Bitter espresso\n\nBitter espresso usually means the shot ran too long.\n\n## How long should an espresso shot take?\n\nAn espresso shot should take 25 to 30 seconds from the first drip.\n';

    it("measures the given questions, trimmed and without repeats, as the author's own", () => {
      const asked = [
        ' How long should an espresso shot take? ',
        'how long should an espresso shot take',
        '',
        'Why is my espresso bitter?',
      ];
      const { questions } = analyze(DRAFT, { questions: asked });
      expect(questions.from).toBe('yours');
      expect(questions.rows.map((r) => r.question)).toEqual([
        'How long should an espresso shot take?',
        'Why is my espresso bitter?',
      ]);
      expect(questions.rows).toEqual(
        questionReport(gather(parseDraft(DRAFT)), [
          'How long should an espresso shot take?',
          'Why is my espresso bitter?',
        ]),
      );
      expect(questions.covered).toBe(questions.rows.filter((r) => r.covered).length);
      expect(questions.covered).toBe(1);
    });

    it("measures the page's own title and topic questions when none are given", () => {
      const page = pageQuestions(DRAFT).map((q) => q.text);
      expect(page.length).toBeGreaterThan(0);
      for (const opts of [{}, { questions: [] }, { questions: ['  ', '?'] }]) {
        const { questions } = analyze(DRAFT, opts);
        expect(questions.from).toBe('page');
        expect(questions.rows.map((r) => r.question)).toEqual(page);
      }
    });

    const checkOf = (r: ReturnType<typeof analyze>, id: 'reader-words' | 'question-coverage') =>
      r.checks.find((c) => c.checkId === id);

    it('has both question checks measure the given questions, trimmed and without repeats', () => {
      const r = analyze(DRAFT, {
        questions: [' Why is my espresso bitter? ', 'why is my espresso bitter', '  '],
      });
      expect(checkOf(r, 'question-coverage')?.metrics).toEqual({ questions: 1, covered: 0 });
      expect(checkOf(r, 'reader-words')?.metrics.questions).toBe(1);
      expect(r.questions.rows).toHaveLength(1);
    });

    it("applies question-coverage to the page's own questions when none are given", () => {
      const page = pageQuestions(DRAFT).map((q) => q.text);
      expect(page.length).toBeGreaterThan(0);
      for (const opts of [{}, { questions: [] }, { questions: ['  ', '?'] }]) {
        const r = analyze(DRAFT, opts);
        const coverage = checkOf(r, 'question-coverage');
        expect(coverage?.applicable).toBe(true);
        const answered = r.questions.rows.filter((row) => row.answer.covered).length;
        expect(coverage?.metrics).toEqual({ questions: page.length, covered: answered });
        expect(checkOf(r, 'reader-words')?.metrics.questions).toBe(page.length);
      }
    });

    it('names the given questions in the reader-words advice', () => {
      const asked = ['What water temperature is best?'];
      const advice = checkOf(analyze(DRAFT, { questions: asked }), 'reader-words')?.suggestions;
      expect(advice?.map((s) => s.title)).toEqual([
        'Use the words of "What water temperature is best?" up top',
      ]);
    });

    it('has no rows for an empty draft', () => {
      expect(analyze('').questions).toEqual({ from: 'page', rows: [], covered: 0 });
      expect(analyze('  \n', { questions: ['Why is my espresso bitter?'] }).questions).toEqual({
        from: 'yours',
        rows: [],
        covered: 0,
      });
    });
  });
});
