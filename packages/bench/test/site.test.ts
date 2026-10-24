import { describe, expect, it } from 'vitest';
import { AI_CRAWLERS as ROOT_CRAWLERS } from '../src/index';
import { runCli } from '../src/node/cli';
import { AI_CRAWLERS, checkSite, type SiteReport } from '../src/node/site';

const URL_UNDER_TEST = 'https://example.com/blog/espresso';
const NOW = () => new Date('2026-10-23T12:00:00Z');

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const ARTICLE = (n: number, head = '') =>
  `<!doctype html><html><head><title>Why espresso turns bitter</title>${head}</head>
<body><article><h1>Why espresso turns bitter</h1><p>${words(n)}</p></article></body></html>`;
const SPA =
  '<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';

interface Served {
  status?: number;
  body?: string;
  type?: string;
  headers?: Record<string, string>;
  /** Throw a network error instead of answering. */
  fail?: boolean;
}

/** A fetch stand-in serving `routes` by URL; unknown URLs get a 404. Logs each request. */
function site(routes: Record<string, Served>) {
  const requested: { url: string; userAgent: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push({ url, userAgent: new Headers(init?.headers).get('user-agent') });
    const r = routes[url];
    if (!r) return new Response('not found', { status: 404 });
    if (r.fail) throw new TypeError('fetch failed');
    return new Response(r.body ?? '', {
      status: r.status ?? 200,
      headers: { 'content-type': r.type ?? 'text/html; charset=utf-8', ...r.headers },
    });
  }) as typeof fetch;
  return { fetchImpl, requested };
}

const robots = (body: string): Served => ({ body, type: 'text/plain' });
const verdict = (report: SiteReport, ua: string) => {
  const v = report.crawlers.find((c) => c.userAgent === ua);
  if (!v) throw new Error(`no crawler ${ua}`);
  return v;
};
const readinessItem = (report: SiteReport, id: string) => {
  const i = report.readiness.items.find((x) => x.id === id);
  if (!i) throw new Error(`no item ${id}`);
  return i;
};

describe('AI_CRAWLERS', () => {
  it('has an https docsUrl, a purpose and a unique token for every entry', () => {
    expect(AI_CRAWLERS.length).toBeGreaterThan(0);
    const tokens = AI_CRAWLERS.map((c) => c.userAgent.toLowerCase());
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const c of AI_CRAWLERS) {
      expect(c.docsUrl, c.userAgent).toMatch(/^https:\/\//);
      expect(['training', 'search', 'user-fetch', 'search-engine']).toContain(c.purpose);
      expect(c.operator.trim()).not.toBe('');
    }
  });

  it('covers the seven operators named in the plan', () => {
    const operators = new Set(AI_CRAWLERS.map((c) => c.operator));
    for (const op of ['OpenAI', 'Anthropic', 'Perplexity', 'Google', 'Microsoft', 'Apple']) {
      expect(
        [...operators].some((o) => o.startsWith(op)),
        op,
      ).toBe(true);
    }
    expect(operators.has('Common Crawl')).toBe(true);
  });

  it('is the same list as the browser-safe root export', () => {
    expect(AI_CRAWLERS).toBe(ROOT_CRAWLERS);
  });
});

