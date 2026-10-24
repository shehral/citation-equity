import rehypeParse from 'rehype-parse';
import { unified } from 'unified';
import { hostOf } from './offpage';
import type { Evidence, SourceRef } from './types';

// Site readiness: facts about the published page and site, not the draft. It is reported on its
// own and is never part of any GEO Score. Browser-safe: HTML is parsed with rehype (no DOM), and
// nothing is fetched here; the crawler and rendering items need `ce site <url>`.

/** Said wherever readiness is shown (CLI, workspace): it never feeds a GEO Score. */
export const READINESS_NOTE = 'Site readiness is reported separately from the GEO Score.';

export type ReadinessStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export const READINESS_IDS = [
  'byline',
  'dates',
  'structured-data',
  'indexing-directives',
  'canonical',
  'crawler-access',
  'renders-without-js',
] as const;
export type ReadinessId = (typeof READINESS_IDS)[number];
export interface ReadinessItem {
  id: ReadinessId;
  title: string;
  status: ReadinessStatus;
  detail: string;
  evidence: Evidence;
}
export interface ReadinessResult {
  schemaVersion: 1;
  items: ReadinessItem[];
}
export interface ReadinessInput {
  /** The page's raw HTML, as served (before any JavaScript runs). */
  html?: string;
  /** Front matter of the source draft, already parsed (YAML dates may arrive as Date objects). */
  frontMatter?: Record<string, unknown>;
  /** The page's X-Robots-Tag response header, when it was fetched. */
  xRobotsTag?: string;
}

export const READINESS_TITLES: Record<ReadinessId, string> = {
  byline: 'Byline',
  dates: 'Publication dates',
  'structured-data': 'Structured data',
  'indexing-directives': 'Indexing directives',
  canonical: 'Canonical URL',
  'crawler-access': 'AI crawler access',
  'renders-without-js': 'Renders without JavaScript',
};

// ---------- evidence ----------

// Evidence review of 2026-10-23. Every page below was opened and read that day. Operator
// documentation counts as evidence here: it says what a crawler or answer engine itself does.
// Grades: strong, moderate, mixed, untested; the rules are in docs/evidence.md, "Site readiness".

type Work = Omit<SourceRef, 'claim'>;
const WORKS = {
  openaiBots: {
    id: 'openai-crawlers',
    citation: 'OpenAI. Overview of OpenAI Crawlers (developer documentation). Read 2026-10-23.',
    url: 'https://developers.openai.com/api/docs/bots',
  },
  anthropicBots: {
    id: 'anthropic-crawlers',
    citation:
      'Anthropic. Does Anthropic crawl data from the web, and how can site owners block the crawler? (Claude Help Center). Read 2026-10-23.',
    url: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler',
  },
  perplexityBots: {
    id: 'perplexity-crawlers',
    citation: 'Perplexity. Perplexity Crawlers (documentation). Read 2026-10-23.',
    url: 'https://docs.perplexity.ai/guides/bots',
  },
  googleAiFeatures: {
    id: 'google-ai-features',
    citation: 'Google Search Central. AI features and your website. Read 2026-10-23.',
    url: 'https://developers.google.com/search/docs/appearance/ai-features',
  },
  googleJs: {
    id: 'google-javascript-seo',
    citation: 'Google Search Central. Understand the JavaScript SEO basics. Read 2026-10-23.',
    url: 'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics',
  },
  googleHelpful: {
    id: 'google-helpful-content',
    citation:
      'Google Search Central. Creating helpful, reliable, people-first content. Read 2026-10-23.',
    url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
  },
  googleCanonical: {
    id: 'google-canonical',
    citation:
      'Google Search Central. How to specify a canonical URL with rel="canonical" and other methods. Read 2026-10-23.',
    url: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  },
  bingChat: {
    id: 'bing-chat-controls-2023',
    citation:
      'Bing Webmaster Blog (2023). Announcing new options for webmasters to control usage of their content in Bing Chat.',
    url: 'https://blogs.bing.com/webmaster/september-2023/Announcing-new-options-for-webmasters-to-control-usage-of-their-content-in-Bing-Chat',
  },
  vercel2024: {
    id: 'vercel-2024-ai-crawler',
    citation:
      'Zecchini, G., Moore, A. A., Ubl, M., & Siddle, R. (2024). The rise of the AI crawler. Vercel blog, 17 December 2024.',
    url: 'https://vercel.com/blog/the-rise-of-the-ai-crawler',
  },
  fang2025: {
    id: 'fang-2025-recency-bias',
    citation:
      'Fang, H., Tao, S., Chen, N., Chang, K.-X., & Sakai, T. (2025). Do Large Language Models Favor Recent Content? A Study on Recency Bias in LLM-Based Reranking. arXiv:2509.11353 (preprint).',
    url: 'https://arxiv.org/abs/2509.11353',
  },
  ahrefs2026: {
    id: 'ahrefs-2026-schema',
    citation:
      'Linehan, L., & Guan, X. (2026). We Tracked 1,885 Pages Adding Schema. AI Citations Barely Moved. Ahrefs blog, 11 May 2026.',
    url: 'https://ahrefs.com/blog/schema-ai-citations/',
  },
  googleOrganization: {
    id: 'google-organization-structured-data',
    citation:
      'Google Search Central. Organization (Organization) structured data. Read 2026-10-23.',
    url: 'https://developers.google.com/search/docs/appearance/structured-data/organization',
  },
} satisfies Record<string, Work>;
const cite = (work: Work, claim: string): SourceRef => ({ ...work, claim });

