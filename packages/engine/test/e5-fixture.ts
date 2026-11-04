import type { E5Results, E5Row } from '../src/index';

/** One row of e5_results.json "contrasts", as report_e5.py writes it, on the main set by default. */
export function e5Row(step: string, contrast: string, over: Partial<E5Row> = {}): E5Row {
  const [arm = '', ref = ''] = contrast.split(' vs ');
  return {
    contrast,
    arm,
    ref,
    set: 'main',
    step,
    scope: 'pooled',
    n: 160,
    d: 0.021,
    ci95: [0.006, 0.037],
    ci90: [0.009, 0.034],
    p: 0.004,
    p_holm: 0.012,
    label: 'helps',
    single_model: false,
    cross_run: false,
    mde: 0.017,
    ...over,
  };
}

const REPORTED = { p_holm: null, label: 'reported without a verdict' } as const;

/** Every row a full E5 run writes: the planned main-set contrasts, the replication family, one reported row. */
export const E5_ROWS: E5Row[] = [
  e5Row('gate', '9 vs original', { scope: 'new queries', n: 115 }),
  e5Row('family', '9K vs original'),
  e5Row('family', '9K vs 9P'),
  e5Row('family', '9L vs original'),
  e5Row('family', '9L vs 9P'),
  e5Row('retention', '9K vs 9', { d: -0.004, ...REPORTED }),
  e5Row('retention', '9L vs 9', { d: -0.009, ...REPORTED }),
  // The missing words are not measured by default: 12K does not beat its placebo.
  e5Row('arm12', '12K vs P12K', { n: 66, d: 0.004, label: 'no effect larger than δ' }),
  e5Row('arm12 rule', '12K vs original', { n: 66, ...REPORTED }),
  e5Row('step5', '9 vs original', { scope: 'all main queries', n: 172 }),
  e5Row('family', '9K vs original', { set: 'replication', n: 53, label: 'inconclusive' }),
  e5Row('family', '9K vs 9P', { set: 'replication', n: 53, label: 'inconclusive' }),
  e5Row('family', '9L vs original', { set: 'replication', n: 50, single_model: true }),
  e5Row('family', '9L vs 9P', { set: 'replication', n: 50, cross_run: true }),
  e5Row('reported', '9G vs original', { n: 147, ...REPORTED }),
];

/**
 * A finished E5 run as e5_results.json holds it: by default the gate passed, the keyword keeps
 * the gain, the local model's question keeps part of it, both guesses help against the unedited
 * page, the missing words are not measured (no effect against their placebo), and step 5 helps.
 * `readings` and `contrasts` replace those parts.
 */
export function e5Results(
  readings: Partial<E5Results['readings']> = {},
  contrasts: E5Row[] = E5_ROWS,
): E5Results {
  return {
    experiment: 'E5',
    snapshot_started_at: '2026-11-06T05:00:00-08:00',
    secondary: false,
    readings: {
      gate_passed: true,
      gate_label: 'helps',
      retention: { '9K': 'keeps the gain', '9L': 'partly kept, unclear' },
      missing_words_measured: false,
      missing_words_rests_on_e1_note: false,
      readers_words_label: 'helps',
      readers_words_tool_action: 'measured label on the suggestion (effect, CI, models)',
      meaning: {
        '9K': { case: 'keeps the gain', tool: 'Keeps its label.', paper: 'The gain held.' },
        '9L': { case: 'partly kept, unclear', tool: 'May help less.', paper: 'Reported.' },
      },
      ...readings,
    },
    drift: { mean: 0.001, ci95: [-0.004, 0.006], n_queries: 172 },
    contrasts,
  };
}
