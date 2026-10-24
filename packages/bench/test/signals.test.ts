import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/node/cli';
import {
  AI_REFERRAL_SOURCES,
  parseAccessLog,
  parseBingAiPerformanceCsv,
  SIGNALS_NOTE,
} from '../src/node/signals';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name: string) => join(PKG, 'test', 'fixtures', 'signals', name);
const read = (name: string) => readFile(fixture(name), 'utf8');

async function ce(args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(args, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr };
}

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const combined = (path: string, referer: string, ua: string) =>
  `192.0.2.1 - - [22/Oct/2026:12:00:00 +0000] "GET ${path} HTTP/1.1" 200 100 "${referer}" "${ua}"`;

describe('parseAccessLog (combined log format)', () => {
  it('counts AI crawler hits by path, AI assistant referrals, and skips a normal visit', async () => {
    const s = parseAccessLog(await read('access.log'));
    expect(s.lines).toBe(7);
    expect(s.parsed).toBe(6);
    expect(s.crawlerHits).toEqual([
      {
        userAgent: 'GPTBot',
        operator: 'OpenAI',
        purpose: 'training',
        hits: 3,
        paths: { '/espresso/bitterness': 2, '/espresso/grind': 1 },
      },
      {
        userAgent: 'PerplexityBot',
        operator: 'Perplexity',
        purpose: 'search',
        hits: 1,
        paths: { '/espresso/bitterness': 1 },
      },
    ]);
    expect(s.aiReferrals).toEqual([
      { source: 'ChatGPT', visits: 1, paths: { '/espresso/bitterness': 1 } },
    ]);
  });

  it('matches user agent tokens case-insensitively (bingbot is logged in lower case)', () => {
    const s = parseAccessLog(
      combined('/', '-', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'),
    );
    expect(s.crawlerHits.map((c) => [c.userAgent, c.purpose])).toEqual([
      ['Bingbot', 'search-engine'],
    ]);
  });

  it('prefers the longest matching token, so Claude-SearchBot is not also counted as another bot', () => {
    const s = parseAccessLog(
      combined(
        '/a',
        '-',
        'Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +claudebot@anthropic.com)',
      ),
    );
    expect(s.crawlerHits.map((c) => c.userAgent)).toEqual(['Claude-SearchBot']);
  });

  it('recognizes every listed referral host and its subdomains, and nothing else', () => {
    const hosts = AI_REFERRAL_SOURCES.flatMap((r) => r.hosts.map((h) => [r.source, h]));
    const log = [
      ...hosts.map(([, h]) => combined('/p', `https://${h}/c/123`, CHROME)),
      combined('/p', 'https://www.perplexity.ai/search/x', CHROME),
      combined('/p', 'https://notchatgpt.com/', CHROME),
      combined('/p', 'https://chatgpt.com.evil.example/', CHROME),
      combined('/p', 'not a url', CHROME),
    ].join('\n');
    const s = parseAccessLog(log);
    const visits = Object.fromEntries(s.aiReferrals.map((r) => [r.source, r.visits]));
    const expected: Record<string, number> = {};
    for (const [source] of hosts) expected[source] = (expected[source] ?? 0) + 1;
    expected.Perplexity += 1;
    expect(visits).toEqual(expected);
    expect(Object.keys(visits).sort()).toEqual([
      'ChatGPT',
      'Claude',
      'Copilot',
      'Gemini',
      'Perplexity',
    ]);
  });

  it('keeps an attacker-chosen path such as __proto__ as an ordinary key', () => {
    const s = parseAccessLog(combined('__proto__', '-', 'GPTBot/1.2'));
    expect(Object.keys(s.crawlerHits[0].paths)).toEqual(['__proto__']);
  });

  it('reads escaped quotes inside the request and user agent fields', () => {
    const s = parseAccessLog(
      '192.0.2.1 - - [22/Oct/2026:12:00:00 +0000] "GET /q?x=\\"y\\" HTTP/1.1" 200 1 "-" "Mozilla \\"x\\" GPTBot/1.2"',
    );
    expect(s.parsed).toBe(1);
    expect(s.crawlerHits[0].paths).toEqual({ '/q': 1 });
  });

  it('decodes nginx \\xHH escapes as UTF-8, so /café is one path', () => {
    const s = parseAccessLog(
      '192.0.2.1 - - [22/Oct/2026:12:00:00 +0000] "GET /caf\\xC3\\xA9 HTTP/1.1" 200 1 "-" "GPTBot/1.2"',
    );
    expect(s.crawlerHits[0].paths).toEqual({ '/café': 1 });
  });

  it('counts a visit tagged utm_source=chatgpt.com that sent no Referer as a ChatGPT referral', () => {
    const line = (target: string, referer = '-') =>
      `192.0.2.1 - - [22/Oct/2026:12:00:00 +0000] "GET ${target} HTTP/1.1" 200 1 "${referer}" "Mozilla/5.0"`;
    const s = parseAccessLog(
      [
        line('/espresso?utm_source=chatgpt.com'),
        line('/espresso?utm_source=Perplexity&x=1'),
        line('/about?utm_source=newsletter'),
        // A Referer that names an assistant wins, and a visit is counted once.
        line('/espresso?utm_source=chatgpt.com', 'https://www.perplexity.ai/search'),
      ].join('\n'),
    );
    expect(s.aiReferrals).toEqual([
      { source: 'Perplexity', visits: 2, paths: { '/espresso': 2 } },
      { source: 'ChatGPT', visits: 1, paths: { '/espresso': 1 } },
    ]);
    const json = parseAccessLog(
      '{"path":"/a","query":"utm_source=claude.ai","user_agent":"Mozilla/5.0"}',
    );
    expect(json.aiReferrals).toEqual([{ source: 'Claude', visits: 1, paths: { '/a': 1 } }]);
  });

  it('picks the format by most lines, so a banner line does not hide JSON lines', () => {
    const s = parseAccessLog(
      '# log export 2026-10-22\n{"path":"/a","user_agent":"GPTBot/1.2"}\n{"path":"/b","user_agent":"GPTBot/1.2"}\n',
    );
    expect(s.parsed).toBe(2);
    expect(s.crawlerHits[0].hits).toBe(2);
  });

  it('returns empty signals for an empty file', () => {
    expect(parseAccessLog('\n  \n')).toEqual({
      lines: 0,
      parsed: 0,
      crawlerHits: [],
      aiReferrals: [],
    });
  });
});

describe('parseAccessLog (JSON lines)', () => {
  it('detects JSON lines and reads common field names, including nested Caddy headers', async () => {
    const s = parseAccessLog(await read('access.jsonl'));
    expect(s.lines).toBe(5);
    expect(s.parsed).toBe(4);
    expect(s.crawlerHits.map((c) => [c.userAgent, c.hits, c.paths])).toEqual([
      ['GPTBot', 1, { '/espresso/bitterness': 1 }],
      ['PerplexityBot', 1, { '/espresso/bitterness': 1 }],
    ]);
    expect(s.aiReferrals).toEqual([
      { source: 'ChatGPT', visits: 1, paths: { '/espresso/bitterness': 1 } },
      { source: 'Perplexity', visits: 1, paths: { '/about': 1 } },
    ]);
  });

  it('reads the path from an nginx-style "request" line', () => {
    const s = parseAccessLog('{"request":"GET /r?x=1 HTTP/1.1","http_user_agent":"GPTBot/1.2"}');
    expect(s.crawlerHits[0].paths).toEqual({ '/r': 1 });
  });

  it('honours an explicit format, so a combined log read as JSON lines parses nothing', async () => {
    const s = parseAccessLog(await read('access.log'), { format: 'jsonl' });
    expect(s.lines).toBe(7);
    expect(s.parsed).toBe(0);
  });
});

describe('parseBingAiPerformanceCsv', () => {
  it('reads a pages export: BOM, quoted thousands, duplicate URLs summed, sorted by citations', async () => {
    const s = parseBingAiPerformanceCsv(await read('bing-pages.csv'));
    expect(s).toEqual({
      rows: 4,
      totalCitations: 1540,
      byPage: [
        { url: 'https://example.com/espresso/bitterness', citations: 1204 },
        { url: 'https://example.com/espresso/grind', citations: 330 },
        { url: 'https://example.com/about', citations: 6 },
      ],
      byQuery: [],
      dateRange: null,
    });
  });

  it('reads a grounding queries export and ignores the extra columns', async () => {
    const s = parseBingAiPerformanceCsv(await read('bing-queries.csv'));
    expect(s.totalCitations).toBe(69);
    expect(s.byQuery).toEqual([
      { query: 'why is my espresso bitter', citations: 52 },
      { query: 'espresso grind size', citations: 17 },
    ]);
    expect(s.byPage).toEqual([]);
  });

  it('reads a daily export: a numeric "Cited Pages" count is not taken for the page column', async () => {
    const s = parseBingAiPerformanceCsv(await read('bing-daily.csv'));
    expect(s.rows).toBe(3);
    expect(s.totalCitations).toBe(77);
    expect(s.byPage).toEqual([]);
    expect(s.dateRange).toEqual(['2026-09-24', '2026-10-21']);
  });

  it('matches headers case-insensitively and accepts known aliases', () => {
    const s = parseBingAiPerformanceCsv('URL,TOTAL CITATIONS\r\nhttps://a.example/x,3\r\n');
    expect(s.byPage).toEqual([{ url: 'https://a.example/x', citations: 3 }]);
  });

  it('skips preamble lines above the header row', () => {
    const s = parseBingAiPerformanceCsv(
      'AI Performance\nThe data shown represents a sample\nPage,Citations\nhttps://a.example/,2\n',
    );
    expect(s.totalCitations).toBe(2);
  });

  it('reads a semicolon-separated export behind a preamble line', () => {
    const s = parseBingAiPerformanceCsv(
      'AI Performance\nPage;Citations\nhttps://a.example/x,y;5\n',
    );
    expect(s.byPage).toEqual([{ url: 'https://a.example/x,y', citations: 5 }]);
  });

  it('fails with the headers it found when required columns are missing', async () => {
    const text = await read('not-bing.csv');
    expect(() => parseBingAiPerformanceCsv(text)).toThrow(
      /citations column.*Headers found: Keyword, Clicks, Impressions/s,
    );
    expect(() => parseBingAiPerformanceCsv('Citations,Share\n4,1%\n')).toThrow(
      /page, grounding query or date column.*Headers found: Citations, Share/s,
    );
    expect(() => parseBingAiPerformanceCsv('')).toThrow(/Headers found: \(none\)/);
  });

  it('fails readably on a citation count or date it cannot read', () => {
    expect(() => parseBingAiPerformanceCsv('Page,Citations\n/a,lots\n')).toThrow(
      /Row 2: citations value "lots" is not a number/,
    );
    expect(() => parseBingAiPerformanceCsv('Date,Citations\nyesterday,1\n')).toThrow(
      /Row 2: cannot read date "yesterday"/,
    );
  });
});

describe('ce signals', () => {
  it('logs: prints the local-only line, crawler and referral tables', async () => {
    const { code, stdout } = await ce(['signals', 'logs', fixture('access.log')]);
    expect(code).toBe(0);
    expect(stdout.split('\n')[0]).toBe(SIGNALS_NOTE);
    expect(SIGNALS_NOTE).toBe('Real signals from your own site; nothing is sent anywhere.');
    expect(stdout).toContain('7 lines, 6 parsed');
    expect(stdout).toMatch(/^GPTBot\s+OpenAI\s+training\s+3\s+\/espresso\/bitterness \(2\)/m);
    expect(stdout).toMatch(/^ChatGPT\s+1\s+\/espresso\/bitterness \(1\)/m);
  });

  it('logs: says how to fix it when no line parses, and honours --format', async () => {
    const guessed = await ce(['signals', 'logs', fixture('access.log'), '--format', 'jsonl']);
    expect(guessed.code).toBe(0);
    expect(guessed.stdout).toContain('7 lines, 0 parsed');
    expect(guessed.stdout).toContain(
      'No line could be read as a request. ce reads the combined format (Apache and nginx default) and JSON lines; pass --format combined or --format jsonl if it guessed wrong.',
    );
    const right = await ce(['signals', 'logs', fixture('access.log'), '--format', 'combined']);
    expect(right.stdout).toContain('7 lines, 6 parsed');
    expect(right.stdout).not.toContain('No line could be read');
  });

  it('logs --json: valid JSON on stdout, the local-only line on stderr', async () => {
    const { code, stdout, stderr } = await ce([
      'signals',
      'logs',
      fixture('access.jsonl'),
      '--json',
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).parsed).toBe(4);
    expect(stderr).toBe(`${SIGNALS_NOTE}\n`);
  });

  it('logs: strips terminal control characters from paths before printing', async () => {
    const { stdout } = await ce(['signals', 'logs', fixture('control.jsonl')]);
    expect(stdout).not.toContain('\u001b');
    expect(stdout).toContain('/x?[31m');
  });

  it('bing: prints the local-only line, totals and top pages', async () => {
    const { code, stdout } = await ce(['signals', 'bing', fixture('bing-pages.csv')]);
    expect(code).toBe(0);
    expect(stdout.split('\n')[0]).toBe(SIGNALS_NOTE);
    expect(stdout).toContain('4 rows, 1540 citations');
    expect(stdout).toMatch(/^\s+1204\s+https:\/\/example\.com\/espresso\/bitterness$/m);
  });

  it('bing --json: valid JSON on stdout', async () => {
    const { code, stdout, stderr } = await ce([
      'signals',
      'bing',
      fixture('bing-daily.csv'),
      '--json',
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).dateRange).toEqual(['2026-09-24', '2026-10-21']);
    expect(stderr).toBe(`${SIGNALS_NOTE}\n`);
  });

  it('bing: exits 1 and lists the headers found for a file that is not the export', async () => {
    const { code, stderr } = await ce(['signals', 'bing', fixture('not-bing.csv')]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Headers found: Keyword, Clicks, Impressions/);
  });

  it('exits 1 with a message for a missing file', async () => {
    const { code, stderr } = await ce(['signals', 'logs', '/nonexistent/access.log']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Cannot read \/nonexistent\/access\.log/);
  });
});
