// Browser-safe data: the AI crawlers `ce site` checks in robots.txt. It lives in the root entry,
// not under src/node, so the workspace's /site page can list the same crawlers it describes.
//
// Each token, operator and purpose was checked on 2026-10-23 against the operator's own
// documentation page, which is the docsUrl. Bing's page builds its text with JavaScript, so
// Bingbot was checked through a search engine's copy of that page (docs/evidence.md). A crawler
// we could not verify is not listed.

/** What blocking the crawler affects, in the operator's own description. */
export type CrawlerPurpose = 'training' | 'search' | 'user-fetch' | 'search-engine';

export interface CrawlerInfo {
  /** The robots.txt user-agent token. */
  userAgent: string;
  operator: string;
  /**
   * training: collects pages for model training. search: indexes pages for an AI answer
   * engine's search. user-fetch: fetches a page when a user asks about it. search-engine: a web
   * search crawler whose index also feeds that company's AI answers.
   */
  purpose: CrawlerPurpose;
  docsUrl: string;
}

const OPENAI = 'https://developers.openai.com/api/docs/bots';
const ANTHROPIC =
  'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler';
const PERPLEXITY = 'https://docs.perplexity.ai/guides/bots';
const GOOGLE = 'https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers';
const BING = 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0';
const APPLE = 'https://support.apple.com/en-us/119829';
const COMMON_CRAWL = 'https://commoncrawl.org/ccbot';

export const AI_CRAWLERS: readonly CrawlerInfo[] = [
  { userAgent: 'GPTBot', operator: 'OpenAI', purpose: 'training', docsUrl: OPENAI },
  { userAgent: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'search', docsUrl: OPENAI },
  { userAgent: 'ChatGPT-User', operator: 'OpenAI', purpose: 'user-fetch', docsUrl: OPENAI },
  { userAgent: 'ClaudeBot', operator: 'Anthropic', purpose: 'training', docsUrl: ANTHROPIC },
  { userAgent: 'Claude-SearchBot', operator: 'Anthropic', purpose: 'search', docsUrl: ANTHROPIC },
  { userAgent: 'Claude-User', operator: 'Anthropic', purpose: 'user-fetch', docsUrl: ANTHROPIC },
  { userAgent: 'PerplexityBot', operator: 'Perplexity', purpose: 'search', docsUrl: PERPLEXITY },
  {
    userAgent: 'Perplexity-User',
    operator: 'Perplexity',
    purpose: 'user-fetch',
    docsUrl: PERPLEXITY,
  },
  { userAgent: 'Googlebot', operator: 'Google', purpose: 'search-engine', docsUrl: GOOGLE },
  // A robots.txt token only (no separate HTTP user agent): Gemini training, and grounding in
  // Gemini Apps; Google says it does not affect Search. Classed training, worded in ce site.
  { userAgent: 'Google-Extended', operator: 'Google', purpose: 'training', docsUrl: GOOGLE },
  { userAgent: 'Bingbot', operator: 'Microsoft', purpose: 'search-engine', docsUrl: BING },
  { userAgent: 'Applebot', operator: 'Apple', purpose: 'search-engine', docsUrl: APPLE },
  // A robots.txt token only: Apple says it does not crawl and does not affect search.
  { userAgent: 'Applebot-Extended', operator: 'Apple', purpose: 'training', docsUrl: APPLE },
  { userAgent: 'CCBot', operator: 'Common Crawl', purpose: 'training', docsUrl: COMMON_CRAWL },
];
