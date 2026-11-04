import { describe, expect, it } from 'vitest';
// The run's summary as committed beside the results file (page-text free).
import committed from '../../../experiments/results/e5/e5_results.json?raw';
import {
  deriveInputLabels,
  E5_INPUT_LABELS,
  E5_PATHS,
  E5_PLANNED,
  E5_RESULTS,
  E5_TEXT,
  type E5Results,
  type E5Row,
  plannedRows,
  TEST_LABEL_TEXT,
} from '../src/index';
import { E5_ROWS, e5Results } from './e5-fixture';

const EM_DASH = '\u2014';
// The retired grade word, spelled in two parts so the word itself never appears here.
const BANNED = new RegExp(['contra', 'dicted'].join(''), 'i');

const ROW_KEYS = [
  'arm',
  'ci90',
  'ci95',
  'contrast',
  'cross_run',
  'd',
  'label',
  'mde',
  'n',
  'p',
  'p_holm',
  'ref',
  'scope',
  'set',
  'single_model',
  'step',
];

describe('E5 module', () => {
  it('points at the plan and the results file', () => {
    expect(E5_PATHS).toEqual({
      plan: 'experiments/PLAN_E5.md',
      results: 'experiments/RESULTS_E5.md',
    });
  });

  it("plans the gate, the four Holm tests, both retention readings, 12K vs P12K and step 5, in the plan's order", () => {
    expect(E5_PLANNED).toEqual([
      { step: 'gate', contrast: '9 vs original', scope: 'new queries' },
      { step: 'family', contrast: '9K vs original' },
      { step: 'family', contrast: '9K vs 9P' },
      { step: 'family', contrast: '9L vs original' },
      { step: 'family', contrast: '9L vs 9P' },
      { step: 'retention', contrast: '9K vs 9' },
      { step: 'retention', contrast: '9L vs 9' },
      { step: 'arm12', contrast: '12K vs P12K' },
      { step: 'step5', contrast: '9 vs original', scope: 'all main queries' },
    ]);
  });

  describe('with E5 filled in', () => {
    const results = E5_RESULTS as E5Results;

    it('holds the committed e5_results.json as written', () => {
      expect(E5_RESULTS).toStrictEqual(JSON.parse(committed));
    });

    it('sets the input labels from the results', () => {
      expect(E5_INPUT_LABELS).toEqual(deriveInputLabels(results));
    });

    it('finds every planned contrast in the run, on the main set at its step and scope', () => {
      const rows = plannedRows(results);
      expect(rows.map(({ row, ...planned }) => planned)).toEqual(E5_PLANNED);
      for (const { contrast, step, scope, row } of rows) {
        expect(row, contrast).not.toBeNull();
        expect(row?.set, contrast).toBe('main');
        expect(row?.step, contrast).toBe(step);
        if (scope !== undefined) expect(row?.scope, contrast).toBe(scope);
      }
    });

    it('says in two plain paragraphs what E5 found and what the tool does, naming the labels', () => {
      const { summary, toolNote } = E5_TEXT;
      expect(summary?.trim()).toBeTruthy();
      expect(toolNote?.trim()).toBeTruthy();
      for (const text of [summary ?? '', toolNote ?? '']) {
        expect(text).not.toContain(EM_DASH);
        expect(text).not.toMatch(BANNED);
        expect(text).not.toContain('\n');
      }
      // The labels the guesses carry, in the screens' words.
      for (const input of ['keyword', 'local-model'] as const)
        for (const label of [E5_INPUT_LABELS[input].words, E5_INPUT_LABELS[input].answer])
          if (label !== 'not-tested')
            expect(toolNote, `${input} ${label}`).toContain(TEST_LABEL_TEXT[label]);
      // The labels for guesses were a choice made after the results; the planned readings stand.
      expect(toolNote).toMatch(/chosen after the results/);
      expect(toolNote).toMatch(/unchanged/);
      // The keyword's share is of the exact question's gain over a section without the reader's
      // words, not of the gate's gain over the unedited page, which the sentence before names.
      expect(summary).toContain("kept about two thirds of the exact question's gain");
      expect(summary).not.toMatch(/of that gain/);
    });
  });
});

describe('plannedRows', () => {
  it('finds each planned contrast on the main set, telling the gate and step 5 apart by scope', () => {
    const rows = plannedRows(e5Results());
    expect(rows.map(({ row, ...planned }) => planned)).toEqual(E5_PLANNED);
    for (const { row, step, contrast } of rows) {
      expect(row?.set, contrast).toBe('main');
      expect(row?.step, contrast).toBe(step);
      expect(row?.contrast).toBe(contrast);
    }
    expect(rows[0]?.row?.scope).toBe('new queries');
    expect(rows[8]?.row?.scope).toBe('all main queries');
    // The replication family has the same contrast names; it is never taken for the main one.
    expect(rows[1]?.row).toBe(E5_ROWS[1]);
  });

  it('reports a contrast the run cut as not run (no row), without an error', () => {
    const cut = E5_ROWS.filter((r: E5Row) => !(r.set === 'main' && r.contrast.startsWith('9L')));
    const rows = plannedRows(e5Results({ retention: { '9K': 'keeps the gain' } }, cut));
    const missing = rows.filter((r) => r.row === null).map((r) => r.contrast);
    expect(missing).toEqual(['9L vs original', '9L vs 9P', '9L vs 9']);
    expect(plannedRows(e5Results({}, [])).every((r) => r.row === null)).toBe(true);
  });
});

describe('experiments/results/e5/e5_results.json', () => {
  const json = JSON.parse(committed) as E5Results;

  it('has the keys E5Results names', () => {
    expect(Object.keys(json).sort()).toEqual([
      'contrasts',
      'drift',
      'experiment',
      'readings',
      'secondary',
      'snapshot_started_at',
    ]);
    expect(Object.keys(json.readings).sort()).toEqual([
      'gate_label',
      'gate_passed',
      'meaning',
      'missing_words_measured',
      'missing_words_rests_on_e1_note',
      'readers_words_label',
      'readers_words_tool_action',
      'retention',
    ]);
    expect(Object.keys(json.drift).sort()).toEqual(['ci95', 'mean', 'n_queries']);
    for (const row of json.contrasts)
      expect(Object.keys(row).sort(), row.contrast).toEqual(ROW_KEYS);
  });

  it('holds every planned step', () => {
    for (const { contrast, row } of plannedRows(json)) expect(row, contrast).not.toBeNull();
  });
});
