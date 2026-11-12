// Site size: how big a cited site is, labelled the way the Small-Site Funnel Study (Northeastern,
// Fall 2026) labels its pages. Size comes from a site's rank on a Tranco list of the top million
// registrable domains: big is the top 10,000, mid the rest of the top million, small is not on the
// list at all. Pages on a hosting platform (a blog on medium.com, a site on github.io) and
// Wikipedia stay in groups of their own and never count as small, since the platform's rank says
// nothing about the person who wrote the page. Pure TS, browser-safe: no list ships with the tool;
// the author loads one (see tranco.ts), and nothing here makes a request.
import { hostOf } from './offpage';

/** Ranks 1 to BIG_MAX_RANK are big sites. */
export const BIG_MAX_RANK = 10_000;
/** Ranks up to SMALL_MIN_RANK are mid sites; a site not on a list this deep is small. */
export const SMALL_MIN_RANK = 1_000_000;

export const SITE_SIZES = ['big', 'mid', 'small', 'platform', 'wikipedia', 'unknown'] as const;
/**
 * `unknown` means the size cannot be told: no list was loaded, the text is not a host, or the list
 * stops short of the top million and the site is not on it.
 */
export type SiteSize = (typeof SITE_SIZES)[number];

/** Plain names for each size, as the workspace and the CLI print them. */
export const SITE_SIZE_TEXT: Record<SiteSize, string> = {
  big: 'Big site',
  mid: 'Mid-size site',
  small: 'Small site',
  platform: 'Hosting platform',
  wikipedia: 'Wikipedia',
  unknown: 'Size unknown',
};

/** A ranked list of registrable domains, such as a Tranco list (`parseTrancoList`). */
export interface RankList {
  /** The list's name, such as a Tranco list ID; '' when unknown. */
  id: string;
  /** The deepest rank on the list: 1,000,000 for a full Tranco list. */
  depth: number;
  /** The domain's rank, or undefined when it is not on the list. */
  rankOf(domain: string): number | undefined;
}

export interface HostingPlatform {
  pattern: string;
  /**
   * `subdomain`: a page on a subdomain of `pattern` (someone.wordpress.com, not wordpress.com
   * itself); `domain`: any page under `pattern` (medium.com/@someone); `host`: that exact host.
   */
  match: 'subdomain' | 'domain' | 'host';
  category: string;
}

/**
 * Sites that host other people's pages, from the study's reference list
 * (phase0/reference/hosting_platforms.csv in the study repository, used for its Search Arena
 * labels). Their rank describes the platform, not the writer, so their pages form a group of their
 * own. fandom.com is also a wiki in `classifyDomain`; here it is a platform.
 */
export const HOSTING_PLATFORMS: readonly HostingPlatform[] = [
  ...[
    'github.io',
    'gitlab.io',
    'netlify.app',
    'vercel.app',
    'pages.dev',
    'herokuapp.com',
    'streamlit.app',
    'neocities.org',
  ].map((pattern) => ({ pattern, match: 'subdomain' as const, category: 'static hosting' })),
  ...['readthedocs.io', 'gitbook.io'].map((pattern) => ({
    pattern,
    match: 'subdomain' as const,
    category: 'docs hosting',
  })),
  ...[
    'notion.site',
    'wixsite.com',
    'weebly.com',
    'webflow.io',
    'webnode.page',
    'tilda.ws',
    'carrd.co',
    'mystrikingly.com',
    'jimdofree.com',
    'godaddysites.com',
    'mozellosite.com',
    'narod.ru',
    'ucoz.ru',
    'tripod.com',
  ].map((pattern) => ({ pattern, match: 'subdomain' as const, category: 'site builder' })),
  { pattern: 'sites.google.com', match: 'host', category: 'site builder' },
  { pattern: 'angelfire.com', match: 'domain', category: 'site builder' },
  ...[
    'wordpress.com',
    'blogspot.com',
    'blogger.com',
    'tumblr.com',
    'livejournal.com',
    'typepad.com',
    'tistory.com',
    'blogfa.com',
    'hashnode.dev',
    'bearblog.dev',
    'ghost.io',
    'over-blog.com',
    'canalblog.com',
    'seesaa.net',
    'exblog.jp',
    'hatenablog.com',
    'hateblo.jp',
    'livedoor.blog',
    'fc2.com',
  ].map((pattern) => ({ pattern, match: 'subdomain' as const, category: 'blog hosting' })),
  ...['blog.livedoor.jp', 'blog.naver.com', 'm.blog.naver.com', 'blog.csdn.net'].map((pattern) => ({
    pattern,
    match: 'host' as const,
    category: 'blog hosting',
  })),
  ...[
    'medium.com',
    'dev.to',
    'cnblogs.com',
    'jianshu.com',
    'juejin.cn',
    'qiita.com',
    'zenn.dev',
    'note.com',
    'ameblo.jp',
    'velog.io',
    'habr.com',
    'vc.ru',
    'dzen.ru',
    'hubpages.com',
    'vocal.media',
    'telegra.ph',
  ].map((pattern) => ({ pattern, match: 'domain' as const, category: 'blog platform' })),
  { pattern: 'substack.com', match: 'domain', category: 'newsletter' },
  { pattern: 'beehiiv.com', match: 'subdomain', category: 'newsletter' },
  ...['fandom.com', 'miraheze.org', 'wikidot.com'].map((pattern) => ({
    pattern,
    match: 'subdomain' as const,
    category: 'wiki farm',
  })),
  ...['itch.io', 'bandcamp.com'].map((pattern) => ({
    pattern,
    match: 'subdomain' as const,
    category: 'creator storefront',
  })),
];

