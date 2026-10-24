import {
  analyzeReadiness,
  type ReadinessItem,
  type ReadinessResult,
} from '@citation-equity/engine';
import { Defuddle } from 'defuddle/node';
import { parseHTML } from 'linkedom';
import { AI_CRAWLERS, type CrawlerInfo } from '../crawlers';
import { DEFAULT_USER_AGENT } from './from-urls';
import { readRobots } from './robots';

export { AI_CRAWLERS };

export interface CrawlerVerdict extends CrawlerInfo {
  /** Whether robots.txt lets this crawler fetch the checked URL. */
  allowed: boolean;
}
export interface SiteReport {
  schemaVersion: 1;
  url: string;
  fetchedAt: string;
  /** The page's HTTP status, or null when it could not be fetched at all. */
  httpStatus: number | null;
  robotsTxtFound: boolean;
  sitemaps: string[];
  crawlers: CrawlerVerdict[];
  /** Words of main text Defuddle extracts from the raw HTML (no JavaScript run). */
  extractedWords: number;
  readiness: ReadinessResult;
}

/** Each request gives up after this long, so a site that never answers cannot stall the check. */
const TIMEOUT_MS = 20_000;
/** renders-without-js thresholds, in extracted words. */
const PASS_WORDS = 200;
const WARN_WORDS = 50;

/**
 * Site readiness for one URL, reported apart from any GEO Score. Reads the origin's robots.txt
 * (the same reader `ce pack from-urls` uses) and checks each of AI_CRAWLERS against the URL, then
 * fetches the page's raw HTML once, runs no JavaScript, and measures what Defuddle can extract.
 * The page-level items come from the engine's `analyzeReadiness` on that HTML and the page's
 * X-Robots-Tag header. A page that cannot be fetched gives `httpStatus: null`, not an error, and
 * a page whose text cannot be extracted reads as 0 words with the reason; only a URL that is not
 * http(s) throws. A URL without a scheme is tried as https.
 */
