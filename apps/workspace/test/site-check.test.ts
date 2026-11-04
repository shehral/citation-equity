import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_CRAWLERS } from '@citation-equity/bench';
import { describe, expect, it } from 'vitest';
import {
  blockerName,
  blockersLine,
  checkPastedSite,
  groupRows,
  lastCheckLine,
  liveSiteLine,
  siteSummaryOf,
} from '@/components/site/site-check';

// The robots.txt fixtures ce site and the bench's browser check are pinned to
// (packages/bench/test/robots-check.test.ts). Under jsdom the path is found from __dirname.
const CASES = (
  JSON.parse(
    readFileSync(
      join(__dirname, '../../../packages/bench/test/fixtures/robots/cases.json'),
      'utf8',
    ),
  ) as { cases: { name: string; robots: string; url: string; status: string }[] }
).cases;

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

/** A published page; every part can be swapped to make one row warn or fail. */
function page({
  canonical = 'https://example.com/blog/espresso',
  author = '"author":{"@type":"Person","name":"Jane Writer"},',
  robotsMeta = '',
  bodyWords = 250,
} = {}) {
  return `<!doctype html><html><head><title>Bitter espresso</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting",${author}"datePublished":"2026-03-01","dateModified":"2026-09-12"}</script>
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}${robotsMeta}
</head><body><article><h1>Bitter espresso</h1><p>${words(bodyWords)}</p></article></body></html>`;
}
const ALLOW = 'User-agent: *\nAllow: /\n';

