import type { Root } from 'mdast';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

export interface ParsedDraft {
  /** The Markdown every offset refers to (the source, or the converted HTML). */
  markdown: string;
  /** mdast with `position.start.offset` / `position.end.offset` into `markdown`. */
  tree: Root;
}

/** The few hast fields `keepContent` reads; the HTML tree is otherwise passed through. */
interface HtmlNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: {
    role?: unknown;
    href?: unknown;
    rel?: unknown;
    property?: unknown;
    content?: unknown;
  };
  children?: HtmlNode[];
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function findAll(node: HtmlNode, match: (n: HtmlNode) => boolean, out: HtmlNode[] = []) {
  if (node.type === 'element' && match(node)) out.push(node);
  for (const child of node.children ?? []) findAll(child, match, out);
  return out;
}

const tagIs =
  (...tags: string[]) =>
  (n: HtmlNode): boolean =>
    tags.includes(n.tagName ?? '');
const holds = (node: HtmlNode, match: (n: HtmlNode) => boolean): boolean =>
  findAll(node, match).length > 0;
const isHeading = (n: HtmlNode): boolean => HEADINGS.has(n.tagName ?? '');
const textOf = (node: HtmlNode): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('');
const lead = (node: HtmlNode): string => textOf(node).trim();

/** A label that says the block lists the draft's sources ("Sources:", "References", ...). */
const SOURCES_LABEL = /^(sources?|references?|bibliography|works cited|citations?|footnotes)\b/i;
/**
 * The opening words of a site-furniture label ("Related posts", "Share this", ...). They also
 * open real headings ("Popular myths", "Related: grind size", "Share of drinkers"), so this
 * decides only a block with no prose paragraph (see `holdsProse`).
 */
const CHROME_LABEL =
  /^(related|you (may|might) also like|more (from|posts|stories|articles)|recent (posts|articles)|popular|trending|read next|share|follow|subscribe|newsletter|sign up|tags|categories|archives?|comments?|leave a (comment|reply))\b/i;
/** A whole site-furniture label, nothing after it but a colon or a full stop. */
const CHROME_PHRASE =
  /^(related( (posts|articles|stories|links|content|reading))?|you (may|might) also like|more (posts|stories|articles)|more from (the|our|this) (blog|site|author)|recent (posts|articles)|popular( (posts|articles|stories))?|trending( now| posts)?|read next|share( this( (post|article|story|page))?)?|follow( (us|me))?( on social( media)?)?|subscribe( to (our|the|my) newsletter)?|(our|the) newsletter|newsletter|sign up( for (our|the|my) newsletter)?|tags|categories|archives?|comments?|leave a (comment|reply))\s*[:.]?$/i;

/**
 * Social, sharing and site-platform hosts. A link to one of them (a profile, a share button,
 * "Powered by WordPress") is site chrome, not a source.
 */
const CHROME_HOSTS = [
  'twitter.com',
  'x.com',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'pinterest.com',
  'reddit.com',
  'threads.net',
  'bsky.app',
  'mastodon.social',
  'github.com',
  'medium.com',
  'substack.com',
  'tumblr.com',
  'patreon.com',
  'buymeacoffee.com',
  'ko-fi.com',
  't.me',
  'wa.me',
  'whatsapp.com',
  'discord.gg',
  'discord.com',
  'wordpress.org',
  'wordpress.com',
  'ghost.org',
  'ghost.io',
  'squarespace.com',
  'wix.com',
  'shopify.com',
  'webflow.com',
  'blogger.com',
  'gohugo.io',
  'jekyllrb.com',
  'netlify.com',
  'vercel.com',
  'feedburner.com',
  'addtoany.com',
  'sharethis.com',
];

