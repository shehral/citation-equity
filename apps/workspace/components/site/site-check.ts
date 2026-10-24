// Plain module (no 'use client'): the /site check on pasted HTML and robots.txt, as data. The
// view renders it, and the home's "Try it with an example" can store the same summary from it.
// Everything runs in the browser; nothing is fetched.
import { type CrawlerVerdict, crawlerAccessStatus, crawlerVerdicts } from '@citation-equity/bench';
import {
  analyzeReadiness,
  type Evidence,
  type ReadinessId,
  type ReadinessItem,
  rendersWithoutJs,
} from '@citation-equity/engine';
import type { SiteSummary } from '@/lib/store';

/** A row's state: judged here, or left for `ce site` on the live page. */
export type RowStatus = 'pass' | 'warn' | 'fail' | 'live';

export interface SiteRow {
  id: ReadinessId;
  /** Plain name. */
  name: string;
  /** What it checks, 10 words or fewer. */
  what: string;
  status: RowStatus;
  /** The finding, one short line. */
  result: string;
  /** The longer finding, when the short line leaves something out; shown under Why it matters. */
  detail?: string;
  /** Why it matters, one sentence. */
  why: string;
  evidence: Evidence;
}

export type SiteCounts = Omit<SiteSummary, 'example' | 'at'>;

export interface SiteCheck {
  rows: SiteRow[];
  summary: SiteCounts;
  /** What still needs the live site, in plain words. */
  liveOnly: string[];
}

export const ROWS: readonly { id: ReadinessId; name: string; what: string; why: string }[] = [
  {
    id: 'byline',
    name: 'Author name',
    what: 'Your name, in a form machines can read.',
    why: 'Google asks for clear authorship; no study tests it for AI citation.',
  },
  {
    id: 'dates',
    name: 'Dates',
    what: 'When it was published and updated.',
    why: 'AI rankers favor newer dates, so keep them accurate.',
  },
  {
    id: 'structured-data',
    name: 'Structured data (schema)',
    what: 'Schema that says what the page is.',
    why: "Not required for Google's AI features; keep it matching the page.",
  },
  {
    id: 'indexing-directives',
    name: 'Search can show it',
    what: 'No tag blocks search engines from showing it.',
    why: 'Google and Bing drop blocked pages from AI answers.',
  },
  {
    id: 'canonical',
    name: 'Main URL (canonical)',
    what: 'The one address this page should be known by.',
    why: 'Helps when one post lives at several addresses.',
  },
  {
    id: 'crawler-access',
    name: 'AI crawlers allowed',
    what: 'robots.txt lets AI search crawlers in.',
    why: "AI search skips pages its crawler can't fetch.",
  },
  {
    id: 'renders-without-js',
    name: 'Text loads without JavaScript',
    what: 'The text is in the HTML, not added by scripts.',
    why: "Most AI crawlers don't run JavaScript.",
  },
];

/** The response header only `ce site` can read. */
const HEADER_LIVE = 'The X-Robots-Tag response header';
const CRAWLERS_LIVE = 'AI crawlers allowed, unless you paste robots.txt';
/** Rows checked on a page with no canonical URL use the site's home page. */
const HOME = 'https://example.com/';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const names = (vs: CrawlerVerdict[]) => vs.map((v) => v.userAgent).join(', ');

/** The canonical URL the engine accepted, when it is one URL the browser can parse. */
function pageUrl(canonical: ReadinessItem): string | undefined {
  if (canonical.status !== 'pass') return undefined;
  const url = canonical.detail.replace(/^Canonical: /, '');
  try {
    return new URL(url).href;
  } catch {
    return undefined;
  }
}

/** One compact line for a row that is not a pass; the engine's full sentence goes to `detail`. */
function issueLine(item: ReadinessItem): string {
  const d = item.detail;
  switch (item.id) {
    case 'byline':
      return 'No author name found.';
    case 'dates':
      return d.startsWith('Found a date') ? 'A date could not be read.' : 'No date found.';
    case 'structured-data':
      if (d.startsWith('No JSON-LD')) return 'No schema found.';
      return d.includes('could not be read')
        ? 'Schema could not be read.'
        : 'Schema names no type.';
    case 'indexing-directives':
      return item.status === 'fail'
        ? 'A tag keeps it out of search.'
        : 'A tag limits how search uses it.';
    case 'canonical':
      if (d.startsWith('No ')) return 'No main URL set.';
      return d.includes('different canonical')
        ? 'More than one main URL.'
        : 'Main URL is not a full address.';
    default:
      return d;
  }
}

