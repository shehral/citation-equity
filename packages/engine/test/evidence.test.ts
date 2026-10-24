import { describe, expect, it } from 'vitest';
import evidenceDoc from '../../../docs/evidence.md?raw';
import { CHECK_IDS, EVIDENCE, type EvidenceGrade } from '../src/index';

const GRADES: EvidenceGrade[] = ['strong', 'moderate', 'mixed', 'untested'];
// The retired fifth grade word. Spelled in two parts so the word itself never
// appears in the repository, as the project rules require.
const BANNED = new RegExp(['contra', 'dicted'].join(''), 'i');

const DOC: string = evidenceDoc;

/** Every string reachable from a value, so banned words cannot hide in nested fields. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('evidence registry', () => {
  it('grades every check with one of the four public grades', () => {
    for (const id of CHECK_IDS) {
      expect(GRADES).toContain(EVIDENCE[id].grade);
    }
  });

  it('gives every check a written summary, not the placeholder', () => {
    for (const id of CHECK_IDS) {
      const { summary } = EVIDENCE[id];
      expect(summary.trim().length, id).toBeGreaterThan(40);
      expect(summary, id).not.toMatch(/review pending/i);
    }
  });

  it('backs every graded check with at least one linked source and a stated claim', () => {
    for (const id of CHECK_IDS) {
      const { grade, sources } = EVIDENCE[id];
      if (grade === 'untested') continue;
      expect(sources.length, id).toBeGreaterThanOrEqual(1);
      expect(sources.length, id).toBeLessThanOrEqual(4);
      for (const source of sources) {
        expect(source.url, `${id}/${source.id}`).toMatch(/^https?:\/\//);
        expect(source.claim.trim(), `${id}/${source.id}`).not.toBe('');
        expect(source.citation.trim(), `${id}/${source.id}`).not.toBe('');
      }
    }
  });

  it('grades at least one check above untested', () => {
    const graded = CHECK_IDS.filter((id) => EVIDENCE[id].grade !== 'untested');
    expect(graded.length).toBeGreaterThan(0);
  });

  it('never uses the retired grade word in the registry', () => {
    for (const text of strings(EVIDENCE)) {
      expect(text).not.toMatch(BANNED);
    }
  });
});

describe('docs/evidence.md', () => {
  it('never uses the retired grade word', () => {
    expect(DOC).not.toMatch(BANNED);
  });

  it('has one section per check that states the same grade as the registry', () => {
    for (const id of CHECK_IDS) {
      const start = DOC.search(new RegExp(`^## .*\`${id}\``, 'm'));
      expect(start, `section heading for ${id}`).toBeGreaterThan(-1);
      const next = DOC.indexOf('\n## ', start + 1);
      const section = DOC.slice(start, next === -1 ? undefined : next);
      expect(section, id).toContain(`Grade: **${EVIDENCE[id].grade}**`);
    }
  });

  it('explains why the score is not a prediction and how grades are assigned', () => {
    expect(DOC).toMatch(/not a prediction/i);
    expect(DOC).toMatch(/^## How grades are assigned$/m);
  });
});
