import type { Definition, Nodes } from 'mdast';
import type { ParsedDraft } from './parse';
import { countWords, joinLines, type Sentence, splitSentences } from './text';
import type { Range } from './types';

// Every `range` below is a pair of offsets into `Artifacts.markdown` (end exclusive).

export interface Heading {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  /** Plain text without markup (`**`, links, the `#` markers). */
  text: string;
  /** The heading's content, without the `#` markers or a closing `#` sequence. */
  range: Range;
}
export interface Paragraph {
  /** The raw Markdown of the paragraph: `markdown.slice(range.start, range.end)`. */
  text: string;
  /**
   * Prose-only copy of `text`, the same length, so an index into `plain` is an
   * index into `text` (and `range.start + i` into the source). Only the
   * characters of text nodes survive; inline code, inline HTML, images, link
   * destinations and titles, reference labels, autolinked URLs, emphasis
   * markers, hard breaks, quote markers and line breaks are spaces. Checks that
   * count numbers, quotes or phrases read `plain`, not `text`.
   */
  plain: string;
  range: Range;
  sentences: Sentence[];
  sectionIndex: number;
  /** Inside a list item; paragraph-level checks skip these. */
  inListItem: boolean;
  inBlockquote: boolean;
  /** Inside a footnote definition (`[^1]: Source.`): a source note, not body prose. */
  inFootnote: boolean;
}
export interface Section {
  /** Index into `headings` of the H2/H3 that opens the section; null for the lead section. */
  headingIndex: number | null;
  range: Range;
  paragraphIndices: number[];
}
export interface ListBlock {
  ordered: boolean;
  itemCount: number;
  /**
   * Each item's content without the list marker (`text` is the raw Markdown). `checked` is a
   * task item's state (`- [x]` true, `- [ ]` false), null for a plain item.
   */
  items: { text: string; range: Range; checked: boolean | null }[];
  range: Range;
  sectionIndex: number;
}
export interface TableBlock {
  /** Row count including the header row. */
  rows: number;
  cols: number;
  range: Range;
  sectionIndex: number;
}
export interface LinkRef {
  url: string;
  /** Plain link text. */
  text: string;
  /** The whole link (`[text](url)`, `[text][ref]` or an autolink). */
  range: Range;
}
export interface Artifacts {
  markdown: string;
  headings: Heading[];
  sections: Section[];
  paragraphs: Paragraph[];
  lists: ListBlock[];
  tables: TableBlock[];
  links: LinkRef[];
  /** Words in prose, headings, list items and table cells; code, HTML and front matter excluded. */
  wordCount: number;
}

interface Context {
  inListItem: boolean;
  inBlockquote: boolean;
  inFootnote: boolean;
}

const rangeOf = (node: Nodes): Range => ({
  start: node.position?.start.offset ?? 0,
  end: node.position?.end.offset ?? 0,
});

/** Range from the first child's start to the last child's end; empty at the node's end if none. */
function contentRange(node: Nodes): Range {
  const children = 'children' in node ? node.children : [];
  const first = children[0];
  const last = children[children.length - 1];
  if (!first || !last) {
    const end = rangeOf(node).end;
    return { start: end, end };
  }
  return { start: rangeOf(first).start, end: rangeOf(last).end };
}

/** Plain text of phrasing content; HTML and images contribute nothing. */
function plainText(node: Nodes): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return node.value;
    case 'break':
      return ' ';
    case 'html':
    case 'image':
    case 'imageReference':
    case 'footnoteReference':
      return '';
    default:
      return 'children' in node ? node.children.map((c) => plainText(c as Nodes)).join('') : '';
  }
}

/**
 * Same-length prose mask of a paragraph (see `Paragraph.plain`). Text nodes
 * keep their characters; everything else is a space. A link whose source does
 * not start with `[` is an autolink (`<url>` or a bare URL), so its text is the
 * URL and is masked too.
 */
function proseMask(markdown: string, node: Nodes, range: Range): string {
  const chars = Array.from({ length: range.end - range.start }, () => ' ');
  const keep = (n: Nodes): void => {
    switch (n.type) {
      case 'text': {
        const { start, end } = rangeOf(n);
        for (let i = Math.max(start, range.start); i < Math.min(end, range.end); i++)
          chars[i - range.start] = markdown[i] ?? ' ';
        return;
      }
      case 'inlineCode':
      case 'html':
      case 'image':
      case 'imageReference':
      case 'footnoteReference':
      case 'break':
        return;
      case 'link':
        if (markdown[rangeOf(n).start] !== '[') return;
        break;
    }
    if ('children' in n) for (const child of n.children) keep(child as Nodes);
  };
  keep(node);
  return joinLines(chars.join(''));
}

function collectDefinitions(node: Nodes, into: Map<string, Definition>): void {
  if (node.type === 'definition') {
    if (!into.has(node.identifier)) into.set(node.identifier, node);
    return;
  }
  if ('children' in node)
    for (const child of node.children) collectDefinitions(child as Nodes, into);
}

