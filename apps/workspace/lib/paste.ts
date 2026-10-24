import { parseDraft } from '@citation-equity/engine';

/**
 * Rich-text paste: clipboard HTML (a web page, Google Docs, Word) to the Markdown the draft
 * holds. The HTML is cleaned in the browser first, then converted by the engine's own HTML
 * import, so a pasted page reads exactly as an imported one would.
 */

/** Elements dropped with everything inside them: active content, styling and page metadata. */
const DROPPED =
  'script, style, noscript, template, iframe, frame, frameset, object, embed, applet, link, meta, base, title, svg, math';

/** URL schemes that run code or smuggle content; links and images using them lose the URL. */
const UNSAFE_URL = /^(javascript|vbscript|data):/i;
const URL_ATTRIBUTES = ['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href'];

/** Elements that make the HTML worth converting: without one, it is styled plain text. */
const STRUCTURE =
  'h1, h2, h3, h4, h5, h6, p, ul, ol, li, table, blockquote, a[href], img[src], strong, em, b, i';

function removeComments(doc: Document): void {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);
}

function unwrap(el: Element): void {
  el.replaceWith(...el.childNodes);
}

/** Removes event attributes; a link to a script URL keeps only its text, such an image goes. */
function stripAttributes(doc: Document): void {
  for (const el of [...doc.body.querySelectorAll('*')]) {
    let unsafe = false;
    for (const { name, value } of [...el.attributes]) {
      const lower = name.toLowerCase();
      // Browsers skip spaces and control characters inside a scheme ("java\tscript:").
      const url = value.replace(/[\s\p{Cc}]/gu, '');
      if (lower.startsWith('on')) el.removeAttribute(name);
      else if (URL_ATTRIBUTES.includes(lower) && UNSAFE_URL.test(url)) {
        el.removeAttribute(name);
        unsafe = true;
      }
    }
    if (unsafe && el.tagName === 'A') unwrap(el);
    else if (unsafe && el.tagName === 'IMG') el.remove();
  }
}

/** The value of one declaration in an inline style ("font-weight:700" gives "700"). */
function styleValue(el: Element, property: string): string {
  const style = el.getAttribute('style') ?? '';
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(style);
  return match ? match[1].trim().toLowerCase() : '';
}

/**
 * Google Docs wraps the whole selection in `<b id="docs-internal-guid-...">` (not bold) and
 * marks bold and italic with inline styles on spans; list items hold one `<p>` each.
 */
function normalizeGoogleDocs(doc: Document): void {
  for (const wrapper of doc.body.querySelectorAll('b[id^="docs-internal-guid"]')) unwrap(wrapper);
  for (const span of doc.body.querySelectorAll('span[style]')) {
    if (span.closest('h1, h2, h3, h4, h5, h6')) continue;
    const weight = styleValue(span, 'font-weight');
    const bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
    const italic = styleValue(span, 'font-style') === 'italic';
    let target: Element = span;
    for (const tag of [bold && 'strong', italic && 'em']) {
      if (!tag) continue;
      const wrap = doc.createElement(tag);
      target.replaceWith(wrap);
      wrap.append(target);
      target = wrap;
    }
  }
  for (const li of doc.body.querySelectorAll('li')) {
    const kids = [...li.children];
    if (kids.length === 1 && kids[0].tagName === 'P' && li.textContent === kids[0].textContent)
      unwrap(kids[0]);
  }
}

/**
 * Word puts list items in `<p style="mso-list:l0 level1 lfo1">` with the bullet or number as
 * text in a `mso-list:Ignore` span. Consecutive items of one list become one `<ul>` or `<ol>`
 * (nesting levels are flattened).
 */
function normalizeWordLists(doc: Document): void {
  let list: HTMLElement | null = null;
  let listId = '';
  for (const p of [...doc.body.querySelectorAll('p')]) {
    const id = /(?:^|;)\s*mso-list\s*:\s*(l\d+)/i.exec(p.getAttribute('style') ?? '')?.[1];
    if (!id) continue;
    const marker = [...p.querySelectorAll('span[style]')].find(
      (s) => styleValue(s, 'mso-list') === 'ignore',
    );
    const ordered = /^(\d+|[a-z]|[ivxlc]+)[.)]$/i.test(marker?.textContent?.trim() ?? '');
    marker?.remove();
    const continues = list !== null && listId === id && p.previousElementSibling === list;
    if (!continues || !list) {
      list = doc.createElement(ordered ? 'ol' : 'ul');
      listId = id;
      p.before(list);
    }
    const li = doc.createElement('li');
    li.append(...p.childNodes);
    list.append(li);
    p.remove();
  }
}

/** Parses clipboard HTML and removes what must never reach the draft. */
function cleanDocument(html: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.body.querySelectorAll(DROPPED)) el.remove();
  removeComments(doc);
  stripAttributes(doc);
  return doc;
}

/**
 * The clipboard HTML without scripts, styles, frames, comments, event attributes (`on*`) or
 * script URLs: the body's markup, ready for the HTML import.
 */
export function sanitizeHtml(html: string): string {
  return cleanDocument(html).body.innerHTML;
}

function convert(doc: Document): string {
  normalizeGoogleDocs(doc);
  normalizeWordLists(doc);
  return parseDraft(doc.body.innerHTML, 'html').markdown.trim();
}

/** Clipboard HTML as Markdown, through the engine's HTML import (`parseDraft(..., 'html')`). */
export function htmlToMarkdown(html: string): string {
  return convert(cleanDocument(html));
}

/**
 * What a rich-text paste inserts, or null to paste the plain text instead: when the HTML has
 * no document structure (Markdown copied from a code editor arrives as coloured spans, and
 * converting it would escape its `#` and `-`), or when nothing is left after cleaning.
 */
export function markdownFromClipboard(html: string): string | null {
  const doc = cleanDocument(html);
  if (!doc.body.querySelector(STRUCTURE)) return null;
  return convert(doc) || null;
}