/**
 * Public suffixes of more than one label that are common in AI answers. Tranco ranks registrable
 * domains under the ICANN section of the Public Suffix List; this short list covers the suffixes
 * seen most, so a host under a rarer one (say `example.gov.bd`) gets a domain one label too short.
 * The study itself uses the full list.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  ...['co', 'org', 'ac', 'gov', 'ltd', 'plc', 'me', 'net', 'nhs', 'sch', 'police'].map(
    (s) => `${s}.uk`,
  ),
  ...['com', 'net', 'org', 'edu', 'gov', 'asn', 'id'].map((s) => `${s}.au`),
  ...['co', 'org', 'net', 'ac', 'govt', 'school'].map((s) => `${s}.nz`),
  ...['co', 'ne', 'or', 'ac', 'go', 'gr', 'ed'].map((s) => `${s}.jp`),
  ...['co', 'net', 'org', 'ac', 'gov', 'edu', 'res', 'nic'].map((s) => `${s}.in`),
  ...['com', 'net', 'org', 'gov', 'edu'].map((s) => `${s}.br`),
  ...['com', 'net', 'org', 'gov', 'edu', 'ac'].map((s) => `${s}.cn`),
  ...['com', 'org', 'gob', 'edu', 'net'].map((s) => `${s}.mx`),
  ...['co', 'org', 'gov', 'ac', 'net', 'edu'].map((s) => `${s}.za`),
  ...['com', 'edu', 'gov', 'org', 'net'].map((s) => `${s}.sg`),
  ...['com', 'edu', 'gov', 'org', 'net'].map((s) => `${s}.hk`),
  ...['com', 'edu', 'gov', 'org', 'net'].map((s) => `${s}.tw`),
  ...['co', 'or', 'go', 'ac', 'ne', 're'].map((s) => `${s}.kr`),
  ...['com', 'gov', 'edu', 'org', 'net'].map((s) => `${s}.tr`),
  ...['com', 'gob', 'edu', 'org'].map((s) => `${s}.ar`),
  ...['co', 'ac', 'gov', 'org'].map((s) => `${s}.il`),
  ...['com', 'edu', 'gov', 'org'].map((s) => `${s}.my`),
  ...['com', 'edu', 'gov', 'org'].map((s) => `${s}.ph`),
  ...['com', 'edu', 'gov', 'org'].map((s) => `${s}.pk`),
  ...['com', 'edu', 'gov', 'org'].map((s) => `${s}.ng`),
  ...['co', 'ac', 'go', 'or'].map((s) => `${s}.ke`),
  ...['com', 'edu', 'gov'].map((s) => `${s}.eg`),
  ...['com', 'edu', 'gov'].map((s) => `${s}.sa`),
  ...['com', 'edu', 'gov'].map((s) => `${s}.vn`),
  ...['co', 'ac', 'go', 'or'].map((s) => `${s}.id`),
  ...['com', 'edu', 'gov', 'org'].map((s) => `${s}.co`),
  ...['com', 'edu', 'gob', 'org'].map((s) => `${s}.pe`),
  ...['com', 'edu', 'gov', 'org'].map((s) => `${s}.ua`),
  'gouv.fr',
  'gv.at',
  'ac.at',
  'co.at',
]);

/**
 * The registrable domain of a host (lowercase, no `www.`): the last two labels, or three under a
 * multi-label public suffix ("blog.shop.co.uk" -> "shop.co.uk"). '' when `host` is not a host.
 */