/** The row's short line, and the engine's longer finding when it is not a pass. */
function pageResult(item: ReadinessItem): Pick<SiteRow, 'result' | 'detail'> {
  if (item.status !== 'pass') return { result: issueLine(item), detail: item.detail };
  return { result: passLine(item) };
}

/** Engine details for a pass, shortened where a shorter plain line says the same. */
function passLine(item: ReadinessItem): string {
  if (item.id === 'byline') {
    const name = /\(([^)]+)\)/.exec(item.detail)?.[1];
    return name ? `Found: ${name}` : item.detail;
  }
  if (item.id === 'structured-data') {
    const types = /^JSON-LD types: ([^.]+)\./.exec(item.detail)?.[1];
    return types ? `Found: ${types}.` : item.detail;
  }
  if (item.id === 'indexing-directives') return 'Nothing in the page blocks search.';
  return item.detail;
}

function crawlerRow(
  robotsTxt: string,
  url: string | undefined,
): Pick<SiteRow, 'status' | 'result' | 'detail'> {
  const verdicts = crawlerVerdicts(robotsTxt, url ?? HOME);
  const { status } = crawlerAccessStatus(verdicts);
  const blocked = verdicts.filter((v) => !v.allowed);
  const training = blocked.filter((v) => v.purpose === 'training');
  const result =
    status === 'pass'
      ? `All ${verdicts.length} AI crawlers may fetch it.`
      : status === 'warn'
        ? `Training crawlers blocked: ${names(training)}. AI search can still fetch it.`
        : `Blocked: ${names(blocked.filter((v) => v.purpose !== 'training'))}.`;
  return url === undefined
    ? { status, result, detail: 'Checked for the home page: the HTML has no canonical URL.' }
    : { status, result };
}

/**
 * The seven /site rows for pasted HTML and an optional robots.txt. Five rows read the HTML with
 * the engine; crawler access uses the bench's robots check (the same verdicts as `ce site`) on
 * the canonical URL; rendering uses the engine's view-source word count. Needs non-empty HTML.
 */
export function checkPastedSite(input: { html: string; robotsTxt?: string }): SiteCheck {
  const robotsTxt = input.robotsTxt?.trim() ? input.robotsTxt : undefined;
  const items = new Map(analyzeReadiness({ html: input.html }).items.map((i) => [i.id, i]));
  const item = (id: ReadinessId) => items.get(id) as ReadinessItem;
  const url = pageUrl(item('canonical'));
  const render = rendersWithoutJs(input.html);

  const rows = ROWS.map((r): SiteRow => {
    const { evidence } = item(r.id);
    const base = { ...r, evidence };
    if (r.id === 'crawler-access') {
      return robotsTxt === undefined
        ? { ...base, status: 'live', result: 'Needs your live site, or paste robots.txt above.' }
        : { ...base, ...crawlerRow(robotsTxt, url) };
    }
    if (r.id === 'renders-without-js') {
      const result = `${plural(render.words, 'word loads', 'words load')} without JavaScript.`;
      return { ...base, status: render.status, result };
    }
    const status = item(r.id).status;
    // Every page-level item is judged once there is HTML; 'unknown' cannot occur here.
    return {
      ...base,
      status: status === 'unknown' ? 'live' : status,
      ...pageResult(item(r.id)),
    };
  });

  const liveOnly = [HEADER_LIVE, ...(robotsTxt === undefined ? [CRAWLERS_LIVE] : [])];
  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  return {
    rows,
    liveOnly,
    summary: {
      pass: count('pass'),
      warn: count('warn'),
      fail: count('fail'),
      total: rows.length,
      needsLiveSite: liveOnly.length,
    },
  };
}

/** "5 of 7 pass, 1 warning, 1 to fix": only a pass counts as passing. */
export function siteSummaryLine(s: Pick<SiteCounts, 'pass' | 'warn' | 'fail' | 'total'>): string {
  const parts = [`${s.pass} of ${s.total} pass`];
  if (s.warn > 0) parts.push(plural(s.warn, 'warning', 'warnings'));
  if (s.fail > 0) parts.push(`${s.fail} to fix`);
  return parts.join(', ');
}

/** "2 checks need your live site". */
export function liveSiteLine(s: Pick<SiteCounts, 'needsLiveSite'>): string {
  return `${plural(s.needsLiveSite, 'check needs', 'checks need')} your live site`;
}