export async function checkSite(
  url: string,
  opts: { fetchImpl?: typeof fetch; userAgent?: string; now?: () => Date } = {},
): Promise<SiteReport> {
  // A bare host or path (example.com/page) is tried as https, as a browser's address bar does.
  // Only a leading scheme counts: "example.com/?next=https://x" has none.
  const full = /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`;
  const target = URL.canParse(full) ? new URL(full) : undefined;
  if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
    throw new Error(`Not an http(s) URL: ${url}`);
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const fetchedAt = (opts.now ?? (() => new Date()))().toISOString();
  const get = (u: string) =>
    fetchImpl(u, {
      headers: { 'user-agent': userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  const robots = await readRobots(get, target.origin);
  const unavailable = robots !== null && 'unavailable' in robots ? robots.unavailable : undefined;
  const parsed = robots !== null && !('unavailable' in robots) ? robots : undefined;
  const crawlers: CrawlerVerdict[] = AI_CRAWLERS.map((c) => ({
    ...c,
    // Unreadable robots.txt: RFC 9309 says to assume everything is disallowed.
    allowed: unavailable
      ? false
      : parsed
        ? parsed.isAllowed(target.href, c.userAgent) !== false
        : true,
  }));

  const page = await fetchPage(get, target);
  const extraction = page.html === undefined ? 0 : await countMainWords(page.html, target.href);
  const extractedWords = typeof extraction === 'number' ? extraction : 0;
  const base = analyzeReadiness({ html: page.html, xRobotsTag: page.xRobotsTag });
  const items = base.items.map((item): ReadinessItem => {
    if (item.id === 'crawler-access')
      return { ...item, ...crawlerAccess(crawlers, unavailable, parsed !== undefined) };
    if (item.id === 'renders-without-js') return { ...item, ...rendering(page, extraction) };
    // Page-level items with no HTML to read say why.
    if (page.html === undefined) return { ...item, detail: `Not checked: ${page.problem}.` };
    return item;
  });

  return {
    schemaVersion: 1,
    url: target.href,
    fetchedAt,
    httpStatus: page.status,
    robotsTxtFound: parsed !== undefined,
    sitemaps: parsed ? parsed.getSitemaps() : [],
    crawlers,
    extractedWords,
    readiness: { schemaVersion: 1, items },
  };
}

interface FetchedPage {
  status: number | null;
  /** The raw HTML, only for a 2xx HTML response. */
  html?: string;
  xRobotsTag?: string;
  /** Why there is no HTML, when there is none. */
  problem: string;
}

async function fetchPage(get: (u: string) => Promise<Response>, target: URL): Promise<FetchedPage> {
  let res: Response;
  try {
    res = await get(target.href);
  } catch (err) {
    return { status: null, problem: `the page could not be fetched (${message(err)})` };
  }
  const xRobotsTag = res.headers.get('x-robots-tag') ?? undefined;
  if (!res.ok)
    return { status: res.status, xRobotsTag, problem: `the page returned HTTP ${res.status}` };
  const type = res.headers.get('content-type') ?? '';
  if (type !== '' && !type.includes('html')) {
    return { status: res.status, xRobotsTag, problem: `the page is ${type}, not HTML` };
  }
  try {
    return { status: res.status, html: await res.text(), xRobotsTag, problem: '' };
  } catch (err) {
    return {
      status: res.status,
      xRobotsTag,
      problem: `the page could not be fetched (${message(err)})`,
    };
  }
}

/**
 * An error's message with its cause: undici reports a redirect loop or a refused connection as
 * "fetch failed" and keeps the reason (for example "redirect count exceeded") in `cause`.
 */
const message = (err: unknown): string => {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : undefined;
  return cause && cause !== err.message ? `${err.message}: ${cause}` : err.message;
};

/** Words of main text Defuddle extracts, or why extraction failed. */
async function countMainWords(html: string, url: string): Promise<number | string> {
  try {
    const { document } = parseHTML(html);
    const result = await Defuddle(document as unknown as Document, url, {});
    return result.wordCount ?? 0;
  } catch (err) {
    return message(err);
  }
}

type ItemState = Pick<ReadinessItem, 'status' | 'detail'>;

const label = (c: CrawlerVerdict) => `${c.userAgent} (${c.operator}, ${c.purpose})`;

function crawlerAccess(
  crawlers: CrawlerVerdict[],
  unavailable: string | undefined,
  found: boolean,
): ItemState {
  if (unavailable) {
    return {
      status: 'fail',
      detail: `${unavailable}. Under RFC 9309 crawlers treat a robots.txt they cannot read as disallowing everything.`,
    };
  }
  const blocked = crawlers.filter((c) => !c.allowed);
  // Ruling R25: a blocked AI search, user-fetch or search-engine crawler (Googlebot, Bingbot,
  // Applebot) fails; otherwise a blocked training crawler warns; anything else passes. A page
  // Googlebot may not fetch is out of Google Search, and so out of AI Overviews and AI Mode too.
  const answering = blocked.filter((c) => c.purpose === 'search' || c.purpose === 'user-fetch');
  const training = blocked.filter((c) => c.purpose === 'training');
  const engines = blocked.filter((c) => c.purpose === 'search-engine');
  const trainingNote = training.length > 0 ? ` ${trainingDetail(training)}` : '';
  if (answering.length > 0 || engines.length > 0) {
    const parts: string[] = [];
    if (answering.length > 0) {
      parts.push(
        `robots.txt disallows this URL for ${answering.map(label).join(', ')}. These crawlers feed AI search and answers, not only training, so the page can drop out of those engines' answers.`,
      );
    }
    if (engines.length > 0) {
      parts.push(
        `robots.txt disallows this URL for ${engines.map(label).join(', ')}. A blocked search engine crawler keeps the page out of that engine's results and the AI answers built on them.`,
      );
    }
    return { status: 'fail', detail: `${parts.join(' ')}${trainingNote}` };
  }
  if (training.length > 0) {
    return {
      status: 'warn',
      detail: `${trainingDetail(training)} The AI search, user-fetch and search engine crawlers checked are allowed.`,
    };
  }
  return {
    status: 'pass',
    detail: found
      ? `robots.txt allows all ${crawlers.length} AI crawlers checked to fetch this URL.`
      : `No robots.txt (HTTP 4xx), so all ${crawlers.length} AI crawlers checked may fetch this URL.`,
  };
}

/**
 * The training-crawler sentence. Google-Extended is a training token, but Google says it also
 * decides whether Gemini Apps may ground answers on the page, so the sentence says that too.
 */
function trainingDetail(training: CrawlerVerdict[]): string {
  const text = `Training crawlers are blocked: ${training.map(label).join(', ')}.`;
  return training.some((c) => c.userAgent === 'Google-Extended')
    ? `${text} Google-Extended also controls grounding in Gemini Apps, so Gemini's own answers may not use this page; Google Search is not affected.`
    : text;
}

function rendering(page: FetchedPage, words: number | string): ItemState {
  if (page.status === null) return { status: 'unknown', detail: `Not checked: ${page.problem}.` };
  if (typeof words === 'string') {
    return {
      status: 'unknown',
      detail: `Not checked: the page's text could not be extracted (${words}).`,
    };
  }
  if (page.html === undefined) {
    return page.status >= 400
      ? {
          status: 'fail',
          detail: `The page returned HTTP ${page.status}, so crawlers get no article from it.`,
        }
      : { status: 'unknown', detail: `Not checked: ${page.problem}.` };
  }
  const text = `Without running JavaScript, ${words} word${words === 1 ? '' : 's'} of main text could be extracted`;
  if (words >= PASS_WORDS) return { status: 'pass', detail: `${text}.` };
  if (words >= WARN_WORDS) {
    return {
      status: 'warn',
      detail: `${text}. Check that the article's text is in the HTML the server sends.`,
    };
  }
  return {
    status: 'fail',
    detail: `${text}. AI crawlers that do not run JavaScript see an almost empty page; render the text on the server.`,
  };
}
