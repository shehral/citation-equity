import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, countWords } from '@citation-equity/engine';
import { describe, expect, it } from 'vitest';
import {
  type BenchDraft,
  type BenchReport,
  type Comparison,
  compareReports,
  DEFAULT_SETTINGS,
  RecordedAdapter,
  runBench,
  validatePack,
} from '../src/index';

const SAMPLES = fileURLToPath(new URL('../../../samples/', import.meta.url));
const read = (...parts: string[]) => readFileSync(join(SAMPLES, ...parts), 'utf8');
const readJson = (...parts: string[]): unknown => JSON.parse(read(...parts));

interface IndexEntry {
  slug: string;
  title: string;
  topic: string;
  packId: string;
}
const INDEX = readJson('index.json') as IndexEntry[];

/** Word-count range each sample's before.md was written to (plan, Task 8 step 1). */
const BEFORE_WORDS: Record<string, [number, number]> = {
  'espresso-bitterness': [600, 900],
  'rag-explained': [800, 1100],
};

describe('samples/index.json', () => {
  it('lists the two samples with exactly { slug, title, topic, packId }', () => {
    expect(INDEX.map((e) => e.slug)).toEqual(['espresso-bitterness', 'rag-explained']);
    for (const entry of INDEX) {
      expect(Object.keys(entry).sort()).toEqual(['packId', 'slug', 'title', 'topic']);
      for (const value of Object.values(entry)) expect(value).toMatch(/\S/);
    }
  });
});

describe.each(INDEX)('sample $slug', (entry) => {
  const pack = validatePack(readJson(entry.slug, 'pack.json'));

  it('has a synthetic pack of 4 questions with 12 competitor pages each', () => {
    expect(pack.packId).toBe(entry.packId);
    expect(pack.synthetic).toBe(true);
    expect(pack.license).toBe('MIT (written for this project)');
    expect(pack.source).toBe('Citation Equity sample pack');
    expect(pack.queries).toHaveLength(4);
    for (const q of pack.queries) {
      expect(q.documents).toHaveLength(12);
      for (const doc of q.documents) {
        expect(doc.synthetic, doc.docId).toBe(true);
        expect(doc.title, doc.docId).toMatch(/\S/);
        const words = countWords(doc.text);
        expect(words, `${doc.docId} has ${words} words`).toBeGreaterThanOrEqual(250);
        expect(words, `${doc.docId} has ${words} words`).toBeLessThanOrEqual(700);
      }
    }
  });

  it('gives every pack page a docId that is unique across the whole pack', () => {
    const ids = pack.queries.flatMap((q) => q.documents.map((d) => d.docId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('links nowhere but example domains', () => {
    const texts = [
      read(entry.slug, 'before.md'),
      read(entry.slug, 'after.md'),
      ...pack.queries.flatMap((q) => q.documents.flatMap((d) => [d.text, d.url ?? ''])),
    ];
    for (const text of texts) {
      for (const [url] of text.matchAll(/https?:\/\/[^\s)\]"]+/g)) {
        expect(new URL(url).hostname, url).toMatch(/(^|\.)example\.(com|org|net)$/);
      }
    }
  });

  it('has a before draft of the planned length and an after draft that differs', () => {
    const before = read(entry.slug, 'before.md');
    const [lo, hi] = BEFORE_WORDS[entry.slug] ?? [0, 0];
    expect(countWords(before)).toBeGreaterThanOrEqual(lo);
    expect(countWords(before)).toBeLessThanOrEqual(hi);
    expect(read(entry.slug, 'after.md')).not.toBe(before);
  });
});

// The draft e2e spec applies this "?" edit on the example, so the sample must keep offering it.
describe('espresso-bitterness before.md (for the e2e draft flow)', () => {
  const result = analyze(read('espresso-bitterness', 'before.md'));
  const check = (id: string) => result.checks.find((c) => c.checkId === id);

  it('has an H2 that opens with a question word and lacks "?", so a "?" edit is offered', () => {
    const edits = check('question-headings')?.suggestions.filter((s) => s.kind === 'edit') ?? [];
    expect(edits.length).toBeGreaterThan(0);
    expect(edits[0]?.after).toBe(`${edits[0]?.before}?`);
  });

  it('has a quotation with no speaker, so the expert-quotes advisory appears', () => {
    const quotes = check('expert-quotes');
    expect(quotes?.suggestions.some((s) => s.kind === 'advisory')).toBe(true);
    expect(quotes?.findings.some((f) => /does not say who said it/.test(f.message))).toBe(true);
  });
});

/** The draft `ce bench` built: its title is the first H1 (same rule as readDraft in src/node/cli.ts). */
const benchDraft = (slug: string, id: 'before' | 'after'): BenchDraft => {
  const markdown = read(slug, `${id}.md`);
  return { id, title: /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown)?.[1] ?? id, markdown };
};

describe.each(INDEX)('recorded bench run of $slug', (entry) => {
  const pack = validatePack(readJson(entry.slug, 'pack.json'));
  const results = (name: string) => readJson(entry.slug, 'results', `${name}.json`);
  const recording = results('recording') as Record<string, string>;
  const committed = {
    before: results('before') as BenchReport,
    after: results('after') as BenchReport,
  };

  it('is the canonical run: a schemaVersion 2 report with default settings on the sample pack', () => {
    for (const report of Object.values(committed)) {
      expect(report.schemaVersion).toBe(2);
      expect(report.packId).toBe(entry.packId);
      expect(report.settings).toEqual(DEFAULT_SETTINGS);
      expect(report.runs).toHaveLength(pack.queries.length * DEFAULT_SETTINGS.runs);
    }
  });

  it('replays from recording.json to the committed reports and comparison', async () => {
    const replayed: Record<string, BenchReport> = {};
    for (const id of ['before', 'after'] as const) {
      const report = committed[id];
      const adapter = new RecordedAdapter(recording, report.adapter);
      replayed[id] = await runBench(pack, benchDraft(entry.slug, id), adapter, report.settings);
      expect(replayed[id].summary).toEqual(report.summary);
      expect(replayed[id].runs).toEqual(report.runs);
    }
    const comparison = results('comparison') as Comparison;
    expect(compareReports(replayed.before, replayed.after)).toEqual(comparison);
  });
});