/** Evidence behind each readiness item, keyed in READINESS_IDS order. */
export const READINESS_EVIDENCE: Record<ReadinessId, Evidence> = {
  byline: {
    grade: 'untested',
    summary:
      'No study we opened tests whether a byline changes how AI answer engines use or cite a page. Google asks publishers to make clear who created a page, with a byline where readers expect one, but says this is about trust and is not itself a ranking factor.',
    sources: [
      cite(
        WORKS.googleHelpful,
        'Asks "Do pages carry a byline, where one might be expected?" and encourages "adding accurate authorship information, such as bylines"; it also says E-E-A-T "itself isn\'t a specific ranking factor". Guidance for Google Search, not a test of AI citation.',
      ),
    ],
  },
  dates: {
    grade: 'mixed',
    summary:
      'A controlled study found that the date a passage states changes how language-model rerankers order it: newer dates moved up and older ones moved down. A date can therefore help a fresh page and hurt an old one, so keep the published and updated dates accurate rather than adding dates for their own sake.',
    sources: [
      cite(
        WORKS.fang2025,
        'Artificial publication dates were added to TREC Deep Learning 2021 and 2022 passages and seven LLM rerankers were tested: newer passages ranked consistently higher (top-10 mean year up by as much as 4.78 years) and preferences between equally relevant passages reversed up to 25% of the time. The dates were in the passage text, not in page metadata. Preprint.',
      ),
    ],
  },
  'structured-data': {
    grade: 'mixed',
    summary:
      'Google says no special schema.org markup is needed to appear in its AI features, and a matched study of pages that added JSON-LD found no meaningful rise in AI citations. Structured data can still describe the page accurately for search engines; keep it matching the visible text. The detail also notes, for information, whether sameAs links the author or organization to their profiles elsewhere: Google documents sameAs for that, and no source we opened tests it for AI citation.',
    sources: [
      cite(
        WORKS.googleAiFeatures,
        '"There\'s also no special schema.org structured data that you need to add" to appear in AI Overviews or AI Mode; the page lists "Making sure your structured data matches the visible text on the page" as a best practice.',
      ),
      cite(
        WORKS.ahrefs2026,
        '1,885 already-cited pages that added JSON-LD, compared with matched controls (difference in differences, 30 days before and after): AI Overview citations changed by -4.6%, AI Mode by +2.4% and ChatGPT by +2.2%, the last two not distinguishable from zero. Industry study; schema types were pooled.',
      ),
      cite(
        WORKS.googleOrganization,
        'sameAs is "The URL of a page on another website with additional information about your organization", "for example, a URL to your organization\'s profile page on a social media or review site". The page does not tie sameAs to ranking or AI features.',
      ),
    ],
  },
  'indexing-directives': {
    grade: 'strong',
    summary:
      'Google and Bing both document that indexing directives decide whether a page can appear in their AI answers: Google needs a page to be indexed and eligible for a snippet, so noindex, nosnippet and max-snippet:0 keep it out, and Bing keeps pages marked NOARCHIVE out of its chat answers.',
    sources: [
      cite(
        WORKS.googleAiFeatures,
        'A page "must be indexed and eligible to be shown in Google Search with a snippet" to appear as a supporting link in AI features, and nosnippet, data-nosnippet, max-snippet and noindex limit what is shown.',
      ),
      cite(
        WORKS.bingChat,
        '"Content tagged NOARCHIVE will not be included in Bing Chat answers"; with NOCACHE, only the URL, snippet and title are shown.',
      ),
    ],
  },
  canonical: {
    grade: 'untested',
    summary:
      'No study we opened tests whether a canonical URL changes AI citation. For search engines it tells which of several duplicate URLs to show and where to consolidate signals, which matters most when the same article lives at more than one address.',
    sources: [
      cite(
        WORKS.googleCanonical,
        'rel="canonical" is "a strong signal that the specified URL should become canonical"; reasons given include choosing the URL people see in search results and consolidating signals for duplicate pages. Guidance for Google Search, not a test of AI citation.',
      ),
    ],
  },
  'crawler-access': {
    grade: 'strong',
    summary:
      "The answer engines' own documentation says a page their search crawler may not fetch is left out of their answers: OpenAI, Anthropic and Perplexity each name a search crawler, and Google asks that robots.txt allow crawling. Blocking a training crawler such as GPTBot or Google-Extended does not, by their accounts, remove a page from search answers.",
    sources: [
      cite(
        WORKS.openaiBots,
        '"Sites that are opted out of OAI-SearchBot will not be shown in ChatGPT search answers"; GPTBot is for training, and for ChatGPT-User "robots.txt rules may not apply" because a user asked for the page.',
      ),
      cite(
        WORKS.anthropicBots,
        'Disabling Claude-SearchBot "may reduce your site\'s visibility and accuracy in user search results"; ClaudeBot is for training; Anthropic says its bots honor robots.txt.',
      ),
      cite(
        WORKS.perplexityBots,
        'PerplexityBot is "designed to surface and link websites in search results on Perplexity" and is not used for training; Perplexity-User "generally ignores robots.txt rules" because a user requested the fetch.',
      ),
      cite(
        WORKS.googleAiFeatures,
        'Lists "Ensuring that crawling is allowed in robots.txt, and by any CDN or hosting infrastructure" among the practices for AI features.',
      ),
    ],
  },
  'renders-without-js': {
    grade: 'moderate',
    summary:
      'A large measurement of crawler traffic found that the AI crawlers of OpenAI, Anthropic and Perplexity fetch pages without running JavaScript, so text that only appears after scripts run is invisible to them. Google renders JavaScript for Search and Gemini but still recommends server-side rendering because not all bots run it.',
    sources: [
      cite(
        WORKS.vercel2024,
        'From traffic on Vercel\'s network: "none of the major AI crawlers currently render JavaScript" (GPTBot, ClaudeBot and PerplexityBot fetch script files without running them), while AppleBot and Googlebot, which Gemini uses, render it. A measurement of crawler behaviour, not of citations.',
      ),
      cite(
        WORKS.googleJs,
        'Googlebot renders pages with headless Chromium, yet "server-side or pre-rendering is still a great idea" because "not all bots can run JavaScript".',
      ),
    ],
  },
};

