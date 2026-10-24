import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { packFromUrls } from '../src/node/from-urls';

const ARTICLE = `<!doctype html><html><head><title>Why espresso turns bitter</title></head>
<body><nav><a href="/">Home</a></nav>
<article><h1>Why espresso turns bitter</h1>
<p>Espresso turns bitter when the shot over-extracts. A finer grind slows the water and pulls more bitter compounds from the coffee.</p>
<h2>How long should a shot run?</h2>
<p>Most baristas aim for a shot of 25 to 30 seconds with 18 g of coffee in the basket.</p>
</article><footer>Copyright notice</footer></body></html>`;

interface Served {
  status?: number;
  body: string;
  type?: string;
  /** A Location header, served with a 3xx `status`. */
  location?: string;
}

/**
 * A fetch stand-in serving `routes` by URL; every requested URL and its user agent is logged.
 * Like the real fetch, it follows a 3xx itself (requesting, and logging, the target) unless the
 * caller passes `redirect: 'manual'`, in which case the 3xx comes back as is.
 */
function site(routes: Record<string, Served>) {
  const requested: { url: string; userAgent: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = String(input);
    for (let hop = 0; hop <= 20; hop++) {
      requested.push({ url, userAgent: new Headers(init?.headers).get('user-agent') });
      const r = routes[url];
      if (!r) return new Response('not found', { status: 404 });
      const status = r.status ?? 200;
      if (r.location !== undefined && init?.redirect !== 'manual') {
        url = new URL(r.location, url).href;
        continue;
      }
      const headers: Record<string, string> = {
        'content-type': r.type ?? 'text/html; charset=utf-8',
      };
      if (r.location !== undefined) headers.location = r.location;
      return new Response(status >= 300 && status < 400 ? null : r.body, { status, headers });
    }
    throw new TypeError('redirect count exceeded');
  }) as typeof fetch;
  return { fetchImpl, requested };
}