function hostOf(href: unknown): string | undefined {
  if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return undefined;
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** Same site: equal hosts, or one a subdomain of the other. */
const sameSite = (a: string, b: string): boolean =>
  a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

/**
 * The page's own hosts: from `<link rel="canonical">`, `og:url` and `<base href>`, and from the
 * absolute links in its navigation and header, which point at the site itself.
 */
function siteHosts(root: HtmlNode): string[] {
  const hosts = new Set<string>();
  const add = (href: unknown) => {
    const host = hostOf(href);
    if (host) hosts.add(host);
  };
  for (const n of findAll(root, () => true)) {
    const rel = Array.isArray(n.properties?.rel) ? n.properties.rel : [];
    if (n.tagName === 'link' && rel.includes('canonical')) add(n.properties?.href);
    if (n.tagName === 'meta' && n.properties?.property === 'og:url') add(n.properties?.content);
    if (n.tagName === 'base') add(n.properties?.href);
  }
  const role = (n: HtmlNode) => n.properties?.role;
  const siteNav = (n: HtmlNode) =>
    ['nav', 'header'].includes(n.tagName ?? '') || role(n) === 'navigation' || role(n) === 'banner';
  for (const nav of findAll(root, siteNav))
    for (const a of findAll(nav, tagIs('a'))) add(a.properties?.href);
  return [...hosts];
}

/**
 * A link to a source: absolute http(s), not `rel="me"`, not a social, sharing or platform host,
 * and not the page's own site. With no known site host (a bare fragment), any other absolute
 * link counts.
 */
const isSourceLink =
  (site: string[]) =>
  (n: HtmlNode): boolean => {
    if (n.tagName !== 'a') return false;
    const host = hostOf(n.properties?.href);
    if (!host) return false;
    const rel = Array.isArray(n.properties?.rel) ? n.properties.rel : [];
    if (rel.includes('me')) return false;
    if (CHROME_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false;
    return !site.some((h) => sameSite(host, h));
  };

/** The text of a node outside its links. */
const proseOf = (node: HtmlNode): string =>
  node.type === 'text'
    ? (node.value ?? '')
    : node.tagName === 'a'
      ? ' '
      : (node.children ?? []).map(proseOf).join('');

/**
 * A paragraph of prose: a `<p>` with text of its own outside its links, not only separators
 * ("<a>Milk</a> · <a>Grind</a>" is a link list; "Decaf still holds caffeine." is prose).
 */
const holdsProse = (node: HtmlNode): boolean =>
  holds(
    node,
    (n) => n.tagName === 'p' && /[^\s\u00b7\u2022|,/()[\]\u2013\u2014-]/.test(proseOf(n)),
  );

/** The texts that can carry a block's label: its own start, its headings, paragraphs and terms. */
function labels(node: HtmlNode): string[] {
  const labelled = findAll(node, tagIs('p', 'strong', 'b', 'dt', 'summary', 'caption'));
  return [lead(node), ...findAll(node, isHeading).map(lead), ...labelled.map(lead)];
}

/**
 * Page chrome, not the draft's content. Navigation always is. A header (or banner) is, unless
 * it holds a heading. A footer or aside (or contentinfo, complementary) is content when it holds
 * a `<cite>` or a sources label ("Sources:", "References"); it is chrome when its first heading
 * is a whole site label ("Related posts", "Share this", "Subscribe to our newsletter"), or when
 * it holds no prose paragraph and it or its first heading opens with a site label ("Related: ..."
 * over a list of links); otherwise it is content when it holds a source link (see
 * `isSourceLink`) or a heading with a paragraph. So a sources footer, a "Tip" box and a "Popular
 * myths" aside stay, while "© 2026 · Twitter", "Powered by WordPress" and related links go.
 */
function isChrome(node: HtmlNode, site: string[]): boolean {
  if (node.type !== 'element') return false;
  const tag = node.tagName ?? '';
  const role = typeof node.properties?.role === 'string' ? node.properties.role : '';
  if (tag === 'nav' || role === 'navigation') return true;
  if (tag === 'header' || role === 'banner') return !holds(node, isHeading);
  if (tag === 'footer' || tag === 'aside' || role === 'contentinfo' || role === 'complementary') {
    if (holds(node, tagIs('cite'))) return false;
    if (labels(node).some((t) => SOURCES_LABEL.test(t))) return false;
    const [heading] = findAll(node, isHeading);
    const label = heading ? lead(heading) : '';
    if (CHROME_PHRASE.test(label)) return true;
    if (!holdsProse(node) && (CHROME_LABEL.test(lead(node)) || CHROME_LABEL.test(label)))
      return true;
    if (holds(node, isSourceLink(site))) return false;
    return !(holds(node, isHeading) && holds(node, tagIs('p')));
  }
  return false;
}

function dropChrome(node: HtmlNode, site: string[]): void {
  if (!node.children) return;
  node.children = node.children.filter((c) => !isChrome(c, site));
  for (const child of node.children) dropChrome(child, site);
}

/**
 * For a full page, keeps the content: the `<main>` element, else a lone `<article>`, else the
 * whole document; then drops the page chrome described at `isChrome`, so "Home | About" and
 * "© 2026" are not graded as paragraphs. Headers, footers and asides that hold content stay.
 */
function keepContent() {
  return (tree: unknown): void => {
    const root = tree as HtmlNode;
    const site = siteHosts(root);
    const [main] = findAll(root, tagIs('main'));
    const articles = findAll(root, tagIs('article'));
    const content = main ?? (articles.length === 1 ? articles[0] : undefined);
    if (content) root.children = [content];
    dropChrome(root, site);
  };
}

const markdownParser = unified().use(remarkParse).use(remarkGfm).freeze();
const htmlToMarkdown = unified()
  .use(rehypeParse, { fragment: true })
  .use(keepContent)
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify)
  .freeze();

/** YAML front matter at the very start of the draft (optional BOM, `---` ... `---` or `...`). */
const FRONT_MATTER = /^﻿?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/;

/**
 * Replaces YAML front matter with spaces (keeping line breaks), so the parser
 * sees blank lines there while every offset still matches the original source.
 */
function blankFrontMatter(source: string): string {
  const match = FRONT_MATTER.exec(source);
  if (!match) return source;
  return match[0].replace(/[^\r\n]/g, ' ') + source.slice(match[0].length);
}

/**
 * Parses a draft into mdast. HTML is first converted to Markdown (the page's main content,
 * without navigation and the banners, sidebars and footers that hold no content) and the result
 * reparsed, so offsets always refer
 * to the returned `markdown`.
 */
export function parseDraft(source: string, format: 'markdown' | 'html' = 'markdown'): ParsedDraft {
  const markdown = format === 'html' ? String(htmlToMarkdown.processSync(source)) : source;
  return { markdown, tree: markdownParser.parse(blankFrontMatter(markdown)) };
}