// ---------- HTML facts ----------

const htmlParser = unified().use(rehypeParse).freeze();
type HastRoot = ReturnType<typeof htmlParser.parse>;
type HastNode = HastRoot | HastRoot['children'][number];
type HastElement = Extract<HastNode, { type: 'element' }>;

/** Everything the page-level items read from the HTML, gathered in one walk. */
interface PageFacts {
  /** `<meta name>` (lowercased) to each content value. */
  metaByName: Map<string, string[]>;
  /** `<meta property>` (lowercased) to each content value. */
  metaByProperty: Map<string, string[]>;
  canonicals: string[];
  /** Author names from rel=author, itemprop=author and byline/author class elements. */
  markupAuthors: string[];
  /** Dates from `<time datetime>` and itemprop datePublished / dateModified. */
  markupDates: string[];
  jsonLd: string[];
}

function walk(node: HastNode, visit: (el: HastElement) => void): void {
  if (node.type === 'element') visit(node);
  if ('children' in node) for (const child of node.children) walk(child, visit);
  // <template> content lives outside children in hast.
  if (node.type === 'element' && node.content) walk(node.content, visit);
}

/** Text content, with a space between elements so "<h4>Ana</h4><p>Bio</p>" reads "Ana Bio". */
function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value;
  if ('children' in node) return node.children.map(textOf).join(node.type === 'root' ? '' : ' ');
  return '';
}

