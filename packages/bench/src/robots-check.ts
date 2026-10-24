// Browser-safe: the AI-crawler verdicts and the crawler-access grade, shared by `ce site`
// (src/node/site.ts) and the workspace's /site view, so both give the same verdicts on the
// same robots.txt. robots-parser (MIT, samclarke/robots-parser 3.0.1) is plain JavaScript that
// needs only the global URL, so it bundles for the browser; fetching robots.txt stays in
// src/node/robots.ts. The lint guard in biome.json lists robots-parser as Node-only; this one
// import is the reviewed exception, so the guard still stops it anywhere else in the root.
// biome-ignore lint/style/noRestrictedImports: browser-safe (plain JS, global URL only); see above.
import robotsParser from 'robots-parser';
import { AI_CRAWLERS, type CrawlerInfo } from './crawlers';

export interface CrawlerVerdict extends CrawlerInfo {
  /** Whether robots.txt lets this crawler fetch the checked URL. */
  allowed: boolean;
}

/** The parts of a parsed robots.txt the verdicts read. */
export interface RobotsRules {
  isAllowed(url: string, ua?: string): boolean | undefined;
}

export type CrawlerAccessStatus = { status: 'pass' | 'warn' | 'fail'; detail: string };

/** The verdict for each of AI_CRAWLERS on `url` under parsed rules (`ce site` parses once). */
export function verdictsFromRules(rules: RobotsRules, url: string): CrawlerVerdict[] {
  // A URL from another origin than the rules' reads as undefined: no rule applies, so allowed.
  return AI_CRAWLERS.map((c) => ({ ...c, allowed: rules.isAllowed(url, c.userAgent) !== false }));
}

/**
 * The verdict for each of AI_CRAWLERS on `url` under the text of a robots.txt, read as the
 * robots.txt of `url`'s own origin. `url` must be an absolute http(s) URL.
 */
export function crawlerVerdicts(robotsTxt: string, url: string): CrawlerVerdict[] {
  const robotsUrl = new URL('/robots.txt', url).href;
  return verdictsFromRules(robotsParser(robotsUrl, robotsTxt), url);
}

const label = (c: CrawlerVerdict) => `${c.userAgent} (${c.operator}, ${c.purpose})`;

/**
 * The crawler-access grade from a readable robots.txt: a blocked AI search,
 * user-fetch or search-engine crawler (Googlebot, Bingbot, Applebot) fails; otherwise a blocked
 * training crawler warns; anything else passes. A page Googlebot may not fetch is out of Google
 * Search, and so out of AI Overviews and AI Mode too.
 */
export function crawlerAccessStatus(verdicts: CrawlerVerdict[]): CrawlerAccessStatus {
  const blocked = verdicts.filter((c) => !c.allowed);
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
    detail: `robots.txt allows all ${verdicts.length} AI crawlers checked to fetch this URL.`,
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
