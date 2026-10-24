import { describe, expect, it } from 'vitest';
import {
  allApplicability,
  engineArmApplicability,
  keepQuery,
  normalizeSources,
  normalizeTags,
  readGeoRow,
  statusOf,
  waybackUrl,
} from '../e1_lib';
import type { EngineJson } from '../engine_json';

describe('keepQuery (PREREG_E1 Data 2)', () => {
  const info = ['informational', 'non-sensitive'];
  it('keeps informational questions and how-to or explanation requests', () => {
    expect(keepQuery('why is the sky blue', info)).toBe(true);
    expect(keepQuery('How do vaccines work', info)).toBe(true);
    expect(keepQuery('best way how to tie a tie', info)).toBe(true);
    expect(keepQuery('explain photosynthesis to a child', info)).toBe(true);
    expect(keepQuery('the difference between baking soda and powder', info)).toBe(true);
    expect(keepQuery('tell me what is a black hole', info)).toBe(true);
  });
  it('drops other queries, non-informational and sensitive ones', () => {
    expect(keepQuery('mention 3 folk sports in karnataka', info)).toBe(false);
    expect(keepQuery('is it safe to fly', info)).toBe(false);
    expect(keepQuery('why is the sky blue', ['commercial'])).toBe(false);
    expect(keepQuery('why is the sky blue', ['informational', 'sensitive'])).toBe(false);
    expect(keepQuery('whyever not', info)).toBe(false);
  });
});

describe('normalizeTags', () => {
  it('takes a list as is', () => {
    expect(normalizeTags(['informational', 'non-sensitive'])).toEqual([
      'informational',
      'non-sensitive',
    ]);
    expect(normalizeTags([])).toEqual([]);
  });
  it('parses a string holding a JSON list', () => {
    expect(normalizeTags('["informational", "sensitive"]')).toEqual(['informational', 'sensitive']);
  });
  it('turns a missing or malformed value into an empty list', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags('informational')).toEqual([]);
    expect(normalizeTags('{"a": 1}')).toEqual([]);
    expect(normalizeTags('[not json')).toEqual([]);
    expect(normalizeTags(7)).toEqual([]);
    expect(normalizeTags({ 0: 'informational' })).toEqual([]);
  });
  it('drops list items that are not strings', () => {
    expect(normalizeTags(['informational', 3, null])).toEqual(['informational']);
  });
});

describe('normalizeSources', () => {
  const src = [{ url: 'https://a.example/' }, { url: 'https://b.example/', raw_text: 'x' }];
  it('takes a list of {url} as is and returns its URLs', () => {
    expect(normalizeSources(src)).toEqual(['https://a.example/', 'https://b.example/']);
    expect(normalizeSources([])).toEqual([]);
  });
  it('parses a string holding a JSON list', () => {
    expect(normalizeSources(JSON.stringify(src))).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
  });
  it('returns null for a missing or malformed value', () => {
    expect(normalizeSources(undefined)).toBeNull();
    expect(normalizeSources(null)).toBeNull();
    expect(normalizeSources('https://a.example/')).toBeNull();
    expect(normalizeSources('[{"url": ')).toBeNull();
    expect(normalizeSources({ url: 'https://a.example/' })).toBeNull();
    expect(normalizeSources([{ url: 'https://a.example/' }, { raw_text: 'no url' }])).toBeNull();
    expect(normalizeSources(['https://a.example/'])).toBeNull();
    expect(normalizeSources([{ url: 5 }])).toBeNull();
  });
});

describe('readGeoRow', () => {
  const tags = ['informational'];
  const sources = [{ url: 'https://a.example/' }];
  it('reads a test-split row (lists)', () => {
    expect(readGeoRow({ query: 'why is the sky blue', tags, sources, sugg_idx: 0 })).toEqual({
      query: 'why is the sky blue',
      tags,
      urls: ['https://a.example/'],
    });
  });
  it('reads JSON-string tags and sources', () => {
    expect(
      readGeoRow({ query: 'q', tags: JSON.stringify(tags), sources: JSON.stringify(sources) }),
    ).toEqual({ query: 'q', tags, urls: ['https://a.example/'] });
  });
  it('gives a row with missing tags an empty tag list, which keepQuery drops', () => {
    const row = readGeoRow({ query: 'why is the sky blue', sources });
    expect(row).toEqual({ query: 'why is the sky blue', tags: [], urls: ['https://a.example/'] });
    expect(row && keepQuery(row.query, row.tags)).toBe(false);
  });
  it('returns null (a bad row) when sources or the query are unusable', () => {
    // The val split (datasets-server config `train`) has only query, dset and sugg_idx.
    expect(readGeoRow({ query: '2560x1440 banner', dset: 'orcas', sugg_idx: 0 })).toBeNull();
    expect(readGeoRow({ query: 'q', tags, sources: 'not a list' })).toBeNull();
    expect(readGeoRow({ tags, sources })).toBeNull();
    expect(readGeoRow(null)).toBeNull();
  });
});

