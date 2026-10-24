import { describe, expect, it } from 'vitest';
import { CHECK_IDS, EVIDENCE, type EvidenceGrade } from '../src/index';

const GRADES: EvidenceGrade[] = ['strong', 'moderate', 'mixed', 'untested'];

describe('engine contracts', () => {
  it('defines the ten checks in registry order', () => {
    expect(CHECK_IDS.length).toBe(10);
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
});
