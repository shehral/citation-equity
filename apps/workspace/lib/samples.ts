import data from './generated/samples.json';

/** A sample draft, read from samples/ at build time by scripts/gen-samples.mjs. */
export interface Sample {
  slug: string;
  title: string;
  topic: string;
  packId: string;
  before: string;
  after?: string;
  /** The sample's synthetic pack (`Pack` from the bench), for the bench panel. */
  pack?: unknown;
  /** `results/*.json` by file name without extension, for the bench panel. */
  results?: Record<string, unknown>;
}

export const SAMPLES: Sample[] = data as unknown as Sample[];

export function getSample(slug: string): Sample {
  const sample = SAMPLES.find((s) => s.slug === slug) ?? SAMPLES[0];
  if (!sample) throw new Error('samples/index.json lists no sample');
  return sample;
}

/**
 * The picker entry for the author's own text: no sample, so no pack, its own saved draft
 * (`ce:v1:draft:my-draft`), target questions generated from that text, and the bench panel's
 * custom-draft view.
 */
export const MY_DRAFT_SLUG = 'my-draft';
export const MY_DRAFT_LABEL = 'My draft';

/** The sample for a picker value, or null for "My draft". */
export function sampleFor(slug: string): Sample | null {
  return slug === MY_DRAFT_SLUG ? null : getSample(slug);
}

/** The text a draft starts from (and Reset returns to): the sample's before draft, or empty. */
export function startingText(slug: string): string {
  return sampleFor(slug)?.before ?? '';
}

/** Short names for the examples in menus and labels; the title otherwise. */
const EXAMPLE_LABELS: Record<string, string> = {
  'espresso-bitterness': 'Bitter espresso',
  'rag-explained': 'RAG explainer',
};

export function exampleLabel(sample: Sample): string {
  return EXAMPLE_LABELS[sample.slug] ?? sample.title;
}