/** An author element can hold a whole bio box; the detail shows a name-sized excerpt. */
const MAX_NAME = 60;
function excerpt(text: string): string {
  if (text.length <= MAX_NAME) return text;
  const cut = text.slice(0, MAX_NAME);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/** A hast property as a list of lowercased tokens (rel, class and itemprop are space-separated). */
function tokens(el: HastElement, name: string): string[] {
  const v = el.properties[name];
  if (Array.isArray(v)) return v.map((x) => String(x).toLowerCase());
  if (typeof v === 'string') return v.toLowerCase().split(/\s+/).filter(Boolean);
  return [];
}

function prop(el: HastElement, name: string): string | undefined {
  const v = el.properties[name];
  return typeof v === 'string' ? v : undefined;
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function pageFacts(html: string): PageFacts {
  const facts: PageFacts = {
    metaByName: new Map(),
    metaByProperty: new Map(),
    canonicals: [],
    markupAuthors: [],
    markupDates: [],
    jsonLd: [],
  };
  walk(htmlParser.parse(html), (el) => {
    const itemprop = tokens(el, 'itemProp');
    if (el.tagName === 'meta') {
      const content = prop(el, 'content');
      if (content === undefined) return;
      const name = prop(el, 'name');
      const property = prop(el, 'property');
      if (name) push(facts.metaByName, name.toLowerCase(), content);
      if (property) push(facts.metaByProperty, property.toLowerCase(), content);
      if (itemprop.includes('author')) facts.markupAuthors.push(content);
      if (itemprop.includes('datepublished') || itemprop.includes('datemodified')) {
        facts.markupDates.push(content);
      }
      return;
    }
    if (el.tagName === 'link' && tokens(el, 'rel').includes('canonical')) {
      const href = prop(el, 'href');
      if (href !== undefined) facts.canonicals.push(href.trim());
    }
    if (el.tagName === 'script') {
      if (prop(el, 'type')?.trim().toLowerCase() === 'application/ld+json') {
        facts.jsonLd.push(textOf(el));
      }
      return;
    }
    const isAuthor =
      (el.tagName !== 'link' && tokens(el, 'rel').includes('author')) ||
      itemprop.includes('author') ||
      tokens(el, 'className').some((c) => c === 'byline' || c === 'author' || c === 'p-author');
    if (isAuthor) {
      const name = excerpt(clean(textOf(el)).replace(/^by\s+/i, ''));
      if (name !== '') facts.markupAuthors.push(name);
    }
    if (el.tagName === 'time') {
      const datetime = prop(el, 'dateTime');
      if (datetime) facts.markupDates.push(datetime);
    }
    if (
      el.tagName !== 'time' &&
      (itemprop.includes('datepublished') || itemprop.includes('datemodified'))
    ) {
      facts.markupDates.push(clean(textOf(el)));
    }
  });
  return facts;
}

// ---------- JSON-LD ----------

interface JsonLdFacts {
  blocks: number;
  /** Blocks that are not valid JSON. */
  unreadable: number;
  types: string[];
  authors: string[];
  published: string[];
  modified: string[];
  /** sameAs URLs of Person and Organization nodes, and of author/publisher/creator objects. */
  profiles: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

/** Top-level JSON-LD nodes: the object itself, each array item, and each @graph item. */
function jsonLdNodes(value: unknown): Record<string, unknown>[] {
  return asList(value).flatMap((v) => {
    if (!isRecord(v)) return [];
    return [v, ...asList(v['@graph']).filter(isRecord)];
  });
}

function personNames(value: unknown): string[] {
  return asList(value).flatMap((a) => {
    if (typeof a === 'string') return [clean(a)];
    if (isRecord(a) && typeof a.name === 'string') return [clean(a.name)];
    return [];
  });
}

/**
 * Types whose sameAs links are the owner's own profiles: a person, an organization, and the
 * common Organization and LocalBusiness subtypes (schema.org type names). Any other type, such
 * as an article, a blog, a job posting, an app, a service, a place or a brand, is not read as a
 * profile owner, since its sameAs points at the thing it describes.
 */
// biome-ignore format: one list
const PROFILE_TYPES = new Set([
  'Person', 'Organization', 'Corporation', 'NGO', 'Airline', 'Consortium', 'FundingScheme',
  'EducationalOrganization', 'CollegeOrUniversity', 'ElementarySchool', 'HighSchool',
  'MiddleSchool', 'Preschool', 'School', 'GovernmentOrganization', 'LibrarySystem',
  'MedicalOrganization', 'NewsMediaOrganization', 'OnlineBusiness', 'PerformingGroup',
  'DanceGroup', 'MusicGroup', 'TheaterGroup', 'PoliticalParty', 'ResearchOrganization',
  'SportsOrganization', 'SportsTeam', 'WorkersUnion', 'LocalBusiness', 'AnimalShelter',
  'ChildCare', 'Dentist', 'DryCleaningOrLaundry', 'EmergencyService', 'FinancialService',
  'AccountingService', 'BankOrCreditUnion', 'FoodEstablishment', 'Bakery', 'BarOrPub',
  'Brewery', 'Distillery', 'Winery', 'GovernmentOffice', 'InternetCafe', 'LegalService',
  'Attorney', 'Notary', 'Library', 'LodgingBusiness', 'Hotel', 'Motel', 'Hostel', 'Resort',
  'BedAndBreakfast', 'ProfessionalService', 'RadioStation', 'TelevisionStation',
  'RealEstateAgent', 'RecyclingCenter', 'SelfStorage', 'ShoppingCenter', 'TravelAgency',
  'Physician', 'Pharmacy', 'Hospital', 'Optician', 'Electrician', 'Plumber', 'Locksmith',
  'HousePainter', 'MovingCompany', 'AutoRepair', 'AutoDealer', 'GasStation', 'DaySpa',
  'HealthClub', 'ExerciseGym', 'NightClub', 'MovieTheater', 'ArtGallery', 'TattooParlor',
]);
/** Endings of the many other business subtypes: BookStore, BikeShop, HairSalon, RoofingContractor. */
const BUSINESS_SUFFIX =
  /(?:Store|Shop|Restaurant|Business|Agency|Organization|Salon|Clinic|Contractor)$/;
const isProfileType = (t: string) => PROFILE_TYPES.has(t) || BUSINESS_SUFFIX.test(t);
const sameAsOf = (node: Record<string, unknown>) =>
  asList(node.sameAs).filter((u): u is string => typeof u === 'string');

function readJsonLd(blocks: string[]): JsonLdFacts {
  const facts: JsonLdFacts = {
    blocks: blocks.length,
    unreadable: 0,
    types: [],
    authors: [],
    published: [],
    modified: [],
    profiles: [],
  };
  for (const block of blocks) {
    let value: unknown;
    try {
      value = JSON.parse(block);
    } catch {
      facts.unreadable++;
      continue;
    }
    for (const node of jsonLdNodes(value)) {
      const types = asList(node['@type']).filter((t): t is string => typeof t === 'string');
      facts.types.push(...types);
      if (types.some(isProfileType)) facts.profiles.push(...sameAsOf(node));
      for (const key of ['author', 'publisher', 'creator']) {
        for (const who of asList(node[key]))
          if (isRecord(who)) facts.profiles.push(...sameAsOf(who));
      }
      facts.authors.push(...personNames(node.author));
      for (const d of asList(node.datePublished))
        if (typeof d === 'string') facts.published.push(d);
      for (const d of asList(node.dateModified)) if (typeof d === 'string') facts.modified.push(d);
    }
  }
  return facts;
}

// ---------- items ----------

const unique = <T>(xs: T[]) => [...new Set(xs)];
const nonEmpty = (xs: string[]) => unique(xs.map(clean).filter((x) => x !== ''));

/** A date as written, or as an ISO date when it came from YAML as a Date object. */
function dateText(v: unknown): string | undefined {
  if (v instanceof Date)
    return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  if (typeof v === 'string' || typeof v === 'number') return clean(String(v));
  return undefined;
}
const validDate = (s: string) => s !== '' && !Number.isNaN(Date.parse(s));

const FRONT_MATTER_AUTHOR = ['author', 'authors', 'byline', 'creator'];
const FRONT_MATTER_PUBLISHED = ['date', 'published', 'datePublished', 'pubDate', 'publishDate'];
const FRONT_MATTER_MODIFIED = ['updated', 'lastmod', 'lastModified', 'dateModified', 'modified'];

const SEE_CE_SITE =
  'needs a fetch of the live site, which the browser cannot do. Run ce site <url> from a copy of the repository.';

/** Names a list in prose: "A", "A and B", "A, B and C". */
function list(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

type ItemState = Pick<ReadinessItem, 'status' | 'detail'>;

function byline(
  facts: PageFacts | undefined,
  ld: JsonLdFacts | undefined,
  fm: Record<string, unknown> | undefined,
): ItemState {
  const found: string[] = [];
  if (ld && ld.authors.length > 0) found.push(`JSON-LD author (${list(nonEmpty(ld.authors))})`);
  if (facts) {
    const meta = nonEmpty(facts.metaByName.get('author') ?? []);
    if (meta.length > 0) found.push(`meta author (${list(meta)})`);
    const markup = nonEmpty(facts.markupAuthors);
    if (markup.length > 0) found.push(`byline markup (${list(markup)})`);
  }
  if (fm) {
    const names = FRONT_MATTER_AUTHOR.flatMap((k) => personNames(fm[k]));
    if (names.length > 0) found.push(`front matter (${list(nonEmpty(names))})`);
  }
  if (found.length > 0) return { status: 'pass', detail: `Author named in ${list(found)}.` };
  const where = facts
    ? 'No author found in JSON-LD, a meta author tag, rel="author" or a byline element'
    : 'The front matter names no author';
  return {
    status: 'warn',
    detail: `${where}. A visible byline in plain text cannot be told apart from other text, so check the page itself.`,
  };
}

function dates(
  facts: PageFacts | undefined,
  ld: JsonLdFacts | undefined,
  fm: Record<string, unknown> | undefined,
): ItemState {
  const published: string[] = [];
  const modified: string[] = [];
  const other: string[] = [];
  if (ld) {
    published.push(...ld.published);
    modified.push(...ld.modified);
  }
  if (facts) {
    published.push(...(facts.metaByProperty.get('article:published_time') ?? []));
    modified.push(...(facts.metaByProperty.get('article:modified_time') ?? []));
    other.push(...facts.markupDates);
  }
  if (fm) {
    for (const k of FRONT_MATTER_PUBLISHED) {
      const d = dateText(fm[k]);
      if (d !== undefined) published.push(d);
    }
    for (const k of FRONT_MATTER_MODIFIED) {
      const d = dateText(fm[k]);
      if (d !== undefined) modified.push(d);
    }
  }
  const all = nonEmpty([...published, ...modified, ...other]);
  if (all.length === 0) {
    return {
      status: 'warn',
      detail: facts
        ? 'No published or updated date found in JSON-LD, article meta tags or <time datetime>.'
        : 'The front matter has no date.',
    };
  }
  const good = (xs: string[]) => nonEmpty(xs).filter(validDate);
  const parts: string[] = [];
  if (good(published).length > 0) parts.push(`published ${list(good(published))}`);
  if (good(modified).length > 0) parts.push(`updated ${list(good(modified))}`);
  if (parts.length === 0 && good(other).length > 0) parts.push(`dated ${list(good(other))}`);
  if (parts.length === 0) {
    return {
      status: 'warn',
      detail: `Found a date that could not be read as a date: ${list(all)}.`,
    };
  }
  const text = parts.join(', ');
  return { status: 'pass', detail: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
}

const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'FAQPage', 'HowTo'];

function structuredData(ld: JsonLdFacts): ItemState {
  if (ld.blocks === 0) {
    return {
      status: 'warn',
      detail: 'No JSON-LD structured data (<script type="application/ld+json">) found.',
    };
  }
  const types = unique(ld.types);
  const profiles = ld.blocks > ld.unreadable ? sameAsNote(ld.profiles) : '';
  const unreadable =
    ld.unreadable > 0
      ? ` ${ld.unreadable} of ${ld.blocks} JSON-LD block${ld.blocks === 1 ? '' : 's'} could not be read as JSON.`
      : '';
  if (types.length === 0) {
    const why =
      ld.unreadable === ld.blocks
        ? ' It could not be read as JSON.'
        : ` It names no @type.${profiles}${unreadable}`;
    return { status: 'warn', detail: `JSON-LD found.${why}` };
  }
  const noted = types.filter((t) => ARTICLE_TYPES.includes(t));
  const note =
    noted.length > 0
      ? ` Article-style types: ${list(noted)}.`
      : ` None of ${list(ARTICLE_TYPES)} is among them.`;
  return {
    status: 'pass',
    detail: `JSON-LD types: ${types.join(', ')}.${note}${profiles}${unreadable}`,
  };
}

/** Informational only: whether sameAs ties the author or organization to profiles elsewhere. */
function sameAsNote(urls: string[]): string {
  const valid = unique(urls.map(clean)).filter((u) => /^https?:\/\//i.test(u) && hostOf(u) !== '');
  if (valid.length === 0) {
    return ' No sameAs link ties the author or organization to their profiles elsewhere (informational).';
  }
  const hosts = unique(valid.map(hostOf));
  const n = valid.length;
  return ` sameAs links the author or organization to ${n} profile${n === 1 ? '' : 's'}: ${hosts.join(', ')}.`;
}

/** Directive names that take a value after a colon, so "max-snippet: 0" is not a user agent. */
const VALUED_DIRECTIVES = [
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
  'unavailable_after',
];
/** Crawlers whose directives reach Google's and Bing's AI answers; no scope means every crawler. */
const ANSWER_CRAWLERS = ['googlebot', 'bingbot'];

interface Directives {
  blocking: string[];
  limiting: string[];
  /** Blocking or limiting directives scoped to another crawler ("otherbot: noindex"). */
  otherCrawlers: string[];
}

/**
 * Directives that keep a page out of AI answers (blocking) or limit how it is used (limiting).
 * An X-Robots-Tag value may scope its directives to one crawler ("googlebot: noindex,
 * nosnippet"). A scope of googlebot, bingbot or every crawler counts; any other scope is
 * reported apart. In a meta tag the scope holds until the next one. In a header (`joined`) it
 * holds only for the directive right after it: fetch joins separate X-Robots-Tag lines with
 * ", ", so "otherbot: nofollow, noindex" may be two lines, the second for every crawler. A
 * later blocking or limiting directive then counts for every crawler, and says so.
 */
function robotsDirectives(content: string, joined = false): Directives {
  const found: Directives = { blocking: [], limiting: [], otherCrawlers: [] };
  let scope: string | undefined;
  let lastScope: string | undefined;
  for (const raw of content.toLowerCase().split(',')) {
    let d = raw.replace(/\s+/g, '');
    const prefix = /^([^:]+):(.*)$/.exec(d);
    let scoped = false;
    if (prefix?.[1] && !VALUED_DIRECTIVES.includes(prefix[1])) {
      scope = prefix[1] === '*' ? undefined : prefix[1];
      lastScope = scope;
      d = prefix[2] ?? '';
      scoped = true;
    }
    const kind =
      d === 'noindex' || d === 'none' || d === 'nosnippet' || d === 'max-snippet:0'
        ? 'blocking'
        : d === 'noarchive' || d === 'nocache'
          ? 'limiting'
          : undefined;
    const ambiguous = joined && !scoped && lastScope !== undefined;
    const applies = joined && !scoped ? undefined : scope;
    if (kind !== undefined) {
      if (ambiguous) {
        found[kind].push(
          `${d} (may be scoped to ${lastScope}; the header lines arrive joined, so it is read as for every crawler)`,
        );
      } else if (applies === undefined) found[kind].push(d);
      else if (ANSWER_CRAWLERS.includes(applies)) found[kind].push(`${applies}: ${d}`);
      else found.otherCrawlers.push(`${applies}: ${d}`);
    }
  }
  return found;
}

/** Meta names whose robots directives an AI answer engine reads (robots plus Google's and Bing's). */
const ROBOTS_META = ['robots', 'googlebot', 'bingbot'];

function indexingDirectives(facts: PageFacts, xRobotsTag: string | undefined): ItemState {
  const blocking: string[] = [];
  const limiting: string[] = [];
  const otherCrawlers: string[] = [];
  const sources: [string, string][] = ROBOTS_META.flatMap((name) =>
    (facts.metaByName.get(name) ?? []).map((c): [string, string] => [`meta ${name}`, c]),
  );
  if (xRobotsTag !== undefined) sources.push(['X-Robots-Tag header', xRobotsTag]);
  for (const [where, content] of sources) {
    const found = robotsDirectives(content, where === 'X-Robots-Tag header');
    if (found.blocking.length > 0) blocking.push(`${where}: ${found.blocking.join(', ')}`);
    if (found.limiting.length > 0) limiting.push(`${where}: ${found.limiting.join(', ')}`);
    if (found.otherCrawlers.length > 0)
      otherCrawlers.push(`${where}: ${found.otherCrawlers.join(', ')}`);
  }
  if (blocking.length > 0) {
    return {
      status: 'fail',
      detail: `${blocking.join('; ')}. These keep the page, or its text, out of search and AI answers.`,
    };
  }
  if (limiting.length > 0 || otherCrawlers.length > 0) {
    const parts: string[] = [];
    if (limiting.length > 0) {
      parts.push(
        `${limiting.join('; ')}. Bing keeps NOARCHIVE pages out of its chat answers and shows only the title, URL and snippet for NOCACHE.`,
      );
    }
    if (otherCrawlers.length > 0) {
      parts.push(
        `${otherCrawlers.join('; ')}. These apply only to the crawler named; check it is not one whose answers you want to appear in.`,
      );
    }
    return { status: 'warn', detail: parts.join(' ') };
  }
  const checked =
    xRobotsTag === undefined ? 'meta robots tags' : 'meta robots tags or the X-Robots-Tag header';
  return { status: 'pass', detail: `No noindex, nosnippet or max-snippet:0 in ${checked}.` };
}

function canonical(facts: PageFacts): ItemState {
  const urls = unique(facts.canonicals.filter((u) => u !== ''));
  if (urls.length === 0) return { status: 'warn', detail: 'No <link rel="canonical"> found.' };
  if (urls.length > 1) {
    return {
      status: 'warn',
      detail: `${urls.length} different canonical URLs: ${urls.join(', ')}. Keep one.`,
    };
  }
  const [url] = urls;
  // The engine has no URL global in its lib (it targets plain ES), so a scheme and host suffice.
  if (!/^https?:\/\/[^\s/?#]+/i.test(url)) {
    return {
      status: 'warn',
      detail: `Canonical "${url}" is not an absolute URL. Use the full https:// address.`,
    };
  }
  return { status: 'pass', detail: `Canonical: ${url}` };
}

/**
 * Page-level readiness from the page's HTML and/or the draft's front matter. Crawler access and
 * rendering are always 'unknown' here: they need a fetch (`checkSite` in the bench, `ce site`).
 */
export function analyzeReadiness(input: ReadinessInput): ReadinessResult {
  const html = input.html !== undefined && input.html.trim() !== '' ? input.html : undefined;
  const fm =
    input.frontMatter && Object.keys(input.frontMatter).length > 0 ? input.frontMatter : undefined;
  const facts = html === undefined ? undefined : pageFacts(html);
  const ld = facts ? readJsonLd(facts.jsonLd) : undefined;

  const noInput: ItemState = {
    status: 'unknown',
    detail: "Nothing to check yet: paste the published page's HTML.",
  };
  const needsHtml: ItemState = {
    status: 'unknown',
    detail: "Needs the published page's HTML; front matter does not say.",
  };
  const htmlItem = (f: () => ItemState): ItemState => (facts ? f() : fm ? needsHtml : noInput);
  const draftItem = (f: () => ItemState): ItemState => (facts || fm ? f() : noInput);

  const parts: Record<ReadinessId, ItemState> = {
    byline: draftItem(() => byline(facts, ld, fm)),
    dates: draftItem(() => dates(facts, ld, fm)),
    'structured-data': htmlItem(() => structuredData(ld as JsonLdFacts)),
    'indexing-directives': htmlItem(() => indexingDirectives(facts as PageFacts, input.xRobotsTag)),
    canonical: htmlItem(() => canonical(facts as PageFacts)),
    'crawler-access': { status: 'unknown', detail: `Crawler access in robots.txt ${SEE_CE_SITE}` },
    'renders-without-js': {
      status: 'unknown',
      detail: `Rendering without JavaScript ${SEE_CE_SITE}`,
    },
  };
  return {
    schemaVersion: 1,
    items: READINESS_IDS.map((id) => ({
      id,
      title: READINESS_TITLES[id],
      ...parts[id],
      evidence: READINESS_EVIDENCE[id],
    })),
  };
}
