import { Defuddle } from 'defuddle/node';
import { parseHTML } from 'linkedom';
import { validatePack } from '../pack';
import type { Pack, PackDocument } from '../types';
import { type RobotsRule, readRobots } from './robots';

export const FROM_URLS_LICENSE = 'Fetched by the user for private testing; do not redistribute';
export const DEFAULT_USER_AGENT = 'citation-equity-bench';

/**
 * Builds a one-query pack from pages the user names: never search results. Before each request
 * for a page, its origin's robots.txt is read (once per origin) and checked for `userAgent`; a page
 * it disallows is skipped, as is one whose robots.txt cannot be read (network error or 5xx), one
 * that fails to load, or one with no readable text. A missing robots.txt (4xx) allows all.
 * Page redirects are followed by hand (at most MAX_REDIRECTS hops), and every hop, including one
 * to another origin, passes the same robots.txt check before it is requested.
 * Every request times out after 20 s, and a body that fails to read or a page Defuddle cannot
 * parse is skipped too. Each skip is reported through `onSkip(url, reason)`. Readable text is
 * extracted with Defuddle as Markdown, so headings, lists and tables survive for the competitor
 * profile.
 * Throws if no page could be used.
 */
export async function packFromUrls(input: {
  question: string;
  urls: string[];
  packId: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  onSkip?: (url: string, reason: string) => void;
}): Promise<Pack> {
  const userAgent = input.userAgent ?? DEFAULT_USER_AGENT;
  const fetchImpl = input.fetchImpl ?? fetch;
  // robots.txt itself may redirect (RFC 9309 asks crawlers to follow), so it uses fetch's own
  // redirect handling; pages use `redirect: 'manual'` so each hop is checked before it is sent.
  // Every request gives up after TIMEOUT_MS (as ce site's do), so one stalled host skips its
  // page instead of hanging the whole pack.
  const get = (url: string) =>
    fetchImpl(url, {
      headers: { 'user-agent': userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  const getManual = (url: string) =>
    fetchImpl(url, {
      headers: { 'user-agent': userAgent },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  const robotsByOrigin = new Map<string, Promise<RobotsRule>>();

  /** Why `url` may not be fetched, or undefined when robots.txt allows it. */
  const robotsBlock = async (url: URL): Promise<string | undefined> => {
    let rule = robotsByOrigin.get(url.origin);
    if (!rule) {
      rule = readRobots(get, url.origin);
      robotsByOrigin.set(url.origin, rule);
    }
    const r = await rule;
    if (r === null) return undefined;
    if ('unavailable' in r) return r.unavailable;
    return r.isAllowed(url.href, userAgent) === false ? 'disallowed by robots.txt' : undefined;
  };

  /** The page's title and readable text, or the reason it is skipped. */
  const fetchPage = async (raw: string): Promise<{ title: string; text: string } | string> => {
    const start = URL.canParse(raw) ? new URL(raw) : undefined;
    if (!start || !isHttp(start)) return 'not an http(s) URL';

    let url = start;
    /** Prefixes a skip reason with the hop it happened on, once the page has redirected. */
    const at = (reason: string) =>
      url === start ? reason : `redirected to ${url.href}: ${reason}`;
    let res: Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isHttp(url)) return at('not an http(s) URL');
      const blocked = await robotsBlock(url);
      if (blocked) return at(blocked);
      try {
        res = await getManual(url.href);
      } catch (err) {
        return at(`fetch failed (${errorText(err)})`);
      }
      // A runtime that hides the redirect target (an opaque redirect) cannot be checked first.
      if (res.type === 'opaqueredirect') return at('redirect target hidden by the runtime');
      const location = REDIRECT_STATUSES.has(res.status) ? res.headers.get('location') : null;
      if (location === null) break;
      if (!URL.canParse(location, url)) return at(`bad redirect location ${location}`);
      url = new URL(location, url);
      res = undefined;
    }
    if (!res) return `more than ${MAX_REDIRECTS} redirects`;
    if (!res.ok) return at(`HTTP ${res.status}`);

    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/plain') && type !== '' && !type.includes('html')) {
      return at(`unsupported content type ${type}`);
    }
    // A body that fails mid-read, or a page Defuddle cannot parse, skips this page only.
    let body: string;
    try {
      body = await res.text();
    } catch (err) {
      return at(`reading the page failed (${errorText(err)})`);
    }
    let page: { title: string; text: string };
    if (type.includes('text/plain')) {
      page = { title: '', text: body.trim() };
    } else {
      try {
        const { document } = parseHTML(body);
        const result = await Defuddle(document as unknown as Document, url.href, {
          markdown: true,
        });
        page = { title: result.title ?? '', text: (result.content ?? '').trim() };
      } catch (err) {
        return at(`text extraction failed (${errorText(err)})`);
      }
    }
    return page.text === '' ? at('no readable text') : page;
  };

  const documents: PackDocument[] = [];
  for (const raw of input.urls) {
    const page = await fetchPage(raw);
    if (typeof page === 'string') {
      input.onSkip?.(raw, page);
    } else {
      documents.push({ docId: `u${documents.length + 1}`, ...page, url: raw, synthetic: false });
    }
  }

  if (documents.length === 0) {
    throw new Error('No page could be fetched: every URL was skipped');
  }
  return validatePack({
    schemaVersion: 1,
    packId: input.packId,
    title: input.question,
    source: 'Pages named by the user (ce pack from-urls)',
    license: FROM_URLS_LICENSE,
    synthetic: false,
    queries: [{ queryId: 'q1', query: input.question, documents }],
  });
}

/** Hops a page may redirect through before it is skipped. */
const MAX_REDIRECTS = 5;
/** Each request gives up after this long (the same limit as `ce site`). */
const TIMEOUT_MS = 20_000;

/** An error's message, with its cause when fetch hides the reason behind "fetch failed". */
function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : undefined;
  return cause && cause !== err.message ? `${err.message}: ${cause}` : err.message;
}
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isHttp(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}
