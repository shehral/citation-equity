import rehypeParse from 'rehype-parse';
import { unified } from 'unified';
import { countWords } from './text';

// "Renders without JavaScript", judged from a page's view-source HTML in the browser (spec
// 13.5). `ce site` measures the same thing with Defuddle on the fetched HTML; Defuddle is not
// bundled for the browser, so this reads the main text with rehype (no DOM, nothing runs or
// loads) and applies the same word thresholds. The two agree on verdicts, not on exact counts
// (packages/bench/test/robots-check.test.ts compares them on shared fixtures).

/** renders-without-js thresholds, in words of main text: the same as `ce site`. */
export const RENDER_PASS_WORDS = 200;
export const RENDER_WARN_WORDS = 50;

export interface RenderCheck {
  status: 'pass' | 'warn' | 'fail';
  /** Words of main text in the HTML as served, before any script runs. */
  words: number;
}

const htmlParser = unified().use(rehypeParse).freeze();
type HastRoot = ReturnType<typeof htmlParser.parse>;
type HastNode = HastRoot | HastRoot['children'][number];
type HastElement = Extract<HastNode, { type: 'element' }>;

/**
 * Elements whose text a reader of the article never sees as article text: code and styles,
 * fallbacks shown only without scripts ("enable JavaScript"), inert templates, and the site
 * chrome around the article.
 */
const SKIP = new Set([
  'head',
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'select',
]);

/** Text of a subtree without skipped elements, with a space between elements. */
function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element' && SKIP.has(node.tagName)) return '';
  if ('children' in node) return node.children.map(textOf).join(' ');
  return '';
}

/** Outermost elements named `tag` (an article inside an article belongs to it). */
function outermost(node: HastNode, tag: string, found: HastElement[] = []): HastElement[] {
  if (node.type === 'element' && node.tagName === tag) {
    found.push(node);
    return found;
  }
  if ('children' in node) for (const child of node.children) outermost(child, tag, found);
  return found;
}

/**
 * Whether the page's text is in the HTML the server sends. The main text is the longest
 * top-level `<article>`, else the `<main>` elements, else the whole body, without scripts,
 * styles, `<noscript>` and site chrome. 200 words or more pass, 50 to 199 warn, fewer fail.
 */
export function rendersWithoutJs(html: string): RenderCheck {
  const tree = htmlParser.parse(html);
  const articles = outermost(tree, 'article').map((el) => countWords(textOf(el)));
  const mains = outermost(tree, 'main');
  const words =
    articles.length > 0
      ? Math.max(...articles)
      : mains.length > 0
        ? mains.reduce((n, el) => n + countWords(textOf(el)), 0)
        : countWords(textOf(tree));
  const status = words >= RENDER_PASS_WORDS ? 'pass' : words >= RENDER_WARN_WORDS ? 'warn' : 'fail';
  return { status, words };
}
