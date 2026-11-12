import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  HIDDEN_NAME,
  hideBrands,
  NAME_CONDITIONS,
  type NamePair,
  nameConditionSources,
  nameContentSplit,
  type PackDocument,
  swapBrands,
  swappedUrl,
} from '../src/index';

const A: PackDocument = {
  docId: 'a',
  title: 'Wintering hives at Hivecraft Notes',
  text: 'At Hivecraft Notes we never heat a hive. Unlike AskAnything answers, we test it.',
  url: 'https://hivecraft-notes.example/winter/wintering-hives',
  synthetic: true,
};
const B: PackDocument = {
  docId: 'b',
  title: 'How do bees stay warm?',
  text: 'AskAnything contributors agree: bees shiver. askanything says leave the honey.',
  url: 'https://askanything.example/q/bees?ref=1',
  synthetic: true,
};
const OTHER: PackDocument = {
  docId: 'c',
  title: 'Bee biology',
  text: 'Hivecraft Notes is not this page, which stays as it is.',
  url: 'https://worldreference.example/bee',
  synthetic: true,
};
const SOURCES = [OTHER, A, B];
const PAIR: NamePair = {
  a: { docId: 'a', brand: 'Hivecraft Notes' },
  b: { docId: 'b', brand: 'AskAnything' },
};
const byId = (docs: PackDocument[], id: string) => docs.find((d) => d.docId === id);

describe('swapBrands and hideBrands', () => {
  it('swaps both names in one pass, ignoring case, whole words only', () => {
    expect(
      swapBrands(
        'Hivecraft Notes beats AskAnything; askanything!',
        'Hivecraft Notes',
        'AskAnything',
      ),
    ).toBe('AskAnything beats Hivecraft Notes; Hivecraft Notes!');
    expect(swapBrands('AskAnythingElse stays', 'Hivecraft Notes', 'AskAnything')).toBe(
      'AskAnythingElse stays',
    );
  });

  it('leaves the text alone without two different names', () => {
    expect(swapBrands('Hivecraft Notes', 'Hivecraft Notes', '')).toBe('Hivecraft Notes');
    expect(swapBrands('Hivecraft Notes', 'Hivecraft Notes', 'hivecraft notes')).toBe(
      'Hivecraft Notes',
    );
  });

  it('hides every mention, the longer name first', () => {
    expect(
      hideBrands('Ask at AskAnything or Hivecraft Notes.', ['Hivecraft Notes', 'AskAnything']),
    ).toBe(`Ask at ${HIDDEN_NAME} or ${HIDDEN_NAME}.`);
    expect(hideBrands('No names here.', ['', ' '])).toBe('No names here.');
  });
});

describe('swappedUrl', () => {
  it("puts the page's own path on the partner's scheme and host", () => {
    expect(swappedUrl(A.url ?? '', B.url ?? '')).toBe(
      'https://askanything.example/winter/wintering-hives',
    );
    expect(swappedUrl(B.url ?? '', 'http://hivecraft-notes.example:8080/x')).toBe(
      'http://hivecraft-notes.example:8080/q/bees?ref=1',
    );
  });

  it('refuses anything but http(s) URLs', () => {
    expect(() => swappedUrl('hivecraft-notes.example', B.url ?? '')).toThrow(/first page/);
    expect(() => swappedUrl(A.url ?? '', 'ftp://askanything.example/')).toThrow(/second page/);
  });
});

describe('nameConditionSources', () => {
  it('shown: every source as it is, with URLs in the prompt', () => {
    const { sources, labels } = nameConditionSources(SOURCES, 'shown', PAIR);
    expect(sources).toEqual(SOURCES);
    expect(labels).toBe('shown');
    expect(buildPrompt('q', sources, { labels })).toContain(`URL: ${A.url}`);
  });

  it('hidden: no URL anywhere, and neither name in the pair', () => {
    const { sources, labels } = nameConditionSources(SOURCES, 'hidden', PAIR);
    expect(labels).toBe('hidden');
    expect(sources.every((s) => s.url === undefined)).toBe(true);
    const a = byId(sources, 'a');
    expect(a?.title).toBe(`Wintering hives at ${HIDDEN_NAME}`);
    expect(a?.text).not.toMatch(/Hivecraft|AskAnything/i);
    expect(byId(sources, 'b')?.text).not.toMatch(/AskAnything/i);
    // The other sources keep their text.
    expect(byId(sources, 'c')?.text).toBe(OTHER.text);
    expect(buildPrompt('q', sources, { labels })).not.toContain('URL:');
  });

  it("swapped: each page wears the other's site, in its URL and in its text", () => {
    const { sources, labels } = nameConditionSources(SOURCES, 'swapped', PAIR);
    expect(labels).toBe('shown');
    const a = byId(sources, 'a');
    const b = byId(sources, 'b');
    expect(a?.url).toBe('https://askanything.example/winter/wintering-hives');
    expect(b?.url).toBe('https://hivecraft-notes.example/q/bees?ref=1');
    expect(a?.text).toBe(
      'At AskAnything we never heat a hive. Unlike Hivecraft Notes answers, we test it.',
    );
    expect(b?.text).toBe(
      'Hivecraft Notes contributors agree: bees shiver. Hivecraft Notes says leave the honey.',
    );
    expect(a?.title).toBe('Wintering hives at AskAnything');
    expect(byId(sources, 'c')).toEqual(OTHER);
    // The order of the sources is kept.
    expect(sources.map((s) => s.docId)).toEqual(['c', 'a', 'b']);
  });

  it('refuses a pair that is not among the sources, or a URL-less page outside hidden', () => {
    expect(() => nameConditionSources([OTHER, A], 'shown', PAIR)).toThrow(
      /"b" is not among the sources/,
    );
    const noUrl = { ...B, url: undefined };
    expect(() => nameConditionSources([A, noUrl], 'swapped', PAIR)).toThrow(/needs a URL/);
    expect(nameConditionSources([A, noUrl], 'hidden', PAIR).sources).toHaveLength(2);
  });

  it('knows the three conditions', () => {
    expect(NAME_CONDITIONS).toEqual(['shown', 'hidden', 'swapped']);
  });
});

describe('nameContentSplit', () => {
  it('splits the gap so that name + content is the gap, exactly', () => {
    const r = { aSmall: 0.3, aBig: 0.36, bSmall: 0.31, bBig: 0.38 };
    const s = nameContentSplit(r);
    expect(s.gap).toBeCloseTo(-0.08, 12);
    expect(s.name).toBeCloseTo(-0.065, 12);
    expect(s.content).toBeCloseTo(-0.015, 12);
    expect(s.name + s.content).toBeCloseTo(s.gap, 12);
  });

  it('gives all of the gap to the name when the label alone decides', () => {
    const s = nameContentSplit({ aSmall: 0.2, aBig: 0.5, bSmall: 0.2, bBig: 0.5 });
    expect(s.name).toBeCloseTo(-0.3, 12);
    expect(s.content).toBeCloseTo(0, 12);
  });

  it('gives all of the gap to the content when the text alone decides', () => {
    const s = nameContentSplit({ aSmall: 0.2, aBig: 0.2, bSmall: 0.5, bBig: 0.5 });
    expect(s.name).toBeCloseTo(0, 12);
    expect(s.content).toBeCloseTo(-0.3, 12);
  });
});
