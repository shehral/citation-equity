import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rendersWithoutJs } from '@citation-equity/engine';
import { describe, expect, it } from 'vitest';
import { AI_CRAWLERS, crawlerAccessStatus, crawlerVerdicts } from '../src/index';
import { checkSite } from '../src/node/site';

interface RobotsCase {
  name: string;
  robots: string;
  url: string;
  status: 'pass' | 'warn' | 'fail';
  blocked: string[];
}
const FIXTURES = join(import.meta.dirname, 'fixtures');
const CASES = (
  JSON.parse(readFileSync(join(FIXTURES, 'robots/cases.json'), 'utf8')) as { cases: RobotsCase[] }
).cases;

/** A fetch stand-in serving one robots.txt and one page. */
function served(robots: string | undefined, url: string, html: string) {
  const origin = new URL(url).origin;
  return (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u === `${origin}/robots.txt` && robots !== undefined) {
      return new Response(robots, { headers: { 'content-type': 'text/plain' } });
    }
    if (u === url) return new Response(html, { headers: { 'content-type': 'text/html' } });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

const ARTICLE = '<html><body><article><p>Hello there.</p></article></body></html>';

describe('crawlerVerdicts', () => {
  it('gives one verdict per AI crawler, in the same order, with its info', () => {
    const verdicts = crawlerVerdicts('User-agent: *\nAllow: /\n', 'https://example.com/a');
    expect(verdicts.map((v) => v.userAgent)).toEqual(AI_CRAWLERS.map((c) => c.userAgent));
    expect(verdicts[0]).toEqual({ ...AI_CRAWLERS[0], allowed: true });
  });

  it.each(CASES)('blocks exactly the expected crawlers: $name', (c) => {
    const verdicts = crawlerVerdicts(c.robots, c.url);
    expect(verdicts.filter((v) => !v.allowed).map((v) => v.userAgent)).toEqual(c.blocked);
  });

  it('checks the robots.txt against the page URL whatever its origin', () => {
    const verdicts = crawlerVerdicts('User-agent: *\nDisallow: /\n', 'http://localhost:8080/x');
    expect(verdicts.every((v) => !v.allowed)).toBe(true);
  });
});

describe('crawlerAccessStatus', () => {
  it.each(CASES)('grades $name as $status', (c) => {
    expect(crawlerAccessStatus(crawlerVerdicts(c.robots, c.url)).status).toBe(c.status);
  });

  it('names each blocked crawler with its operator and purpose', () => {
    const { detail } = crawlerAccessStatus(
      crawlerVerdicts('User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n', 'https://e.com/'),
    );
    expect(detail).toBe(
      'Training crawlers are blocked: GPTBot (OpenAI, training), CCBot (Common Crawl, training). The AI search, user-fetch and search engine crawlers checked are allowed.',
    );
  });

  it('passes with a sentence that counts the crawlers checked', () => {
    const { status, detail } = crawlerAccessStatus(crawlerVerdicts('', 'https://e.com/'));
    expect(status).toBe('pass');
    expect(detail).toBe(
      `robots.txt allows all ${AI_CRAWLERS.length} AI crawlers checked to fetch this URL.`,
    );
  });
});

describe('parity with ce site (checkSite) on the shared robots fixtures', () => {
  it.each(CASES)('$name', async (c) => {
    const report = await checkSite(c.url, { fetchImpl: served(c.robots, c.url, ARTICLE) });
    const browser = crawlerVerdicts(c.robots, c.url);
    expect(browser).toEqual(report.crawlers);
    const item = report.readiness.items.find((i) => i.id === 'crawler-access');
    expect(crawlerAccessStatus(browser)).toEqual({ status: item?.status, detail: item?.detail });
  });
});

describe('parity with ce site on renders-without-js', () => {
  const pages = readdirSync(join(FIXTURES, 'render')).filter((f) => f.endsWith('.html'));
  const EXPECTED: Record<string, 'pass' | 'warn' | 'fail'> = {
    'long-article.html': 'pass',
    'chrome-article.html': 'warn',
    'spa-noscript.html': 'fail',
    'short-note.html': 'fail',
  };

  it('has an expected verdict for every fixture', () => {
    expect(pages.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s reads %s in both', async (file, expected) => {
    const html = readFileSync(join(FIXTURES, 'render', file), 'utf8');
    const url = 'https://example.com/blog/espresso';
    const report = await checkSite(url, { fetchImpl: served(undefined, url, html) });
    const item = report.readiness.items.find((i) => i.id === 'renders-without-js');
    expect(item?.status).toBe(expected);
    expect(rendersWithoutJs(html).status).toBe(expected);
  });
});
