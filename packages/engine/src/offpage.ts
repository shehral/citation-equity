// Off-page guidance: which kinds of sites AI answers cite for the author's own questions, and what
// an author can do about each kind honestly. Pure TS, browser-safe: answers are parsed locally and
// nothing here makes a request. The tool never posts, contacts anyone or writes reviews.
import type { Evidence, SourceRef } from './types';

/** Shown with every off-page report (CLI text and the workspace page). */
export const OFFPAGE_NOTE =
  'Counted from the answers you gave. Engines answer differently each time and change over time, so a few answers are a small sample. This tool never posts, contacts anyone or writes reviews.';

export const SOURCE_KINDS = [
  'forum',
  'wiki',
  'video',
  'reviews',
  'news',
  'reference',
  'social',
  'commerce',
  'blog-or-other',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface CitedDomain {
  /** Lowercased host without a leading `www.`. */
  domain: string;
  kind: SourceKind;
  /** Answers that cite this domain at least once. */
  citations: number;
  /** The questions those answers were for, each once, in first-seen order. */
  questions: string[];
}

export interface OffPageAdvice {
  kind: SourceKind;
  title: string;
  /** What an author can do. */
  advice: string;
  /** The ethical line: what not to do, with the platform rule or law behind it. */
  avoid: string;
  evidence: Evidence;
}

// ---------- domains ----------

/**
 * Lowercased host without a leading `www.`, from a URL or a bare host name; '' for anything else
 * (a title such as "Espresso guide", an empty string).
 */
export function hostOf(urlOrHost: string): string {
  const value = urlOrHost.trim();
  if (value === '' || /\s/.test(value)) return '';
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).hostname;
  } catch {
    return '';
  }
  if (!host.includes('.')) return '';
  return host.toLowerCase().replace(/^www\./, '');
}

/** `host` is `domain` or one of its subdomains (whole labels only). */
const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * The documented domain list behind `classifyDomain`. A host matches an entry when it is that
 * domain or a subdomain of it. The list is small on purpose: it names the sites the citation
 * studies in docs/evidence.md report, plus their close peers; everything else is 'blog-or-other'.
 */
