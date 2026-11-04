import { describe, expect, it } from 'vitest';
import evidenceDoc from '../../../docs/evidence.md?raw';
import {
  CHECK_IDS,
  E5_RESULTS,
  EVIDENCE,
  type EvidenceGrade,
  QUESTION_LABELS,
  type QuestionInput,
  TEST_LABEL_TEXT,
  TEST_LABELS,
  type TestLabel,
} from '../src/index';

const GRADES: EvidenceGrade[] = ['strong', 'moderate', 'mixed', 'untested'];
// The retired fifth grade word. Spelled in two parts so the word itself never
// appears in the repository, as the project rules require.
const BANNED = new RegExp(['contra', 'dicted'].join(''), 'i');

const DOC: string = evidenceDoc;

/** The doc's `## <heading>` section, up to the next one; empty when there is none. */
function section(heading: string): string {
  const start = DOC.search(new RegExp(`^## ${heading}$`, 'm'));
  if (start === -1) return '';
  const next = DOC.indexOf('\n## ', start + 1);
  return DOC.slice(start, next === -1 ? undefined : next);
}

/** The cells of a Markdown table row, trimmed. */
const cells = (row: string) =>
  row
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());

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

  it('explains why the labels are not a prediction, and how grades and labels are assigned', () => {
    expect(section('Why the labels are not a prediction')).not.toBe('');
    expect(section('How grades are assigned')).not.toBe('');
    expect(section('How labels are assigned')).not.toBe('');
  });

  it("states each check's label as the label table does, in every row that names one", () => {
    const rows = DOC.split('\n').filter((l) => l.startsWith('| `'));
    for (const id of CHECK_IDS) {
      const named = rows
        .filter((r) => r.startsWith(`| \`${id}\` |`))
        .flatMap((r) =>
          Object.values(TEST_LABEL_TEXT).filter((text) => r.includes(`labelled ${text}`)),
        );
      expect(named.length, id).toBeGreaterThan(0);
      expect(new Set(named), id).toEqual(new Set([TEST_LABEL_TEXT[TEST_LABELS[id]]]));
    }
  });

  it('gives the tally of the eleven checks by label, as the label table counts it', () => {
    const tally = section('How labels are assigned')
      .split('\n')
      .find((l) => l.startsWith('Labels of the eleven checks today:'));
    expect(tally).toBeDefined();
    const counts = new Map<TestLabel, number>();
    for (const id of CHECK_IDS) counts.set(TEST_LABELS[id], (counts.get(TEST_LABELS[id]) ?? 0) + 1);
    for (const [label, n] of counts) expect(tally).toContain(`${n} ${TEST_LABEL_TEXT[label]}`);
    // No stale count beside them: the numbers add up to the eleven checks.
    const numbers = [...(tally ?? '').matchAll(/\b\d+\b/g)].map((m) => Number(m[0]));
    expect(numbers.reduce((a, b) => a + b, 0)).toBe(CHECK_IDS.length);
  });

  it("labels each question's two lines by where it came from, as the label table does", () => {
    const rows = section('How labels are assigned').split('\n');
    for (const input of Object.keys(QUESTION_LABELS) as QuestionInput[]) {
      const row = rows.find((l) => l.startsWith(`| \`${input}\`:`));
      expect(row, input).toBeDefined();
      const [, words, answer] = cells(row ?? '');
      expect(words, input).toBe(TEST_LABEL_TEXT[QUESTION_LABELS[input].words]);
      expect(answer, input).toBe(TEST_LABEL_TEXT[QUESTION_LABELS[input].answer]);
    }
  });

  it('says E5 is pending in its section exactly while E5 has no results', () => {
    const e5 = section('E5: when the question is a guess');
    expect(e5).not.toBe('');
    expect(e5.includes('Results are not in yet.')).toBe(E5_RESULTS === null);
  });

  it("gives E5's results with their file, and says what they mean for each guess's labels", () => {
    expect(E5_RESULTS).not.toBeNull();
    const e5 = section('E5: when the question is a guess');
    expect(e5).toContain('](../experiments/RESULTS_E5.md)');
    expect(e5).toContain('](../experiments/PLAN_E5.md)');
    // The labels the guesses carry, in the screens' words.
    for (const input of ['keyword', 'local-model'] as const)
      for (const label of [QUESTION_LABELS[input].words, QUESTION_LABELS[input].answer])
        expect(e5, `${input} ${label}`).toContain(TEST_LABEL_TEXT[label]);
    expect(e5).not.toContain('—');
  });

  it("says step 5 sets the answered line only, and states both lines' rules for guesses as chosen after the results", () => {
    const e5 = section('E5: when the question is a guess');
    expect(e5).toContain('Step 5 sets only the answered line');
    expect(e5).toContain("the words up top line keeps E1's label.");
    expect(e5).toContain('The labels for guesses follow two rules chosen after the results.');
    expect(e5).toContain('For the answered line:');
    expect(e5).toContain("For the words up top line of a keyword's question:");
  });
});