describe('checkSite', () => {
  it('reports GPTBot and OAI-SearchBot blocked, and fails crawler access for the search crawler', async () => {
    const { fetchImpl } = site({
      'https://example.com/robots.txt': robots(
        'User-agent: GPTBot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n',
      ),
      [URL_UNDER_TEST]: { body: ARTICLE(250) },
    });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    expect(report.robotsTxtFound).toBe(true);
    expect(verdict(report, 'GPTBot')).toMatchObject({ allowed: false, purpose: 'training' });
    expect(verdict(report, 'OAI-SearchBot')).toMatchObject({ allowed: false, purpose: 'search' });
    expect(verdict(report, 'ClaudeBot').allowed).toBe(true);
    const access = readinessItem(report, 'crawler-access');
    expect(access.status).toBe('fail');
    expect(access.detail).toContain('OAI-SearchBot');
  });

  it('warns when only training crawlers are blocked', async () => {
    const { fetchImpl } = site({
      'https://example.com/robots.txt': robots(
        'User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n',
      ),
      [URL_UNDER_TEST]: { body: ARTICLE(250) },
    });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    expect(verdict(report, 'CCBot').allowed).toBe(false);
    const access = readinessItem(report, 'crawler-access');
    expect(access.status).toBe('warn');
    expect(access.detail).toBe(
      'Training crawlers are blocked: GPTBot (OpenAI, training), CCBot (Common Crawl, training). The AI search, user-fetch and search engine crawlers checked are allowed.',
    );
  });

  it('fails crawler access when User-agent: * disallows the path, since AI search crawlers are blocked too', async () => {
    const { fetchImpl } = site({
      'https://example.com/robots.txt': robots('User-agent: *\nDisallow: /blog/\n'),
      [URL_UNDER_TEST]: { body: ARTICLE(250) },
    });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    expect(verdict(report, 'OAI-SearchBot').allowed).toBe(false);
    expect(verdict(report, 'Googlebot').allowed).toBe(false);
    expect(readinessItem(report, 'crawler-access').status).toBe('fail');
  });

  it('fails when only a search engine crawler (Googlebot) is disallowed', async () => {
    const { fetchImpl } = site({
      'https://example.com/robots.txt': robots('User-agent: Googlebot\nDisallow: /\n'),
      [URL_UNDER_TEST]: { body: ARTICLE(250) },
    });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    expect(verdict(report, 'Googlebot')).toMatchObject({
      allowed: false,
      purpose: 'search-engine',
    });
    expect(report.crawlers.filter((c) => !c.allowed).map((c) => c.userAgent)).toEqual([
      'Googlebot',
    ]);
    const access = readinessItem(report, 'crawler-access');
    expect(access.status).toBe('fail');
    expect(access.detail).toBe(
      "robots.txt disallows this URL for Googlebot (Google, search-engine). A blocked search engine crawler keeps the page out of that engine's results and the AI answers built on them.",
    );
  });

  it('fails when every search engine crawler is blocked, whatever the AI crawlers may do', async () => {
    const { fetchImpl } = site({
      'https://example.com/robots.txt': robots(
        'User-agent: Googlebot\nUser-agent: Bingbot\nUser-agent: Applebot\nDisallow: /\n',
      ),
      [URL_UNDER_TEST]: { body: ARTICLE(250) },
    });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    const access = readinessItem(report, 'crawler-access');
    expect(access.status).toBe('fail');
    for (const ua of ['Googlebot', 'Bingbot', 'Applebot']) expect(access.detail).toContain(ua);
    expect(access.detail).not.toMatch(/does not grade/);
  });

  it('fails, not warns, when training and search engine crawlers are blocked', async () => {
    const { fetchImpl } = site({
      'https://example.com/robots.txt': robots(
        'User-agent: GPTBot\nUser-agent: Bingbot\nDisallow: /\n',
      ),
      [URL_UNDER_TEST]: { body: ARTICLE(250) },
    });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    const access = readinessItem(report, 'crawler-access');
    expect(access.status).toBe('fail');
    expect(access.detail).toContain('GPTBot');
    expect(access.detail).toContain('Bingbot');
  });

  it('says that blocking Google-Extended also keeps the page out of Gemini grounding', async () => {
    const { fetchImpl } = site({
      'https://example.com/robots.txt': robots('User-agent: Google-Extended\nDisallow: /\n'),
      [URL_UNDER_TEST]: { body: ARTICLE(250) },
    });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    const access = readinessItem(report, 'crawler-access');
    expect(access.status).toBe('warn');
    expect(access.detail).toContain('Google-Extended also controls grounding in Gemini Apps');
    expect(access.detail).not.toContain('user-requested fetches are allowed');
  });

  it('allows every crawler when robots.txt is missing (404)', async () => {
    const { fetchImpl } = site({ [URL_UNDER_TEST]: { body: ARTICLE(250) } });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    expect(report.robotsTxtFound).toBe(false);
    expect(report.sitemaps).toEqual([]);
    expect(report.crawlers.every((c) => c.allowed)).toBe(true);
    expect(report.crawlers).toHaveLength(AI_CRAWLERS.length);
    expect(readinessItem(report, 'crawler-access').status).toBe('pass');
  });

  it('treats a robots.txt that answers 5xx as disallowing everything (RFC 9309)', async () => {
    const { fetchImpl } = site({
      'https://example.com/robots.txt': { status: 503, body: 'busy' },
      [URL_UNDER_TEST]: { body: ARTICLE(250) },
    });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    expect(report.robotsTxtFound).toBe(false);
    expect(report.crawlers.every((c) => !c.allowed)).toBe(true);
    const access = readinessItem(report, 'crawler-access');
    expect(access.status).toBe('fail');
    expect(access.detail).toContain('503');
  });

  it('treats a robots.txt whose body fails mid-read as unavailable, without throwing', async () => {
    const broken = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/robots.txt')) {
        const body = new ReadableStream({
          start(controller) {
            controller.error(new Error('connection reset'));
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      return new Response(ARTICLE(250), { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl: broken, now: NOW });
    expect(report.robotsTxtFound).toBe(false);
    const access = readinessItem(report, 'crawler-access');
    expect(access.status).toBe('fail');
    expect(access.detail).toMatch(/^robots\.txt unavailable \(network error\)/);
  });

  it('names the cause of a failed page fetch, such as a redirect loop', async () => {
    const looping = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/robots.txt')) return new Response('', { status: 404 });
      throw new TypeError('fetch failed', { cause: new Error('redirect count exceeded') });
    }) as typeof fetch;
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl: looping, now: NOW });
    expect(report.httpStatus).toBeNull();
    expect(readinessItem(report, 'renders-without-js').detail).toBe(
      'Not checked: the page could not be fetched (fetch failed: redirect count exceeded).',
    );
  });

  it('lists the sitemaps named in robots.txt', async () => {
    const { fetchImpl } = site({
      'https://example.com/robots.txt': robots(
        'Sitemap: https://example.com/sitemap.xml\nUser-agent: *\nAllow: /\n',
      ),
      [URL_UNDER_TEST]: { body: ARTICLE(250) },
    });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    expect(report.sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });

  it('fails renders-without-js for an empty <div id="root"> page', async () => {
    const { fetchImpl } = site({ [URL_UNDER_TEST]: { body: SPA } });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    expect(report.httpStatus).toBe(200);
    expect(report.extractedWords).toBe(0);
    expect(readinessItem(report, 'renders-without-js').status).toBe('fail');
  });

  it('grades rendering by the words extracted: 200 or more pass, 50 to 199 warn', async () => {
    for (const [n, status] of [
      [200, 'pass'],
      [199, 'warn'],
      [50, 'warn'],
      [49, 'fail'],
    ] as const) {
      const { fetchImpl } = site({ [URL_UNDER_TEST]: { body: ARTICLE(n) } });
      const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
      // Defuddle drops the H1 that repeats the title, so only the paragraph's words count.
      expect(report.extractedWords, String(n)).toBe(n);
      expect(readinessItem(report, 'renders-without-js').status, String(n)).toBe(status);
    }
  });

  it('returns httpStatus null and no throw when the page fetch fails', async () => {
    const { fetchImpl } = site({ [URL_UNDER_TEST]: { fail: true } });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    expect(report.httpStatus).toBeNull();
    expect(report.extractedWords).toBe(0);
    const render = readinessItem(report, 'renders-without-js');
    expect(render.status).toBe('unknown');
    expect(render.detail).toMatch(/could not be fetched/);
    expect(readinessItem(report, 'byline').status).toBe('unknown');
  });

  it('fails rendering for an HTTP error page and does not read its metadata', async () => {
    const { fetchImpl } = site({ [URL_UNDER_TEST]: { status: 404, body: ARTICLE(250) } });
    const report = await checkSite(URL_UNDER_TEST, { fetchImpl, now: NOW });
    expect(report.httpStatus).toBe(404);
    expect(readinessItem(report, 'renders-without-js').status).toBe('fail');
    expect(readinessItem(report, 'byline').status).toBe('unknown');
  });

  it('runs the page-level items on the fetched HTML and reads X-Robots-Tag', async () => {
    const head =
      '<script type="application/ld+json">{"@type":"BlogPosting","author":{"name":"A"},"datePublished":"2026-01-01"}</script>';
    const { fetchImpl, requested } = site({
      [URL_UNDER_TEST]: { body: ARTICLE(250, head), headers: { 'x-robots-tag': 'noindex' } },
    });
    const report = await checkSite(URL_UNDER_TEST, {
      fetchImpl,
      now: NOW,
      userAgent: 'ce-test',
    });
    expect(report).toMatchObject({
      schemaVersion: 1,
      url: URL_UNDER_TEST,
      fetchedAt: '2026-10-23T12:00:00.000Z',
    });
    expect(readinessItem(report, 'byline').status).toBe('pass');
    expect(readinessItem(report, 'structured-data').detail).toContain('BlogPosting');
    expect(readinessItem(report, 'indexing-directives').status).toBe('fail');
    expect(requested.map((r) => r.url)).toEqual(['https://example.com/robots.txt', URL_UNDER_TEST]);
    expect(requested.every((r) => r.userAgent === 'ce-test')).toBe(true);
  });

  it('rejects a URL that is not http(s)', async () => {
    await expect(checkSite('ftp://example.com/x')).rejects.toThrow(/http/);
    await expect(checkSite('not a url')).rejects.toThrow(/http/);
  });
});

