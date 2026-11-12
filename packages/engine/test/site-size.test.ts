import { describe, expect, it } from 'vitest';
import {
  BIG_MAX_RANK,
  HOSTING_PLATFORMS,
  isInstitutional,
  platformOf,
  type RankList,
  registrableDomain,
  SITE_SIZE_TEXT,
  SITE_SIZES,
  SMALL_MIN_RANK,
  siteSize,
  sizeOfRank,
} from '../src/index';

/** A list from `[domain, rank]` pairs, `depth` deep. */
function list(entries: [string, number][], depth = SMALL_MIN_RANK): RankList {
  const ranks = new Map(entries);
  return { id: 'TEST', depth, rankOf: (d) => ranks.get(d) };
}

const FULL = list([
  ['google.com', 1],
  ['quora.com', 212],
  ['shop.co.uk', 10_000],
  ['regionalnews.com', 10_001],
  ['nichesite.org', 999_999],
  ['harvard.edu', 900],
]);

describe('registrableDomain', () => {
  it.each([
    ['https://www.quora.com/How-do-bees', 'quora.com'],
    ['old.reddit.com', 'reddit.com'],
    ['blog.shop.co.uk', 'shop.co.uk'],
    ['shop.co.uk', 'shop.co.uk'],
    ['a.b.example.com.au', 'example.com.au'],
    ['someone.github.io', 'github.io'],
    ['cdc.gov', 'cdc.gov'],
    ['example.com', 'example.com'],
    ['', ''],
    ['Espresso guide', ''],
  ])('%s -> %s', (input, domain) => {
    expect(registrableDomain(input)).toBe(domain);
  });
});

describe('platformOf', () => {
  it('flags pages on a subdomain of a hosting platform, not the platform itself', () => {
    expect(platformOf('someone.wordpress.com')?.category).toBe('blog hosting');
    expect(platformOf('wordpress.com')).toBeUndefined();
    expect(platformOf('www.wordpress.com')).toBeUndefined();
    expect(platformOf('user.github.io')?.category).toBe('static hosting');
  });

  it('flags every page under a domain-wide platform', () => {
    expect(platformOf('https://medium.com/@someone/my-hives')?.category).toBe('blog platform');
    expect(platformOf('someone.medium.com')?.category).toBe('blog platform');
    expect(platformOf('https://example.substack.com/p/post')?.category).toBe('newsletter');
  });

  it('matches a host entry exactly', () => {
    expect(platformOf('https://sites.google.com/view/hives')?.category).toBe('site builder');
    expect(platformOf('google.com')).toBeUndefined();
    expect(platformOf('blog.naver.com')?.category).toBe('blog hosting');
    expect(platformOf('naver.com')).toBeUndefined();
  });

  it('has unique patterns', () => {
    const patterns = HOSTING_PLATFORMS.map((p) => p.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(patterns.length).toBeGreaterThan(60);
  });
});

describe('isInstitutional', () => {
  it.each([
    ['cdc.gov', true],
    ['www.harvard.edu', true],
    ['ox.ac.uk', true],
    ['www.gov.uk', false],
    ['data.gov.uk', true],
    ['who.int', true],
    ['army.mil', true],
    ['sat.gob.mx', true],
    ['example.ac', false],
    ['example.com', false],
    ['', false],
  ])('%s -> %s', (host, flag) => {
    expect(isInstitutional(host)).toBe(flag);
  });
});

describe('sizeOfRank', () => {
  it('splits ranks at 10,000 and treats a missing site on a full list as small', () => {
    expect(sizeOfRank(1)).toBe('big');
    expect(sizeOfRank(BIG_MAX_RANK)).toBe('big');
    expect(sizeOfRank(BIG_MAX_RANK + 1)).toBe('mid');
    expect(sizeOfRank(SMALL_MIN_RANK)).toBe('mid');
    expect(sizeOfRank(undefined)).toBe('small');
  });

  it('never calls a site small when the list stops short of the top million', () => {
    expect(sizeOfRank(undefined, 100_000)).toBe('unknown');
    expect(sizeOfRank(50_000, 100_000)).toBe('mid');
  });
});

describe('siteSize', () => {
  it('labels big, mid and small sites by rank', () => {
    expect(siteSize('https://www.quora.com/q', FULL)).toMatchObject({
      domain: 'quora.com',
      size: 'big',
      rank: 212,
    });
    expect(siteSize('news.shop.co.uk', FULL).size).toBe('big');
    expect(siteSize('regionalnews.com', FULL).size).toBe('mid');
    expect(siteSize('nichesite.org', FULL).size).toBe('mid');
    const small = siteSize('https://hivecraft-notes.example/winter', FULL);
    expect(small).toMatchObject({ domain: 'hivecraft-notes.example', size: 'small' });
    expect(small.rank).toBeUndefined();
  });

  it('keeps Wikipedia and hosting platforms apart, with or without a list', () => {
    for (const l of [FULL, null, undefined]) {
      expect(siteSize('https://en.wikipedia.org/wiki/Honey_bee', l).size).toBe('wikipedia');
      expect(siteSize('someone.wordpress.com', l)).toMatchObject({
        size: 'platform',
        platform: 'blog hosting',
      });
    }
  });

  it('says unknown without a list, for text that is not a host, and past a short list', () => {
    expect(siteSize('quora.com').size).toBe('unknown');
    expect(siteSize('Espresso guide', FULL)).toEqual({
      host: '',
      domain: '',
      size: 'unknown',
      institutional: false,
    });
    expect(siteSize('nichesite.example', list([['google.com', 1]], 10_000)).size).toBe('unknown');
  });

  it('flags institutional sites and keeps their size', () => {
    expect(siteSize('www.harvard.edu', FULL)).toMatchObject({ size: 'big', institutional: true });
    expect(siteSize('quora.com', FULL).institutional).toBe(false);
  });

  it('has a plain name for every size', () => {
    expect(Object.keys(SITE_SIZE_TEXT).sort()).toEqual([...SITE_SIZES].sort());
  });
});
