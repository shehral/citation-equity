import { describe, expect, it } from 'vitest';
import * as engine from '../src/index';
import { analyze, CHECK_IDS, EVIDENCE, type EvidenceGrade } from '../src/index';
import basic from './fixtures/basic.md?raw';

const GRADES: EvidenceGrade[] = ['strong', 'moderate', 'mixed', 'untested'];

describe('engine contracts', () => {
  it('defines the eleven checks in registry order', () => {
    expect(CHECK_IDS.length).toBe(11);
    expect([...CHECK_IDS]).toEqual([
      'standalone-paragraphs',
      'question-headings',
      'lists',
      'statistics',
      'tables',
      'expert-quotes',
      'cited-sources',
      'direct-answer-lead',
      'question-coverage',
      'comparisons',
      'reader-words',
    ]);
  });

  it('has one evidence entry per check, keyed in CHECK_IDS order', () => {
    expect(Object.keys(EVIDENCE)).toEqual([...CHECK_IDS]);
  });

  it('grades every check with one of the four public grades', () => {
    for (const id of CHECK_IDS) {
      expect(GRADES).toContain(EVIDENCE[id].grade);
      expect(Array.isArray(EVIDENCE[id].sources)).toBe(true);
    }
  });

  it('returns a schemaVersion 2 AnalysisResult: the checks and the question report, no score', () => {
    const result = analyze(basic, { questions: ['What is a test?'] });
    expect(result.schemaVersion).toBe(2);
    expect(Object.keys(result).sort()).toEqual([
      'checks',
      'engineVersion',
      'markdown',
      'questions',
      'schemaVersion',
      'wordCount',
    ]);
    expect(Object.keys(result.questions).sort()).toEqual(['covered', 'from', 'rows']);
    expect(result.questions.rows).toHaveLength(1);
    expect(Object.keys(result.questions.rows[0] ?? {}).sort()).toEqual([
      'answer',
      'answerRange',
      'covered',
      'question',
      'words',
      'wordsRange',
    ]);
    expect(Object.keys(result.questions.rows[0]?.answer ?? {}).sort()).toEqual([
      'covered',
      'message',
      'question',
      'range',
    ]);
  });

  it('exports no score ranking, and keeps the weighted checklist mean as a research API', () => {
    for (const name of ['rankFixes', 'startHereFixes', 'START_HERE_COUNT', 'groupFixes'])
      expect(engine, name).not.toHaveProperty(name);
    for (const name of [
      'scoreChecks',
      'PRESET_WEIGHTS',
      'GRADE_WEIGHTS',
      'UNSCORED_CHECKS',
      'CHECK_DEFINITIONS',
    ])
      expect(engine, name).toHaveProperty(name);
  });
});
