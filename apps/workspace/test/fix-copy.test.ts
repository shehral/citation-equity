import { analyze, CHECK_IDS, generateQuestions } from '@citation-equity/engine';
import { describe, expect, it } from 'vitest';
import { fixCopy } from '@/lib/fix-copy';
import { CHECK_NAMES } from '@/lib/glossary';
import { SAMPLES } from '@/lib/samples';

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('fix card copy', () => {
  it('gives every fix on the sample drafts a short title and a reason of 20 words or fewer', () => {
    let seen = 0;
    for (const sample of SAMPLES) {
      const questions = generateQuestions(sample.before).map((q) => q.text);
      const result = analyze(sample.before, { questions });
      for (const check of result.checks) {
        for (const s of check.suggestions) {
          const finding = check.findings.find(
            (f) => f.range.start === s.range.start && f.range.end === s.range.end,
          )?.message;
          const { title, reason } = fixCopy(s, finding);
          seen++;
          expect(reason, s.title).not.toBe('');
          expect(words(reason), reason).toBeLessThanOrEqual(20);
          // A reader question is quoted in its own words; every other title is 6 words or fewer.
          if (s.checkId !== 'question-coverage' && s.checkId !== 'reader-words')
            expect(words(title), title).toBeLessThanOrEqual(6);
          expect(`${title} ${reason}`).not.toMatch(/—|GEO|C-SEO|Evidence grade/);
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('names what a standalone-paragraph fix is about', () => {
    const copy = fixCopy(
      {
        id: 'x',
        checkId: 'standalone-paragraphs',
        kind: 'advisory',
        range: { start: 0, end: 4 },
        before: 'This is the main idea.',
        title: 'Make this paragraph stand on its own',
        rationale: 'r',
        grade: 'untested',
      },
      'It opens with "This", which points back to earlier text, so a reader who sees only this paragraph cannot tell what it refers to. It has 5 words, too short to carry its point alone (aim for 40 to 150).',
    );
    expect(copy.title).toBe('Say what "This" refers to');
    expect(copy.reason).toBe(
      'Opens with "This". Quoted alone, a reader can\'t tell what it means.',
    );
  });

  it('quotes the heading a question-heading fix is about', () => {
    const copy = fixCopy({
      id: 'x',
      checkId: 'question-headings',
      kind: 'advisory',
      range: { start: 0, end: 13 },
      before: '## Grind size',
      title: 'Phrase this heading as a question',
      rationale: 'r',
      grade: 'mixed',
    });
    expect(copy).toEqual({
      title: 'Make this heading a question',
      reason: '"Grind size" is a statement. Try the question a reader would type.',
    });
  });

  it("asks for the reader's question in the author's own words, a heading optional", () => {
    const copy = fixCopy({
      id: 'x',
      checkId: 'question-coverage',
      kind: 'advisory',
      range: { start: 0, end: 4 },
      before: '# Espresso',
      title: 'Answer "What water temperature is best?" directly',
      rationale: 'r',
      grade: 'mixed',
    });
    expect(copy).toEqual({
      title: 'Answer "What water temperature is best?" up front',
      reason: 'Answer it in your own words near the top. A heading is fine, not required.',
    });
  });

  it("names the reader's missing words, at most 3, and warns against forcing them in", () => {
    const md = '# Bitter espresso\n\nGrind finer and the shot slows down.\n';
    const questions = ['What water temperature is best?', 'Is my espresso sour?'];
    const result = analyze(md, { questions, authorQuestions: questions });
    const advice = result.checks.find((c) => c.checkId === 'reader-words')?.suggestions ?? [];
    expect(advice.map((s) => fixCopy(s))).toEqual([
      {
        title: 'Use the words of "What water temperature is best?"',
        reason:
          'Add "water", "temperature", "best" to your title or opening if they fit. Never force words in.',
      },
      {
        title: 'Use the words of "Is my espresso sour?"',
        reason: 'Add "sour" to your title or opening if it fits. Never force words in.',
      },
    ]);
  });

  it('has a plain name for every check', () => {
    expect(Object.keys(CHECK_NAMES).sort()).toEqual([...CHECK_IDS].sort());
  });
});