describe('ce site', () => {
  async function ce(args: string[], fetchImpl: typeof fetch) {
    let stdout = '';
    let stderr = '';
    const code = await runCli(args, {
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
      fetch: fetchImpl,
    });
    return { code, stdout, stderr };
  }

  const routes = {
    'https://example.com/robots.txt': robots('User-agent: GPTBot\nDisallow: /\n'),
    [URL_UNDER_TEST]: { body: ARTICLE(250) },
  };

  it('prints the crawler table, the readiness items with grades, and the GEO Score line', async () => {
    const { code, stdout, stderr } = await ce(['site', URL_UNDER_TEST], site(routes).fetchImpl);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toMatch(/GPTBot\s+OpenAI\s+training\s+blocked/);
    expect(stdout).toMatch(/OAI-SearchBot\s+OpenAI\s+search\s+allowed/);
    expect(stdout).toMatch(/crawler-access\s+warn\s+strong/);
    expect(stdout).toContain('renders-without-js');
    expect(
      stdout.trimEnd().endsWith('Site readiness is reported separately from the GEO Score.'),
    ).toBe(true);
  });

  it('prints the report as JSON with --json', async () => {
    const { code, stdout } = await ce(['site', URL_UNDER_TEST, '--json'], site(routes).fetchImpl);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as SiteReport;
    expect(report.schemaVersion).toBe(1);
    expect(report.crawlers.find((c) => c.userAgent === 'GPTBot')?.allowed).toBe(false);
    expect(report.readiness.items).toHaveLength(7);
  });

  it('exits 1 with a message for a URL that is not http(s)', async () => {
    const { code, stderr } = await ce(['site', 'ftp://example.com/x'], site({}).fetchImpl);
    expect(code).toBe(1);
    expect(stderr).toBe('error: Not an http(s) URL: ftp://example.com/x\n');
  });

  it('tries a URL without a scheme as https', async () => {
    const { fetchImpl, requested } = site(routes);
    const { code, stdout } = await ce(['site', 'example.com/blog/espresso'], fetchImpl);
    expect(code).toBe(0);
    expect(stdout).toContain(`Site readiness for ${URL_UNDER_TEST} (HTTP 200`);
    expect(requested.map((r) => r.url)).toEqual(['https://example.com/robots.txt', URL_UNDER_TEST]);
  });

  it('reads only a leading scheme as a scheme, so a URL inside the query is not one', async () => {
    const withQuery = 'example.com/blog/espresso?next=https://x';
    const { fetchImpl, requested } = site({
      ...routes,
      [`https://${withQuery}`]: { body: ARTICLE(250) },
    });
    const report = await checkSite(withQuery, { fetchImpl, now: NOW });
    expect(report.url).toBe(`https://${withQuery}`);
    expect(requested.map((r) => r.url)).toContain(`https://${withQuery}`);
  });

  it('prints control characters from the fetched page and robots.txt as "?"', async () => {
    const page = ARTICLE(250, '<meta name="author" content="\u001b[31mRED\u001b[0m Evil">');
    const { fetchImpl } = site({
      'https://example.com/robots.txt': robots(
        'Sitemap: https://example.com/s\u001b[2J.xml\nUser-agent: *\nAllow: /\n',
      ),
      [URL_UNDER_TEST]: { body: page },
    });
    const { code, stdout } = await ce(['site', URL_UNDER_TEST], fetchImpl);
    expect(code).toBe(0);
    expect(stdout).not.toContain('\u001b');
    expect(stdout).toContain('https://example.com/s?[2J.xml');
    expect(stdout).toContain('?[31mRED?[0m Evil');
  });
});