describe('waybackUrl and statusOf', () => {
  it('builds the 2023 id_ snapshot URL', () => {
    expect(waybackUrl('https://example.com/a?b=1')).toBe(
      'https://web.archive.org/web/2023id_/https://example.com/a?b=1',
    );
  });
  it('reads an HTTP status from a skip reason', () => {
    expect(statusOf(null)).toBe(200);
    expect(statusOf('HTTP 403')).toBe(403);
    expect(statusOf('redirected to https://x/: HTTP 404')).toBe(404);
    expect(statusOf('disallowed by robots.txt')).toBeNull();
  });
});

type Check = EngineJson['checks'][string];
const check = (score: number, extra: Partial<Check> = {}): Check => ({
  applicable: true,
  score,
  metrics: {},
  findings: [{ start: 0, end: 4, message: 'm' }],
  suggestions: [],
  ...extra,
});
const eng = (checks: Record<string, Check>) => ({ checks }) as unknown as EngineJson;

describe('engineArmApplicability (PREREG_E1 Applicability)', () => {
  it('excludes a not-applicable check and a score of 0.9 or more', () => {
    expect(engineArmApplicability('2', eng({ 'question-headings': check(0.5) }), true)).toEqual({
      applicable: true,
      reason: null,
    });
    expect(
      engineArmApplicability(
        '2',
        eng({ 'question-headings': check(0, { applicable: false }) }),
        true,
      ).reason,
    ).toBe('the question-headings check is not applicable');
    expect(engineArmApplicability('2', eng({ 'question-headings': check(0.9) }), true).reason).toBe(
      'the question-headings check scores 0.900 (0.9 or more)',
    );
  });
  it('needs a donor for arms 5-7, an edit for arm 4 and an opener for arm 1', () => {
    expect(engineArmApplicability('5', eng({ statistics: check(0) }), false).reason).toBe(
      'no donor (four-page query)',
    );
    expect(engineArmApplicability('4', eng({ tables: check(0) }), true).reason).toBe(
      'no Key: value list for the tables check to convert',
    );
    const withEdit = check(0, { suggestions: [{ start: 0, end: 4, kind: 'edit', after: 'x' }] });
    expect(engineArmApplicability('4', eng({ tables: withEdit }), true).applicable).toBe(true);
    expect(
      engineArmApplicability('1', eng({ 'standalone-paragraphs': check(0.5) }), true).reason,
    ).toBe('no paragraph opens with a pointer to earlier text');
    expect(
      engineArmApplicability('3', eng({ lists: check(0.5, { findings: [] }) }), true).reason,
    ).toBe('the lists check reports no span');
  });
});

describe('allApplicability', () => {
  it('rows for arms 1-14 and ALL, with replication-only arms on the replication set', () => {
    const e = eng({
      'standalone-paragraphs': check(1),
      'question-headings': check(0.5),
      lists: check(1),
      tables: check(1),
      statistics: check(0),
      'expert-quotes': check(1),
      'cited-sources': check(1),
      'direct-answer-lead': check(1),
      'question-coverage': check(1),
      comparisons: check(1),
    });
    const features = ['11', '12', '13', '14'].map((arm) => ({
      arm,
      applicable: true,
      reason: null,
    }));
    const main = allApplicability('q', 'main', e, true, features);
    expect(main.map((r) => r.arm)).toEqual([
      ...Array.from({ length: 14 }, (_, i) => `${i + 1}`),
      'ALL',
    ]);
    expect(main.find((r) => r.arm === 'ALL')?.applicable).toBe(true);
    const rep = allApplicability('q', 'replication', e, true, features);
    expect(rep.find((r) => r.arm === '2')?.reason).toBe('not run on the replication set');
    expect(rep.find((r) => r.arm === '13')?.reason).toBe('not run on the replication set');
    expect(rep.find((r) => r.arm === '5')?.applicable).toBe(true);
    expect(rep.find((r) => r.arm === 'ALL')?.applicable).toBe(true);
    const none = allApplicability('q', 'replication', e, false, features);
    expect(none.find((r) => r.arm === 'ALL')).toEqual({
      query_id: 'q',
      arm: 'ALL',
      applicable: false,
      reason: 'no applicable step',
    });
  });
});
