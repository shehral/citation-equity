import { describe, expect, it } from 'vitest';
import { PackError, validatePack } from '../src/pack';

const validPack = () => ({
  schemaVersion: 1,
  packId: 'espresso',
  title: 'Espresso sample pack',
  source: 'Citation Equity sample pack',
  license: 'MIT (written for this project)',
  synthetic: true,
  queries: [
    {
      queryId: 'q1',
      query: 'Why is my espresso bitter?',
      documents: [
        {
          docId: 'd1',
          title: 'Bitterness',
          text: 'Over-extraction tastes bitter.',
          synthetic: true,
        },
        { docId: 'd2', text: 'Untitled page text.', url: 'https://example.com/a', synthetic: true },
      ],
    },
  ],
});

describe('validatePack', () => {
  it('throws a PackError that names packId for an empty object', () => {
    expect(() => validatePack({})).toThrow(PackError);
    expect(() => validatePack({})).toThrow(/packId/);
  });

  it('lists every problem in one readable message', () => {
    try {
      validatePack({ schemaVersion: 2, packId: '', queries: [] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PackError);
      const err = e as PackError;
      expect(err.issues.length).toBeGreaterThanOrEqual(3);
      expect(err.message).toMatch(/schemaVersion/);
      expect(err.message).toMatch(/queries/);
    }
  });

  it('rejects non-objects', () => {
    expect(() => validatePack(null)).toThrow(PackError);
    expect(() => validatePack('pack')).toThrow(/object/);
  });

  it('accepts a valid pack and fills a missing title with an empty string', () => {
    const pack = validatePack(validPack());
    expect(pack.packId).toBe('espresso');
    expect(pack.queries[0].documents[1].title).toBe('');
    expect(pack.queries[0].documents[1].url).toBe('https://example.com/a');
  });

  it('points at the bad document by path', () => {
    const bad = validPack();
    (bad.queries[0].documents[0] as { text: unknown }).text = 42;
    expect(() => validatePack(bad)).toThrow('queries[0].documents[0].text');
  });

  it('rejects duplicate query ids and duplicate or reserved doc ids', () => {
    const bad = validPack();
    bad.queries.push({ ...bad.queries[0] });
    bad.queries[0].documents[1].docId = 'd1';
    bad.queries[1] = {
      ...bad.queries[1],
      documents: [{ docId: 'draft', title: 't', text: 'x', synthetic: true }],
    };
    expect(() => validatePack(bad)).toThrow(/duplicate queryId "q1"/);
    expect(() => validatePack(bad)).toThrow(/duplicate docId "d1"/);
    expect(() => validatePack(bad)).toThrow(/reserved/);
  });
});