const row = (check: ReturnType<typeof checkPastedSite>, id: string) => {
  const r = check.rows.find((x) => x.id === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
};

describe('siteSummaryOf', () => {
  it('finds no blocker and no check when every row passes', () => {
    const check = checkPastedSite({ html: page(), robotsTxt: ALLOW });
    expect(siteSummaryOf(check)).toEqual({ blockers: [], checks: [], needsLiveSite: 1 });
  });

  it('lists a blocker item that warns as a check, and ignores a page note that warns', () => {
    const check = checkPastedSite({
      html: page({ author: '', bodyWords: 60 }),
      robotsTxt: 'User-agent: GPTBot\nDisallow: /\n',
    });
    expect(row(check, 'byline').status).toBe('warn');
    expect(siteSummaryOf(check)).toEqual({
      blockers: [],
      checks: ['crawler-access', 'renders-without-js'],
      needsLiveSite: 1,
    });
  });

  it('lists the blocker items that fail, in blocker order, never a page note', () => {
    const check = checkPastedSite({
      html: page({
        canonical: '',
        robotsMeta: '<meta name="robots" content="noindex">',
        bodyWords: 10,
      }),
      robotsTxt: 'User-agent: *\nDisallow: /\n',
    });
    expect(row(check, 'canonical').status).toBe('warn');
    expect(siteSummaryOf(check)).toEqual({
      blockers: ['crawler-access', 'indexing-directives', 'renders-without-js'],
      checks: [],
      needsLiveSite: 1,
    });
  });

  it('leaves crawler access out while it needs the live site', () => {
    const check = checkPastedSite({ html: page() });
    expect(row(check, 'crawler-access').status).toBe('live');
    expect(siteSummaryOf(check)).toEqual({ blockers: [], checks: [], needsLiveSite: 2 });
  });
});

describe('groupRows', () => {
  it('puts the three blocker items first, in blocker order, and the four page notes after', () => {
    const { rows } = checkPastedSite({ html: page(), robotsTxt: ALLOW });
    const { blockers, notes } = groupRows(rows);
    expect(blockers.map((r) => r.id)).toEqual([
      'crawler-access',
      'indexing-directives',
      'renders-without-js',
    ]);
    // The notes keep the order of the check's rows.
    expect(notes.map((r) => r.id)).toEqual(['byline', 'dates', 'structured-data', 'canonical']);
  });

  it('keeps each row as checked, whatever its status', () => {
    const { rows } = checkPastedSite({
      html: page({ author: '', robotsMeta: '<meta name="robots" content="noindex">' }),
    });
    const { blockers, notes } = groupRows(rows);
    expect(blockers.map((r) => [r.id, r.status])).toEqual([
      ['crawler-access', 'live'],
      ['indexing-directives', 'fail'],
      ['renders-without-js', 'pass'],
    ]);
    expect(notes.find((r) => r.id === 'byline')?.status).toBe('warn');
    // Every row lands in exactly one group, unchanged.
    const grouped = [...blockers, ...notes];
    expect(grouped).toHaveLength(rows.length);
    for (const r of rows) expect(grouped.filter((g) => g === r)).toHaveLength(1);
  });
});

describe('blocker lines', () => {
  it('count the blockers in plain words', () => {
    expect(blockersLine([])).toBe('No blockers found');
    expect(blockersLine(['crawler-access'])).toBe('1 blocker');
    expect(blockersLine(['crawler-access', 'indexing-directives'])).toBe('2 blockers');
    expect(blockersLine(['crawler-access', 'indexing-directives', 'renders-without-js'])).toBe(
      '3 blockers',
    );
  });

  it('name the blockers after a reload', () => {
    expect(lastCheckLine([])).toBe('No blockers found');
    expect(lastCheckLine(['crawler-access'])).toBe('1 blocker: AI crawlers allowed');
    expect(lastCheckLine(['indexing-directives', 'renders-without-js'])).toBe(
      '2 blockers: Search can show it, Text loads without JavaScript',
    );
    expect(blockerName('renders-without-js')).toBe('Text loads without JavaScript');
  });
});

describe('checkPastedSite', () => {
  it('passes all seven rows for a complete page and an open robots.txt', () => {
    const check = checkPastedSite({ html: page(), robotsTxt: ALLOW });
    expect(check.rows.map((r) => r.status)).toEqual(Array(7).fill('pass'));
    expect(check.summary).toEqual({ pass: 7, warn: 0, fail: 0, total: 7, needsLiveSite: 1 });
  });

  it('gives short results in plain words', () => {
    const check = checkPastedSite({ html: page(), robotsTxt: ALLOW });
    expect(row(check, 'byline').result).toBe('Found: Jane Writer');
    expect(row(check, 'dates').result).toBe('Published 2026-03-01, updated 2026-09-12.');
    expect(row(check, 'structured-data').result).toBe('Found: BlogPosting.');
    expect(row(check, 'indexing-directives').result).toBe('Nothing in the page blocks search.');
    expect(row(check, 'canonical').result).toBe('Canonical: https://example.com/blog/espresso');
    expect(row(check, 'crawler-access').result).toBe(
      `All ${AI_CRAWLERS.length} AI crawlers may fetch it.`,
    );
    expect(row(check, 'renders-without-js').result).toBe(
      // The paragraph plus the article's two-word H1.
      '252 words load without JavaScript.',
    );
  });

  it('counts a warning as a warning, not a pass', () => {
    const check = checkPastedSite({ html: page({ author: '' }), robotsTxt: ALLOW });
    expect(row(check, 'byline').status).toBe('warn');
    expect(check.summary).toMatchObject({ pass: 6, warn: 1, fail: 0, total: 7 });
  });

  it('counts fails as fixes and names the blocked AI search crawler', () => {
    const check = checkPastedSite({
      html: page({ author: '', robotsMeta: '<meta name="robots" content="noindex">' }),
      robotsTxt: 'User-agent: OAI-SearchBot\nDisallow: /\n',
    });
    expect(row(check, 'crawler-access')).toMatchObject({
      status: 'fail',
      result: 'Blocked: OAI-SearchBot.',
    });
    expect(row(check, 'indexing-directives').status).toBe('fail');
    expect(check.summary).toMatchObject({ pass: 4, warn: 1, fail: 2, total: 7 });
  });

  it('marks crawler access as needing the live site when no robots.txt is pasted', () => {
    const check = checkPastedSite({ html: page(), robotsTxt: '  \n' });
    expect(row(check, 'crawler-access')).toMatchObject({ status: 'live' });
    expect(check.summary).toEqual({ pass: 6, warn: 0, fail: 0, total: 7, needsLiveSite: 2 });
    expect(liveSiteLine(check.summary)).toBe('2 checks need your live site');
    expect(liveSiteLine({ needsLiveSite: 1 })).toBe('1 check needs your live site');
  });

  it('checks robots.txt for the canonical URL, or for the home page when there is none', () => {
    const robotsTxt = 'User-agent: *\nDisallow: /blog/\n';
    expect(row(checkPastedSite({ html: page(), robotsTxt }), 'crawler-access').status).toBe('fail');
    const home = row(
      checkPastedSite({ html: page({ canonical: '' }), robotsTxt }),
      'crawler-access',
    );
    expect(home.status).toBe('pass');
    expect(home.detail).toContain('Checked for the home page');
  });

  it('says which training crawlers are blocked when only they are', () => {
    const check = checkPastedSite({ html: page(), robotsTxt: 'User-agent: GPTBot\nDisallow: /\n' });
    expect(row(check, 'crawler-access')).toMatchObject({
      status: 'warn',
      result: 'Training crawlers blocked: GPTBot. AI search can still fetch it.',
    });
  });

  it('judges rendering from the pasted HTML with the ce site thresholds', () => {
    const thin = checkPastedSite({ html: page({ bodyWords: 60 }), robotsTxt: ALLOW });
    expect(row(thin, 'renders-without-js').status).toBe('warn');
    const empty = checkPastedSite({
      html: '<html><head><link rel="canonical" href="https://example.com/a"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
      robotsTxt: ALLOW,
    });
    expect(row(empty, 'renders-without-js')).toMatchObject({
      status: 'fail',
      result: '0 words load without JavaScript.',
    });
  });

  it.each(CASES)('gives the ce site verdict on the shared robots fixture: $name', (c) => {
    const check = checkPastedSite({ html: page({ canonical: c.url }), robotsTxt: c.robots });
    expect(row(check, 'crawler-access').status).toBe(c.status);
  });

  it('keeps warning and fail rows to one compact line, the longer finding apart', () => {
    const check = checkPastedSite({ html: '<html><body><p>Hello.</p></body></html>' });
    for (const id of ['byline', 'dates', 'structured-data', 'canonical'] as const) {
      const r = row(check, id);
      expect(r.status).toBe('warn');
      expect(r.result.split(/\s+/).length, r.result).toBeLessThanOrEqual(8);
      expect(r.result.match(/\./g), r.result).toHaveLength(1);
      expect(r.detail?.length ?? 0).toBeGreaterThan(r.result.length);
    }
    expect(row(check, 'byline')).toMatchObject({
      result: 'No author name found.',
      detail: expect.stringContaining('No author found in JSON-LD'),
    });
    const blocked = checkPastedSite({
      html: '<html><head><meta name="robots" content="noindex"></head><body></body></html>',
    });
    expect(row(blocked, 'indexing-directives')).toMatchObject({
      status: 'fail',
      result: 'A tag keeps it out of search.',
    });
  });

  it('writes no em dash in any row text', () => {
    const check = checkPastedSite({
      html: page({ author: '' }),
      robotsTxt: 'User-agent: *\nDisallow: /',
    });
    for (const r of check.rows) {
      expect(`${r.name} ${r.what} ${r.result} ${r.detail ?? ''} ${r.why}`).not.toContain('—');
    }
  });
});