/** Derives the artifacts every check reads from a parsed draft. */
export function gather(parsed: ParsedDraft): Artifacts {
  const { markdown, tree } = parsed;
  const slice = (r: Range) => markdown.slice(r.start, r.end);

  const definitions = new Map<string, Definition>();
  collectDefinitions(tree, definitions);

  const headings: Heading[] = [];
  /** Start of each heading node (`## ` included), parallel to `headings`. */
  const headingStarts: number[] = [];
  const paragraphs: Paragraph[] = [];
  const lists: ListBlock[] = [];
  const tables: TableBlock[] = [];
  const links: LinkRef[] = [];
  let wordCount = 0;

  const visit = (node: Nodes, ctx: Context): void => {
    switch (node.type) {
      case 'yaml':
      case 'code':
      case 'html':
      case 'definition':
        return;
      case 'heading': {
        const text = plainText(node).trim();
        // A heading inside a quote, a list item or a footnote is quoted text: it does not open
        // a section, and no check grades it.
        if (!ctx.inListItem && !ctx.inBlockquote && !ctx.inFootnote) {
          headings.push({ depth: node.depth, text, range: contentRange(node) });
          headingStarts.push(rangeOf(node).start);
        }
        wordCount += countWords(text);
        break;
      }
      case 'paragraph': {
        const range = rangeOf(node);
        const text = slice(range);
        const plain = proseMask(markdown, node, range);
        paragraphs.push({
          text,
          plain,
          range,
          sentences: splitSentences(text, range.start, plain),
          sectionIndex: -1,
          inListItem: ctx.inListItem,
          inBlockquote: ctx.inBlockquote,
          inFootnote: ctx.inFootnote,
        });
        wordCount += countWords(plainText(node));
        break;
      }
      case 'list': {
        const items = node.children.map((item) => {
          const range = contentRange(item);
          return { text: slice(range), range, checked: item.checked ?? null };
        });
        lists.push({
          ordered: node.ordered === true,
          itemCount: items.length,
          items,
          range: rangeOf(node),
          sectionIndex: -1,
        });
        break;
      }
      case 'table': {
        tables.push({
          rows: node.children.length,
          cols: Math.max(0, ...node.children.map((row) => row.children.length)),
          range: rangeOf(node),
          sectionIndex: -1,
        });
        break;
      }
      case 'tableCell':
        wordCount += countWords(plainText(node));
        break;
      case 'link':
        links.push({ url: node.url, text: plainText(node).trim(), range: rangeOf(node) });
        break;
      case 'linkReference': {
        const definition = definitions.get(node.identifier);
        if (definition) {
          links.push({ url: definition.url, text: plainText(node).trim(), range: rangeOf(node) });
        }
        break;
      }
    }
    if (!('children' in node)) return;
    const childCtx: Context = {
      inListItem: ctx.inListItem || node.type === 'listItem',
      inBlockquote: ctx.inBlockquote || node.type === 'blockquote',
      inFootnote: ctx.inFootnote || node.type === 'footnoteDefinition',
    };
    for (const child of node.children) visit(child as Nodes, childCtx);
  };
  visit(tree, { inListItem: false, inBlockquote: false, inFootnote: false });

  const firstBlock = tree.children[0];
  const sections = firstBlock
    ? buildSections(rangeOf(firstBlock).start, headings, headingStarts, markdown.length)
    : [];
  const sectionAt = (offset: number): number => {
    let index = -1;
    for (const [i, s] of sections.entries()) if (s.range.start <= offset) index = i;
    return index;
  };
  for (const [i, p] of paragraphs.entries()) {
    p.sectionIndex = sectionAt(p.range.start);
    sections[p.sectionIndex]?.paragraphIndices.push(i);
  }
  for (const block of [...lists, ...tables]) block.sectionIndex = sectionAt(block.range.start);

  return { markdown, headings, sections, paragraphs, lists, tables, links, wordCount };
}

/**
 * Sections split at H2/H3 (the H1 is the title). Content before the first
 * H2/H3, H1 included, forms a lead section with `headingIndex: null`.
 */
function buildSections(
  leadStart: number,
  headings: Heading[],
  headingStarts: number[],
  length: number,
): Section[] {
  const starts: { headingIndex: number | null; start: number }[] = [];
  for (const [i, h] of headings.entries()) {
    if (h.depth === 2 || h.depth === 3)
      starts.push({ headingIndex: i, start: headingStarts[i] ?? 0 });
  }
  const firstSplit = starts[0]?.start;
  if (firstSplit === undefined || leadStart < firstSplit) {
    starts.unshift({ headingIndex: null, start: leadStart });
  }
  return starts.map((s, i) => ({
    headingIndex: s.headingIndex,
    range: { start: s.start, end: starts[i + 1]?.start ?? length },
    paragraphIndices: [],
  }));
}