export function registrableDomain(urlOrHost: string): string {
  const host = hostOf(urlOrHost);
  if (host === '') return '';
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/** The hosting platform serving `host`, or undefined. */
export function platformOf(urlOrHost: string): HostingPlatform | undefined {
  const host = hostOf(urlOrHost);
  if (host === '') return undefined;
  const domain = registrableDomain(host);
  return HOSTING_PLATFORMS.find((p) => {
    if (p.match === 'host') return host === p.pattern;
    if (p.match === 'domain') return domain === p.pattern;
    return domain === p.pattern && host !== p.pattern;
  });
}

/**
 * Government, education, military and research hosts (gov, edu, mil, gob, gouv, govt, int, and
 * ac. or go. as a second level). They keep their size and carry a flag, as in the study.
 */
const INSTITUTIONAL =
  /(?:^|\.)(?:gov|edu|mil|gob|gouv|govt|int)(?:\.|$)|(?:^|\.)(?:ac|go)\.[a-z]+$/;

export function isInstitutional(urlOrHost: string): boolean {
  const host = hostOf(urlOrHost);
  if (host === '') return false;
  // Look at the suffix only: the registrable domain minus its first label.
  const domain = registrableDomain(host);
  const suffix = domain.split('.').slice(1).join('.');
  return INSTITUTIONAL.test(suffix);
}

/** The size bucket a Tranco rank falls in. */
export function sizeOfRank(rank: number | undefined, depth = SMALL_MIN_RANK): SiteSize {
  if (rank !== undefined) return rank <= BIG_MAX_RANK ? 'big' : 'mid';
  return depth >= SMALL_MIN_RANK ? 'small' : 'unknown';
}

export interface SiteSizeLabel {
  /** Lowercased host without `www.`; '' when the input is not a host. */
  host: string;
  /** Registrable domain, the unit a Tranco list ranks. */
  domain: string;
  size: SiteSize;
  /** The domain's rank on the list, when it has one. */
  rank?: number;
  /** The hosting platform's kind, for size 'platform'. */
  platform?: string;
  institutional: boolean;
}

/**
 * The size of the site behind a URL or host. Wikipedia and hosting platforms get their own group
 * with or without a list; every other site needs `list` (else 'unknown'). On a list, ranks up to
 * 10,000 are big and the rest mid; a site not on a list that reaches the top million is small,
 * while one missing from a shorter list stays 'unknown'.
 */
export function siteSize(urlOrHost: string, list?: RankList | null): SiteSizeLabel {
  const host = hostOf(urlOrHost);
  if (host === '') return { host, domain: '', size: 'unknown', institutional: false };
  const domain = registrableDomain(host);
  const institutional = isInstitutional(host);
  if (domain === 'wikipedia.org') return { host, domain, size: 'wikipedia', institutional };
  const platform = platformOf(host);
  if (platform)
    return { host, domain, size: 'platform', platform: platform.category, institutional };
  if (!list) return { host, domain, size: 'unknown', institutional };
  const rank = list.rankOf(domain);
  return {
    host,
    domain,
    size: sizeOfRank(rank, list.depth),
    ...(rank === undefined ? {} : { rank }),
    institutional,
  };
}

export interface SizeMix {
  /** Per size: the cited sites (registrable domains) and the citations they got. */
  bySize: Record<SiteSize, { sites: number; citations: number }>;
  /** Citations of big, mid and small sites: the ones a size comparison can use. */
  sized: number;
  /** The small sites' share of `sized`; null when nothing is sized. */
  smallShare: number | null;
  /** The list the sizes come from; null when none was loaded. */
  listId: string | null;
}

/**
 * The size mix of the sites the answers cite, from `tallyCitedSources` rows (the author's own site
 * is already left out there). Hosts of one registrable domain count as one site, and their
 * citations add up. `smallShare` answers "do small sites win these questions at all?": the share
 * of the big, mid and small sites' citations that went to small ones. Platforms, Wikipedia and
 * unknown sizes are counted but stay out of the share.
 */
export function sizeMix(
  domains: readonly { domain: string; citations: number }[],
  list?: RankList | null,
): SizeMix {
  const bySize = Object.fromEntries(
    SITE_SIZES.map((s) => [s, { sites: 0, citations: 0 }]),
  ) as Record<SiteSize, { sites: number; citations: number }>;
  const seen = new Set<string>();
  for (const { domain, citations } of domains) {
    const label = siteSize(domain, list);
    const cell = bySize[label.size];
    const key = label.domain || domain;
    if (!seen.has(key)) {
      seen.add(key);
      cell.sites++;
    }
    cell.citations += citations;
  }
  const sized = bySize.big.citations + bySize.mid.citations + bySize.small.citations;
  return {
    bySize,
    sized,
    smallShare: sized === 0 ? null : bySize.small.citations / sized,
    listId: list ? list.id : null,
  };
}