const KNOWN_DOMAINS: Record<Exclude<SourceKind, 'blog-or-other'>, readonly string[]> = {
  forum: [
    'reddit.com',
    'quora.com',
    'stackexchange.com',
    'stackoverflow.com',
    'superuser.com',
    'serverfault.com',
    'askubuntu.com',
    'mathoverflow.net',
    'news.ycombinator.com',
  ],
  wiki: [
    'wikipedia.org',
    'wikimedia.org',
    'wiktionary.org',
    'wikidata.org',
    'wikihow.com',
    'fandom.com',
  ],
  video: ['youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 'twitch.tv'],
  reviews: [
    'g2.com',
    'capterra.com',
    'trustradius.com',
    'trustpilot.com',
    'yelp.com',
    'tripadvisor.com',
    'glassdoor.com',
  ],
  news: [
    'reuters.com',
    'apnews.com',
    'bbc.com',
    'bbc.co.uk',
    'nytimes.com',
    'nypost.com',
    'washingtonpost.com',
    'wsj.com',
    'theguardian.com',
    'cnn.com',
    'cnbc.com',
    'npr.org',
    'bloomberg.com',
    'forbes.com',
    'businessinsider.com',
    'techradar.com',
    'pcmag.com',
    'theverge.com',
    'wired.com',
    'nerdwallet.com',
  ],
  reference: [
    'britannica.com',
    'merriam-webster.com',
    'dictionary.cambridge.org',
    'nih.gov',
    'cdc.gov',
    'who.int',
    'mayoclinic.org',
    'clevelandclinic.org',
    'webmd.com',
    'investopedia.com',
  ],
  social: [
    'linkedin.com',
    'facebook.com',
    'instagram.com',
    'x.com',
    'twitter.com',
    'threads.net',
    'pinterest.com',
    'bsky.app',
  ],
  commerce: [
    'amazon.com',
    'amazon.co.uk',
    'amazon.ca',
    'amazon.de',
    'amazon.in',
    'ebay.com',
    'etsy.com',
    'walmart.com',
    'bestbuy.com',
    'target.com',
    'aliexpress.com',
  ],
};

/**
 * The list entry a host belongs to: the longest `KNOWN_DOMAINS` entry it is or sits under
 * ("old.reddit.com" -> "reddit.com", "en.wikipedia.org" -> "wikipedia.org"); else the host.
 */
function siteOf(host: string): string {
  let site = host;
  let length = 0;
  for (const domains of Object.values(KNOWN_DOMAINS))
    for (const d of domains)
      if (d.length > length && within(host, d)) [site, length] = [d, d.length];
  return site;
}

/** Government and university hosts count as reference sites. */
const REFERENCE_SUFFIXES = ['gov', 'edu', 'mil', 'gov.uk'];

/**
 * The kind of site a domain (or URL) is, from `KNOWN_DOMAINS`, with `.gov`, `.edu`, `.mil` and
 * `gov.uk` hosts as reference sites; anything else, or text that is not a host, is 'blog-or-other'.
 */
export function classifyDomain(domain: string): SourceKind {
  const host = hostOf(domain);
  if (host === '') return 'blog-or-other';
  for (const [kind, domains] of Object.entries(KNOWN_DOMAINS)) {
    if (domains.some((d) => within(host, d))) return kind as SourceKind;
  }
  if (REFERENCE_SUFFIXES.some((s) => host.endsWith(`.${s}`))) return 'reference';
  return 'blog-or-other';
}

/**
 * Tallies the domains cited across answers. Each input is one answer: the question it was for and
 * the URLs (or bare host names) it cites. A domain counts once per answer, however often that
 * answer links it. Domains are the host without `www.`; a subdomain of a site on the known list
 * folds into that site ("old.reddit.com" counts as "reddit.com"), while other subdomains stay
 * apart, except for the author's own: `ownDomain` (a host or URL) also matches its `www.` form
 * and every subdomain, and those answers are counted in `ownCitations` and left out of
 * `domains`. Sorted by citations, then by domain.
 */
export function tallyCitedSources(
  input: { question: string; urls: string[] }[],
  ownDomain?: string,
): { domains: CitedDomain[]; ownCitations: number } {
  const own = ownDomain === undefined ? '' : hostOf(ownDomain);
  const byDomain = new Map<string, CitedDomain>();
  let ownCitations = 0;
  for (const { question, urls } of input) {
    const hosts = new Set(
      urls
        .map(hostOf)
        .filter((h) => h !== '')
        .map((h) => (own !== '' && within(h, own) ? h : siteOf(h))),
    );
    let citesOwn = false;
    for (const host of hosts) {
      if (own !== '' && within(host, own)) {
        citesOwn = true;
        continue;
      }
      let entry = byDomain.get(host);
      if (!entry) {
        entry = { domain: host, kind: classifyDomain(host), citations: 0, questions: [] };
        byDomain.set(host, entry);
      }
      entry.citations++;
      if (!entry.questions.includes(question)) entry.questions.push(question);
    }
    if (citesOwn) ownCitations++;
  }
  const domains = [...byDomain.values()].sort(
    (a, b) => b.citations - a.citations || a.domain.localeCompare(b.domain),
  );
  return { domains, ownCitations };
}

/**
 * Cited domains grouped by kind, for reports: the kinds with the most citations first (ties in
 * `SOURCE_KINDS` order), each with its domains in the order given.
 */
export function groupByKind(
  domains: CitedDomain[],
): { kind: SourceKind; citations: number; domains: CitedDomain[] }[] {
  return SOURCE_KINDS.map((kind) => {
    const of = domains.filter((d) => d.kind === kind);
    return { kind, citations: of.reduce((sum, d) => sum + d.citations, 0), domains: of };
  })
    .filter((g) => g.domains.length > 0)
    .sort((a, b) => b.citations - a.citations);
}

// ---------- pasted text ----------

/** Characters that end a sentence or wrap a link rather than belong to the URL. */
const TRAILING = /[.,;:!?*_~'"]$/;

/** Drops trailing punctuation, and a closing bracket that has no opening one inside the URL. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    if (TRAILING.test(url)) {
      url = url.slice(0, -1);
      continue;
    }
    if (url.endsWith(')') && count(url, ')') > count(url, '(')) {
      url = url.slice(0, -1);
      continue;
    }
    return url;
  }
}
const count = (s: string, ch: string) => s.split(ch).length - 1;

/**
 * The http(s) URLs in pasted answer text or a source list, each once, in the order they first
 * appear: bare URLs, Markdown links (`[text](url "title")`), `<url>` and numbered source lists.
 * Trailing punctuation and the closing parenthesis of a link are dropped; a parenthesis that opens
 * inside the URL (Wikipedia's `Espresso_(drink)`) is kept. Runs locally with no request.
 */
export function urlsFromText(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`[\]{}|\\^]+/gi)) {
    const url = trimUrl(match[0]);
    try {
      if (new URL(url).hostname === '') continue;
    } catch {
      continue;
    }
    if (!found.includes(url)) found.push(url);
  }
  return found;
}

// ---------- advice ----------

type Work = Omit<SourceRef, 'claim'>;
const WORKS = {
  profound2025: {
    id: 'profound-2025-citation-patterns',
    citation:
      'Lafferty, N. (2025). AI Platform Citation Patterns: How ChatGPT, Google AI Overviews, and Perplexity Source Information. Profound blog, 5 June 2025 (updated August 2025).',
    url: 'https://www.tryprofound.com/blog/ai-platform-citation-patterns',
  },
  ahrefs2025: {
    id: 'ahrefs-2025-most-mentioned-domains',
    citation:
      'Stox, P. (2025). The 10 Most Mentioned Domains for ChatGPT, Perplexity, and AI Overviews Across 78.6M Searches. Ahrefs blog, 11 June 2025.',
    url: 'https://ahrefs.com/blog/top-10-most-cited-domains-ai-assistants',
  },
  semrush2025: {
    id: 'semrush-2025-most-cited-domains',
    citation:
      'Harsel, L. (2025). The Most-Cited Domains in AI: A 3-Month Study. Semrush blog, 10 November 2025.',
    url: 'https://www.semrush.com/blog/most-cited-domains-ai/',
  },
  wikiCoi: {
    id: 'wikipedia-conflict-of-interest',
    citation: 'Wikipedia. Wikipedia:Conflict of interest (guideline). Read 2026-10-23.',
    url: 'https://en.wikipedia.org/wiki/Wikipedia:Conflict_of_interest',
  },
  wikiNotability: {
    id: 'wikipedia-notability',
    citation: 'Wikipedia. Wikipedia:Notability (guideline). Read 2026-10-23.',
    url: 'https://en.wikipedia.org/wiki/Wikipedia:Notability',
  },
  redditRules: {
    id: 'reddit-rules',
    citation: 'Reddit, Inc. Reddit Rules. Read 2026-10-23.',
    url: 'https://redditinc.com/policies/reddit-rules',
  },
  stackPromotion: {
    id: 'stack-overflow-promotion',
    citation: 'Stack Overflow Help Center. How to not be a spammer. Read 2026-10-23.',
    url: 'https://stackoverflow.com/help/promotion',
  },
  youtubePaid: {
    id: 'youtube-paid-promotion',
    citation:
      'YouTube Help. Add branded content restrictions & disclosure labels. Read 2026-10-23.',
    url: 'https://support.google.com/youtube/answer/154235',
  },
  ftcReviews: {
    id: 'ftc-consumer-reviews-rule',
    citation:
      'US Federal Trade Commission. Consumer Reviews and Testimonials Rule: Questions and Answers. Read 2026-10-23.',
    url: 'https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers',
  },
  ftcEndorsements: {
    id: 'ftc-endorsement-guides',
    citation:
      "US Federal Trade Commission. FTC's Endorsement Guides: What People Are Asking. Read 2026-10-23.",
    url: 'https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking',
  },
  googleSpam: {
    id: 'google-spam-policies',
    citation: 'Google Search Central. Spam policies for Google web search. Read 2026-10-23.',
    url: 'https://developers.google.com/search/docs/essentials/spam-policies',
  },
  googleOrganization: {
    id: 'google-organization-structured-data',
    citation:
      'Google Search Central. Organization (Organization) structured data. Read 2026-10-23.',
    url: 'https://developers.google.com/search/docs/appearance/structured-data/organization',
  },
} satisfies Record<string, Work>;
const cite = (work: Work, claim: string): SourceRef => ({ ...work, claim });

const PROFOUND_TOP10 =
  '680 million citations, August 2024 to June 2025; shares are of each engine\'s ten most cited sources ("Top Source Share") unless said otherwise. Vendor study; collection method and queries not described.';

/** Ahrefs' per-engine top tens by mention share, read from the article's charts (June 2025). */
const AHREFS_TOP10 = {
  chatgpt:
    "ChatGPT's top ten by mention share (chart): wikipedia.org, reuters.com, apple.com, justwatch.com, as.com, amazon.com, apnews.com, google.com, axios.com, uol.com.br.",
  overviews:
    "Google AI Overviews' top ten by mention share (chart): wikipedia.org, youtube.com, reddit.com, quora (spelled quora.org in the chart), translate.google.com, healthline.com, mayoclinic.org, clevelandclinic.org, nih.gov, medicalnewstoday.com.",
  perplexity:
    "Perplexity's top ten by mention share (chart): youtube.com, wikipedia.org, apple.com, google.com, healthline.com, tuasaude.com, justwatch.com, imdb.com (spelled imbd.com in the chart), microsoft.com, instagram.com.",
};

/**
 * What to do, and what not to do, for each kind of cited site. Grades follow the off-page rules
 * in docs/evidence.md: every source is a count of citations, so no card is strong, and no study
 * tests whether taking part on a site gets the author's own page cited.
 */
export const OFFPAGE_ADVICE: Record<SourceKind, OffPageAdvice> = {
  forum: {
    kind: 'forum',
    title: 'Forums and Q&A sites',
    advice:
      'Answer questions in communities you already take part in, in your own words, and link your page only where it answers the question better than a reply can. Say plainly that the page is yours.',
    avoid:
      'No posting the same link across communities, no accounts made to promote, no vote manipulation, and never hide that a page is yours. Reddit asks people to participate authentically where they have a personal interest and not to spam; Stack Exchange requires you to disclose your affiliation whenever you mention your own product or site.',
    evidence: {
      grade: 'mixed',
      summary:
        "Forums are heavily cited, but the studies disagree by engine and over time. Profound found Reddit the top source for Google AI Overviews and Perplexity; Ahrefs found Reddit and Quora high only in AI Overviews; Semrush saw ChatGPT's Reddit citations fall from close to 60% of responses to about 10% in September 2025. No study tests whether posting there gets your own page cited.",
      sources: [
        cite(
          WORKS.profound2025,
          `Reddit is 21.0% of Google AI Overviews' top-ten sources, 46.7% of Perplexity's and 11.3% of ChatGPT's; Quora is 14.3% in AI Overviews. ${PROFOUND_TOP10}`,
        ),
        cite(
          WORKS.ahrefs2025,
          '"Reddit and Quora rank high only in AI Overviews (7.4% & 3.6%)" of mentions; "They don\'t crack the top-10 in ChatGPT or Perplexity." Brand Radar data for June 2025.',
        ),
        cite(
          WORKS.semrush2025,
          'ChatGPT "cited Reddit in close to 60% of prompt responses in early August before collapsing to around 10% by mid-September" 2025; Reddit stayed among its two most cited domains. 230,000+ prompts, weekly, 14 July to 12 October 2025.',
        ),
        cite(
          WORKS.redditRules,
          'Rule 2: "Participate authentically in communities where you have a personal interest, and do not spam or engage in disruptive behaviors (including content manipulation)".',
        ),
        cite(
          WORKS.stackPromotion,
          '"if you mention your product, website, etc. in your question or answer (or any other contribution to the site), you must disclose your affiliation in your post."',
        ),
      ],
    },
  },
  wiki: {
    kind: 'wiki',
    title: 'Wikipedia and other wikis',
    advice:
      "You cannot place yourself here. If independent sources have covered your work, check that what Wikipedia says about it is accurate; to correct it, propose the change with sources on the article's talk page and say how you are connected.",
    avoid:
      'Do not write or edit an article about yourself, your business or your clients. Wikipedia strongly discourages editing with a conflict of interest, expects you to disclose it, and requires paid editors to disclose who pays them. A topic needs significant coverage in reliable sources independent of the subject; your own site, press releases and ads do not count.',
    evidence: {
      grade: 'mixed',
      summary:
        "Wikipedia is among the most cited domains in every study we opened, above all in ChatGPT, but Semrush saw ChatGPT's Wikipedia citations fall from about 55% of responses to under 20% in September 2025, and found it in about 2% of Google AI Mode responses. Whether you appear there is decided by Wikipedia's notability and conflict-of-interest rules, not by you.",
      sources: [
        cite(
          WORKS.profound2025,
          `Wikipedia is 47.9% of ChatGPT's top-ten sources (7.8% of all its citations) and 5.7% of Google AI Overviews'. ${PROFOUND_TOP10}`,
        ),
        cite(
          WORKS.ahrefs2025,
          '"Wikipedia dominates all three, but ChatGPT (16.3%) cites it most, then Perplexity (12.5%), then AI Overviews (8.4%)" of mentions.',
        ),
        cite(
          WORKS.semrush2025,
          'In ChatGPT, Wikipedia went from roughly 55% of responses to under 20% in September 2025; in Google AI Mode it was cited in about 2% of responses and in Perplexity near 0.8%.',
        ),
        cite(
          WORKS.wikiCoi,
          '"COI editors are strongly discouraged from editing affected articles directly" and "are expected to disclose it whenever they seek to change an affected article\'s content"; the terms of use require paid editors to disclose their employer and client.',
        ),
        cite(
          WORKS.wikiNotability,
          'A topic is presumed suitable for an article when it "has received significant coverage in reliable sources that are independent of the subject"; works by the subject, advertising, press releases and autobiographies are not independent.',
        ),
      ],
    },
  },
  video: {
    kind: 'video',
    title: 'Video',
    advice:
      'If a question is easier to show than to tell, a short video that answers it, with a plain title, a description and a link to your page, puts you on a kind of site Google AI Overviews and Perplexity cite often.',
    avoid:
      "Disclose any sponsorship or paid promotion, with YouTube's paid promotion setting and in the video itself. No reuploads of other people's work and no titles that promise what the video does not show.",
    evidence: {
      grade: 'moderate',
      summary:
        "YouTube is among the top sources for Google AI Overviews and Perplexity in Profound's and Ahrefs' data, and Semrush found it second in Google AI Mode. Ahrefs found it missing from ChatGPT's top ten. No study tests whether publishing a video gets your own page cited.",
      sources: [
        cite(
          WORKS.profound2025,
          `YouTube is 18.8% of Google AI Overviews' top-ten sources and 13.9% of Perplexity's; it is not in ChatGPT's top ten. ${PROFOUND_TOP10}`,
        ),
        cite(
          WORKS.ahrefs2025,
          '"YouTube is a clear favorite in Perplexity (16.1%) and AI Overviews (9.5%) but is missing in the top in ChatGPT."',
        ),
        cite(
          WORKS.semrush2025,
          "Google AI Mode's most cited domains: LinkedIn, then YouTube, Reddit, Google and Google Blog.",
        ),
        cite(
          WORKS.youtubePaid,
          'Creators must flag "branded content, sponsorships, endorsements, or other commercial relationships" by "selecting the paid promotion button in your video details", which adds a disclosure label.',
        ),
      ],
    },
  },
  reviews: {
    kind: 'reviews',
    title: 'Review platforms',
    advice:
      'Claim your listing on the review sites your field uses (G2 or Capterra for software, Yelp or Tripadvisor for a local place), keep it accurate, and ask real customers for honest reviews with no strings attached.',
    avoid:
      'No fake reviews, no reviews from people who did not use the product, no paying for positive reviews, no reviews by staff or family without saying so, and no suppressing negative ones. The FTC rule on consumer reviews bans these and allows civil penalties, and its Endorsement Guides require disclosing any material connection.',
    evidence: {
      grade: 'mixed',
      summary:
        "The studies disagree. In Profound's data G2 is among the ten most cited sources of ChatGPT and Perplexity, and Yelp and Tripadvisor among Perplexity's, but Ahrefs' top tens for those two engines have no review site. No study tests whether more reviews get your own page cited.",
      sources: [
        cite(
          WORKS.profound2025,
          `G2 is 6.7% of ChatGPT's top-ten sources and 4.0% of Perplexity's; Yelp 5.8% and Tripadvisor 4.1% of Perplexity's. ${PROFOUND_TOP10}`,
        ),
        cite(
          WORKS.ahrefs2025,
          `No review site in ChatGPT's or Perplexity's top ten. ${AHREFS_TOP10.chatgpt} ${AHREFS_TOP10.perplexity}`,
        ),
        cite(
          WORKS.ftcReviews,
          'The rule, in effect since 21 October 2024, covers fake or false reviews (section 465.2), reviews bought on condition of a particular sentiment (465.4), insider reviews (465.5) and review suppression (465.7); courts may impose "civil penalties for knowing violations".',
        ),
        cite(
          WORKS.ftcEndorsements,
          'A relative or friend reviewing a business "should disclose this fact"; recipients of discounts or free products given for reviews must disclose them.',
        ),
      ],
    },
  },
  news: {
    kind: 'news',
    title: 'News and editorial sites',
    advice:
      'Coverage comes from having something worth reporting: original data, or expertise a reporter can quote. Offer it to journalists who cover your field, and answer reporters when you can help.',
    avoid:
      "No paid placements presented as coverage, no paid links in articles, and no press releases written to carry keyword links: Google's spam policies treat links bought for ranking, and optimized anchor text in guest posts and press releases, as link spam. Disclose any sponsored piece.",
    evidence: {
      grade: 'moderate',
      summary:
        "News and editorial sites fill much of ChatGPT's top ten in Profound's data (Forbes, Business Insider, New York Post, Reuters) and in Ahrefs' (Reuters, Apple News, AS.com). No study tests whether pitching gets your own page cited.",
      sources: [
        cite(
          WORKS.profound2025,
          `ChatGPT's top ten includes Forbes 6.8%, TechRadar 5.5%, NerdWallet 5.1%, Business Insider 4.9%, New York Post 4.4% and Reuters 3.4%. ${PROFOUND_TOP10}`,
        ),
        cite(
          WORKS.ahrefs2025,
          '"News outlets like Reuters, Apple News (AP), and AS.com feature prominently in ChatGPT" (June 2025 mentions).',
        ),
        cite(
          WORKS.googleSpam,
          'Link spam includes "Buying or selling links for ranking purposes" and "links with optimized anchor text in articles, guest posts, or press releases distributed on other sites."',
        ),
      ],
    },
  },
  reference: {
    kind: 'reference',
    title: 'Reference, health and government sites',
    advice:
      'You cannot place yourself on these sites. Cite them accurately in your own page and keep your claims consistent with them, so an answer that draws on both does not set them against you.',
    avoid:
      'Do not imply that an institution endorses you because you cite it, and do not copy its text.',
    evidence: {
      grade: 'mixed',
      summary:
        "The studies disagree. Ahrefs puts Mayo Clinic, Cleveland Clinic and the NIH in Google AI Overviews' top ten, and Semrush lists the NIH third in Perplexity, but Profound's top tens for those engines have no reference site, nor does Ahrefs' for Perplexity. These sites are cited for what they publish themselves.",
      sources: [
        cite(
          WORKS.ahrefs2025,
          `"Health/medical sites (Mayo Clinic, Cleveland Clinic) register in AI Overviews" (June 2025 mentions). ${AHREFS_TOP10.overviews} ${AHREFS_TOP10.perplexity}`,
        ),
        cite(
          WORKS.semrush2025,
          "Perplexity's most cited domains: Reddit, LinkedIn, NIH, Microsoft and Google.",
        ),
        cite(
          WORKS.profound2025,
          `No reference, health or government site in Google AI Overviews' or Perplexity's top ten, which hold Reddit, YouTube, Quora, LinkedIn, Gartner, NerdWallet, Forbes, Wikipedia, Business Insider and Medium, and Reddit, YouTube, Gartner, Yelp, LinkedIn, Forbes, NerdWallet, Tripadvisor, G2 and PCMag. ${PROFOUND_TOP10}`,
        ),
      ],
    },
  },
  social: {
    kind: 'social',
    title: 'Professional and social networks',
    advice:
      "Post what you know under your own name on the networks your readers use, LinkedIn above all for professional topics, and link your page where it adds something. List those profiles under sameAs in your site's JSON-LD, which Google documents for profile pages on other sites; no study we opened tests whether that changes AI citation.",
    avoid:
      'No fake accounts, no bought followers or engagement, and disclose any paid or sponsored post.',
    evidence: {
      grade: 'moderate',
      summary:
        "All three studies put a social network in Perplexity's top sources: LinkedIn in Profound's and Semrush's data, Instagram in Ahrefs'. LinkedIn is also among Google AI Overviews' top sources in Profound's data, and Semrush found it the most cited domain in Google AI Mode (nearly 15% of responses). No study tests whether posting there gets your own page cited.",
      sources: [
        cite(
          WORKS.profound2025,
          `LinkedIn is 13.0% of Google AI Overviews' top-ten sources and 5.3% of Perplexity's. ${PROFOUND_TOP10}`,
        ),
        cite(
          WORKS.semrush2025,
          'LinkedIn led Google AI Mode at nearly 15% of responses, was second in Perplexity and fifth in ChatGPT.',
        ),
        cite(WORKS.ahrefs2025, `instagram.com is tenth in Perplexity. ${AHREFS_TOP10.perplexity}`),
        cite(
          WORKS.ftcEndorsements,
          'A sponsored endorsement\'s "connection to the company should be disclosed everywhere you endorse the product", social media included.',
        ),
        cite(
          WORKS.googleOrganization,
          'sameAs is "The URL of a page on another website with additional information about your organization", "for example, a URL to your organization\'s profile page on a social media or review site". The page does not tie it to AI features.',
        ),
      ],
    },
  },
  commerce: {
    kind: 'commerce',
    title: 'Shops and marketplaces',
    advice:
      'If you sell through a marketplace, keep the listing accurate and complete, and consistent with your own page.',
    avoid:
      'No fake or bought reviews on a listing, no reviews from staff or family without saying so, and no claims the product page cannot back up.',
    evidence: {
      grade: 'mixed',
      summary:
        "The studies disagree. Ahrefs puts Amazon in ChatGPT's top ten, but Profound's ChatGPT top ten has no marketplace, and no other top ten we opened has one. The review rules below apply to listings too.",
      sources: [
        cite(WORKS.ahrefs2025, `amazon.com is sixth in ChatGPT. ${AHREFS_TOP10.chatgpt}`),
        cite(
          WORKS.profound2025,
          `ChatGPT's top ten: Wikipedia, Reddit, Forbes, G2, TechRadar, NerdWallet, Business Insider, New York Post, Toxigon and Reuters; no marketplace. ${PROFOUND_TOP10}`,
        ),
        cite(
          WORKS.ftcReviews,
          'The rule covers fake or false reviews, reviews bought on condition of a particular sentiment, undisclosed insider reviews and review suppression, wherever they appear.',
        ),
      ],
    },
  },
  'blog-or-other': {
    kind: 'blog-or-other',
    title: 'Blogs and other sites',
    advice:
      'Most citations go to sites outside any top-ten list, and that is where your own page competes: keep it accurate and useful (the checks in the workspace). When you have something to add, write for respected publications in your field under your own name.',
    avoid:
      "No bought or exchanged links, no guest posts written to carry keyword links, and no mass-produced pages: Google's spam policies treat these as link spam and scaled content abuse.",
    evidence: {
      grade: 'moderate',
      summary:
        "Medium, a blogging platform, is in Google AI Overviews' top ten in Profound's data and third in ChatGPT in Semrush's. More to the point, the ten most cited domains together held only about 10% to 16% of each engine's citations in Profound's data, and no single domain more than 7.8%; the rest went to other sites, which is where your own page competes.",
      sources: [
        cite(
          WORKS.profound2025,
          "Medium is 3.9% of Google AI Overviews' top-ten sources. Overall citation volume of the ten most cited domains: 16.3% of ChatGPT's citations, 10.3% of Google AI Overviews' and 14.2% of Perplexity's (our sums of the shares the study lists); the top domain is 7.8%, 2.2% and 6.6%.",
        ),
        cite(
          WORKS.semrush2025,
          "ChatGPT's most cited domains: Wikipedia and Reddit, then Medium, Forbes and LinkedIn.",
        ),
        cite(
          WORKS.googleSpam,
          'Link spam includes "Buying or selling links for ranking purposes" and excessive link exchanges; "Scaled content abuse is when many pages are generated for the primary purpose of manipulating search rankings".',
        ),
      ],
    },
  },
};