describe('packFromUrls', () => {
  it('skips a URL that robots.txt disallows and keeps the other', async () => {
    const { fetchImpl, requested } = site({
      'https://example.com/robots.txt': {
        body: 'User-agent: *\nDisallow: /private\n',
        type: 'text/plain',
      },
      'https://example.com/public': { body: ARTICLE },
      'https://example.com/private': { body: ARTICLE },
    });
    const skipped: [string, string][] = [];
    const pack = await packFromUrls({
      question: 'why is my espresso bitter',
      urls: ['https://example.com/private', 'https://example.com/public'],
      packId: 'mine',
      fetchImpl,
      onSkip: (url, reason) => skipped.push([url, reason]),
    });

    expect(skipped).toEqual([['https://example.com/private', 'disallowed by robots.txt']]);
    expect(requested.map((r) => r.url)).not.toContain('https://example.com/private');
    // robots.txt is fetched once per origin.
    expect(requested.filter((r) => r.url.endsWith('/robots.txt'))).toHaveLength(1);

    expect(pack).toMatchObject({
      schemaVersion: 1,
      packId: 'mine',
      synthetic: false,
      license: 'Fetched by the user for private testing; do not redistribute',
    });
    expect(pack.queries).toHaveLength(1);
    expect(pack.queries[0].query).toBe('why is my espresso bitter');
    const docs = pack.queries[0].documents;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      url: 'https://example.com/public',
      title: 'Why espresso turns bitter',
      synthetic: false,
    });
    expect(docs[0].text).toContain('25 to 30 seconds');
    expect(docs[0].text).toContain('## How long should a shot run?');
    expect(docs[0].text).not.toContain('Copyright notice');
  });

  it('sends the user agent it is given and checks robots.txt rules for that agent', async () => {
    const { fetchImpl, requested } = site({
      'https://a.test/robots.txt': {
        body: 'User-agent: other-bot\nDisallow: /\n\nUser-agent: my-bot\nDisallow: /blocked\n',
        type: 'text/plain',
      },
      'https://a.test/page': { body: ARTICLE },
    });
    const skipped: string[] = [];
    await packFromUrls({
      question: 'q',
      urls: ['https://a.test/page', 'https://a.test/blocked'],
      packId: 'p',
      userAgent: 'my-bot',
      fetchImpl,
      onSkip: (url) => skipped.push(url),
    });
    expect(skipped).toEqual(['https://a.test/blocked']);
    expect(requested.every((r) => r.userAgent === 'my-bot')).toBe(true);
  });

  it('checks robots.txt before requesting a redirect target, and never requests a disallowed one', async () => {
    const { fetchImpl, requested } = site({
      'https://example.com/robots.txt': {
        body: 'User-agent: *\nDisallow: /private\n',
        type: 'text/plain',
      },
      'https://example.com/moved': { status: 301, body: '', location: '/private/page' },
      'https://example.com/private/page': { body: ARTICLE },
    });
    const skipped: [string, string][] = [];
    await expect(
      packFromUrls({
        question: 'q',
        urls: ['https://example.com/moved'],
        packId: 'p',
        fetchImpl,
        onSkip: (url, reason) => skipped.push([url, reason]),
      }),
    ).rejects.toThrow(/No page could be fetched/);
    expect(skipped).toEqual([
      [
        'https://example.com/moved',
        'redirected to https://example.com/private/page: disallowed by robots.txt',
      ],
    ]);
    expect(requested.map((r) => r.url)).toEqual([
      'https://example.com/robots.txt',
      'https://example.com/moved',
    ]);
  });

  it('reads the new origin robots.txt before a cross-origin hop', async () => {
    const { fetchImpl, requested } = site({
      'https://a.test/go': { status: 302, body: '', location: 'https://b.test/secret' },
      'https://a.test/fine': { status: 307, body: '', location: 'https://b.test/open' },
      'https://b.test/robots.txt': {
        body: 'User-agent: *\nDisallow: /secret\n',
        type: 'text/plain',
      },
      'https://b.test/secret': { body: ARTICLE },
      'https://b.test/open': { body: ARTICLE },
    });
    const skipped: [string, string][] = [];
    const pack = await packFromUrls({
      question: 'q',
      urls: ['https://a.test/go', 'https://a.test/fine'],
      packId: 'p',
      fetchImpl,
      onSkip: (url, reason) => skipped.push([url, reason]),
    });
    expect(skipped).toEqual([
      ['https://a.test/go', 'redirected to https://b.test/secret: disallowed by robots.txt'],
    ]);
    // The allowed hop is followed; the document keeps the URL the user named.
    expect(pack.queries[0].documents.map((d) => d.url)).toEqual(['https://a.test/fine']);
    const urls = requested.map((r) => r.url);
    expect(urls).not.toContain('https://b.test/secret');
    expect(urls).toContain('https://b.test/open');
    expect(urls.indexOf('https://b.test/robots.txt')).toBeLessThan(
      urls.indexOf('https://b.test/open'),
    );
  });

  it('with the real fetch, never requests a redirect target robots.txt disallows', async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/robots.txt') {
        res
          .writeHead(200, { 'content-type': 'text/plain' })
          .end('User-agent: *\nDisallow: /private\n');
      } else if (req.url === '/moved') {
        res.writeHead(301, { location: '/private/page' }).end();
      } else {
        res.writeHead(200, { 'content-type': 'text/html' }).end(ARTICLE);
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const skipped: string[] = [];
    try {
      await expect(
        packFromUrls({
          question: 'q',
          urls: [`http://127.0.0.1:${port}/moved`],
          packId: 'p',
          onSkip: (_url, reason) => skipped.push(reason),
        }),
      ).rejects.toThrow(/No page could be fetched/);
    } finally {
      await new Promise((done) => server.close(done));
    }
    expect(skipped).toEqual([
      `redirected to http://127.0.0.1:${port}/private/page: disallowed by robots.txt`,
    ]);
    expect(hits).toEqual(['/robots.txt', '/moved']);
  });

  it('skips a page that redirects more than five times', async () => {
    const { fetchImpl, requested } = site({
      'https://loop.test/a': { status: 302, body: '', location: '/b' },
      'https://loop.test/b': { status: 302, body: '', location: '/a' },
    });
    const skipped: [string, string][] = [];
    await expect(
      packFromUrls({
        question: 'q',
        urls: ['https://loop.test/a'],
        packId: 'p',
        fetchImpl,
        onSkip: (url, reason) => skipped.push([url, reason]),
      }),
    ).rejects.toThrow(/No page could be fetched/);
    expect(skipped).toEqual([['https://loop.test/a', 'more than 5 redirects']]);
    // robots.txt once, then the first request and five followed hops.
    expect(requested).toHaveLength(7);
  });

  it('treats a missing robots.txt as allowing everything', async () => {
    const { fetchImpl } = site({ 'https://b.test/page': { body: ARTICLE } });
    const pack = await packFromUrls({
      question: 'q',
      urls: ['https://b.test/page'],
      packId: 'p',
      fetchImpl,
    });
    expect(pack.queries[0].documents).toHaveLength(1);
  });

  it('skips pages that fail, non-HTTP URLs and unreachable robots.txt, with reasons', async () => {
    const { fetchImpl } = site({
      'https://c.test/ok': { body: ARTICLE },
      'https://c.test/gone': { status: 410, body: 'gone' },
      'https://d.test/robots.txt': { status: 503, body: 'busy', type: 'text/plain' },
      'https://d.test/page': { body: ARTICLE },
    });
    const skipped: [string, string][] = [];
    const pack = await packFromUrls({
      question: 'q',
      urls: [
        'https://c.test/ok',
        'https://c.test/gone',
        'ftp://c.test/file',
        'https://d.test/page',
      ],
      packId: 'p',
      fetchImpl,
      onSkip: (url, reason) => skipped.push([url, reason]),
    });
    expect(pack.queries[0].documents.map((d) => d.url)).toEqual(['https://c.test/ok']);
    expect(skipped).toEqual([
      ['https://c.test/gone', 'HTTP 410'],
      ['ftp://c.test/file', 'not an http(s) URL'],
      ['https://d.test/page', 'robots.txt unavailable (HTTP 503)'],
    ]);
  });

  it('sends a timeout signal with every request, and skips a page whose body fails mid-read', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url.endsWith('/broken')) {
        const body = new ReadableStream({
          start(controller) {
            controller.error(new Error('connection reset'));
          },
        });
        return new Response(body, { headers: { 'content-type': 'text/html' } });
      }
      return new Response(ARTICLE, { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const skipped: [string, string][] = [];
    const pack = await packFromUrls({
      question: 'q',
      urls: ['https://example.com/broken', 'https://example.com/ok'],
      packId: 'p',
      fetchImpl,
      onSkip: (url, reason) => skipped.push([url, reason]),
    });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((sig) => sig instanceof AbortSignal)).toBe(true);
    expect(skipped).toEqual([
      ['https://example.com/broken', 'reading the page failed (connection reset)'],
    ]);
    expect(pack.queries[0].documents.map((d) => d.url)).toEqual(['https://example.com/ok']);
  });

  it('skips a page whose request times out instead of hanging the pack', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url.endsWith('/slow')) {
        // As a stalled host would: the request ends only when its signal aborts.
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return new Response(ARTICLE, { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const skipped: string[] = [];
    await packFromUrls({
      question: 'q',
      urls: ['https://example.com/slow', 'https://example.com/ok'],
      packId: 'p',
      fetchImpl,
      onSkip: (_url, reason) => skipped.push(reason),
    });
    expect(skipped).toEqual(['fetch failed (The operation was aborted due to timeout)']);
  });

  it('throws when every URL is skipped', async () => {
    const { fetchImpl } = site({
      'https://e.test/robots.txt': { body: 'User-agent: *\nDisallow: /\n', type: 'text/plain' },
    });
    await expect(
      packFromUrls({ question: 'q', urls: ['https://e.test/x'], packId: 'p', fetchImpl }),
    ).rejects.toThrow(/No page could be fetched/);
  });
});
