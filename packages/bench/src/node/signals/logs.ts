// Server access logs: which AI crawlers fetched which pages, and which visits arrived from an
// AI assistant's link. Pure parsing of the text the caller passes in; nothing is fetched.
import { AI_CRAWLERS, type CrawlerInfo } from '../../crawlers';

export interface LogSignals {
  /** Non-empty lines in the input. */
  lines: number;
  /** Lines read as a request (combined format, or a JSON object with a path or user agent). */
  parsed: number;
  /** One entry per crawler in AI_CRAWLERS with at least one hit, most hits first. */
  crawlerHits: {
    userAgent: string;
    operator: string;
    purpose: string;
    hits: number;
    paths: Record<string, number>;
  }[];
  /**
   * Visits from an AI assistant (AI_REFERRAL_SOURCES), most visits first: the Referer is one of its
   * hosts, or, with no such Referer, the link's utm_source names it (ChatGPT adds
   * utm_source=chatgpt.com to the links it shows).
   */
  aiReferrals: { source: string; visits: number; paths: Record<string, number> }[];
}

/**
 * Referrer hostnames of AI assistants; a subdomain of a host (www.perplexity.ai) also counts.
 * These are the products' own web addresses (chat.openai.com is ChatGPT's former one), as
 * listed by the referral-tracking guides checked on 2026-10-23.
 */
export const AI_REFERRAL_SOURCES: readonly { source: string; hosts: readonly string[] }[] = [
  { source: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
  { source: 'Perplexity', hosts: ['perplexity.ai'] },
  { source: 'Gemini', hosts: ['gemini.google.com'] },
  { source: 'Copilot', hosts: ['copilot.microsoft.com'] },
  { source: 'Claude', hosts: ['claude.ai'] },
];

/** utm_source values that name an assistant: its hosts, and its bare name. */
const UTM_SOURCES: readonly { source: string; values: readonly string[] }[] =
  AI_REFERRAL_SOURCES.map((r) => ({
    source: r.source,
    values: [...r.hosts, r.source.toLowerCase()],
  }));

interface Request {
  path: string;
  /** The query string without `?`, '' when there is none. */
  query: string;
  userAgent: string;
  referer: string;
}

export type LogFormat = 'combined' | 'jsonl';

/**
 * Reads a combined-format access log (Apache/nginx default) or JSON lines. With no format, JSON
 * lines when most non-empty lines start with `{` (so a banner or header line does not decide it).
 * Lines that cannot be read are counted in `lines` but not `parsed`.
 */
export function parseAccessLog(text: string, opts: { format?: LogFormat } = {}): LogSignals {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const jsonish = lines.filter((l) => l.trimStart().startsWith('{')).length;
  const format = opts.format ?? (jsonish * 2 > lines.length ? 'jsonl' : 'combined');
  const readLine = format === 'jsonl' ? readJsonLine : readCombinedLine;

  const crawlers = new Map<CrawlerInfo, Map<string, number>>();
  const referrals = new Map<string, Map<string, number>>();
  let parsed = 0;
  for (const line of lines) {
    const req = readLine(line);
    if (!req) continue;
    parsed++;
    const crawler = matchCrawler(req.userAgent);
    if (crawler) bump(crawlers, crawler, req.path);
    const source = referralSource(req.referer) ?? utmSource(req.query);
    if (source) bump(referrals, source, req.path);
  }

  return {
    lines: lines.length,
    parsed,
    crawlerHits: [...crawlers]
      .map(([c, paths]) => ({
        userAgent: c.userAgent,
        operator: c.operator,
        purpose: c.purpose,
        hits: total(paths),
        paths: sortedRecord(paths),
      }))
      .sort((a, b) => b.hits - a.hits || a.userAgent.localeCompare(b.userAgent)),
    aiReferrals: [...referrals]
      .map(([source, paths]) => ({ source, visits: total(paths), paths: sortedRecord(paths) }))
      .sort((a, b) => b.visits - a.visits || a.source.localeCompare(b.source)),
  };
}

// %h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-Agent}i", then any extra fields. Quoted fields
// may hold backslash escapes (nginx writes \" and \xHH; unquote decodes both).
const QUOTED = '"((?:[^"\\\\]|\\\\.)*)"';
const COMBINED = new RegExp(
  `^\\S+ \\S+ \\S+ \\[[^\\]]*\\] ${QUOTED} \\S+ \\S+ ${QUOTED} ${QUOTED}`,
);

function readCombinedLine(line: string): Request | undefined {
  const m = COMBINED.exec(line.trim());
  if (!m) return undefined;
  const target = unquote(m[1]).split(' ')[1];
  return {
    path: target ? pathOf(target) : '(no path)',
    query: target ? queryOf(target) : '',
    referer: unquote(m[2]),
    userAgent: unquote(m[3]),
  };
}

const UTF8 = new TextDecoder('utf-8');

/**
 * A quoted log field with its escapes undone: `\xHH` runs are bytes, decoded as UTF-8 (nginx
 * writes a request for /café as /caf\xC3\xA9), and any other `\c` is the character c.
 */
function unquote(s: string): string {
  return s.replace(/((?:\\x[0-9a-fA-F]{2})+)|\\(.)/g, (_, hex: string | undefined, c: string) =>
    hex === undefined
      ? c
      : UTF8.decode(
          Uint8Array.from(hex.match(/[0-9a-fA-F]{2}/g) ?? [], (h) => Number.parseInt(h, 16)),
        ),
  );
}

// Field names compared lower-case with non-alphanumerics dropped, so user_agent, userAgent,
// user-agent and User-Agent are one name. Cloudflare's ClientRequest* fields are included.
const UA_KEYS = ['useragent', 'httpuseragent', 'ua', 'agent', 'clientrequestuseragent'];
const REFERER_KEYS = ['referer', 'referrer', 'httpreferer', 'httpreferrer', 'clientrequestreferer'];
const QUERY_KEYS = ['query', 'querystring', 'args', 'clientrequestquery'];
const PATH_KEYS = [
  'path',
  'requestpath',
  'uri',
  'requesturi',
  'url',
  'clientrequestpath',
  'clientrequesturi',
];

function readJsonLine(line: string): Request | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(value)) return undefined;
  // Flat fields first, then nested ones: Caddy logs request.uri and request.headers.
  const scopes = [value, value.request, getIn(value.request, 'headers')].filter(isObject);
  const find = (keys: string[]) => {
    for (const scope of scopes) {
      for (const [k, v] of Object.entries(scope)) {
        if (!keys.includes(k.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue;
        const s = Array.isArray(v) ? v[0] : v;
        if (typeof s === 'string' && s !== '') return s;
      }
    }
    return undefined;
  };
  const userAgent = find(UA_KEYS);
  let path = find(PATH_KEYS);
  // A "request" string such as "GET /a HTTP/1.1", as in nginx's $request.
  const request = value.request;
  if (path === undefined && typeof request === 'string') path = request.split(' ')[1];
  if (userAgent === undefined && path === undefined) return undefined;
  const query = (path ? queryOf(path) : '') || (find(QUERY_KEYS) ?? '').replace(/^\?/, '');
  return {
    path: path ? pathOf(path) : '(no path)',
    query,
    userAgent: userAgent ?? '',
    referer: find(REFERER_KEYS) ?? '',
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const getIn = (v: unknown, key: string) => (isObject(v) ? v[key] : undefined);

/** The path without its query string or fragment; an absolute URL gives its pathname. */
function pathOf(target: string): string {
  if (/^https?:\/\//i.test(target)) {
    try {
      return new URL(target).pathname;
    } catch {
      // fall through to the plain split
    }
  }
  return target.split(/[?#]/)[0] || '/';
}

/** The query string of a request target (without `?` or a fragment), '' when it has none. */
function queryOf(target: string): string {
  const q = target.indexOf('?');
  return q < 0 ? '' : target.slice(q + 1).split('#')[0];
}

/** The assistant a link's utm_source names, if any. */
function utmSource(query: string): string | undefined {
  if (query === '') return undefined;
  let value: string | null;
  try {
    value = new URLSearchParams(query).get('utm_source');
  } catch {
    return undefined;
  }
  const v = value?.trim().toLowerCase();
  return v ? UTM_SOURCES.find((u) => u.values.includes(v))?.source : undefined;
}

// Longest token first, so a token that contains another (Applebot-Extended, Applebot) wins.
const BY_LENGTH = [...AI_CRAWLERS].sort((a, b) => b.userAgent.length - a.userAgent.length);

function matchCrawler(userAgent: string): CrawlerInfo | undefined {
  const ua = userAgent.toLowerCase();
  return BY_LENGTH.find((c) => ua.includes(c.userAgent.toLowerCase()));
}

function referralSource(referer: string): string | undefined {
  if (referer === '' || referer === '-') return undefined;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return AI_REFERRAL_SOURCES.find((r) => r.hosts.some((h) => host === h || host.endsWith(`.${h}`)))
    ?.source;
}

function bump<K>(map: Map<K, Map<string, number>>, key: K, path: string): void {
  let paths = map.get(key);
  if (!paths) {
    paths = new Map();
    map.set(key, paths);
  }
  paths.set(path, (paths.get(path) ?? 0) + 1);
}

const total = (paths: Map<string, number>) => [...paths.values()].reduce((a, b) => a + b, 0);

/** Most-hit paths first. Object.fromEntries defines own keys, so "__proto__" stays a key. */
const sortedRecord = (paths: Map<string, number>): Record<string, number> =>
  Object.fromEntries([...paths].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
