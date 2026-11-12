// Content or name? A name test shows the model two pages with the same text under different site
// names, so the share of a citation gap that comes from the name can be told apart from the share
// that comes from the words. The design is the Small-Site Funnel Study's (Northeastern, Fall
// 2026): a small page a and a big page b in one set of sources, shown three ways.
// - shown: each page with its own URL (the prompt's `labels: 'shown'`).
// - hidden: no URL, and each page's mentions of either site name replaced with "this site".
// - swapped: a wears b's site (b's scheme and host, a's own path) and b wears a's, with the site
//   names in their text swapped too, so the text no longer gives the real site away.
// Pure TS, browser-safe; written for this project.
import type { SourceLabels } from './prompt';
import type { PackDocument } from './types';

export const NAME_CONDITIONS = ['shown', 'hidden', 'swapped'] as const;
export type NameCondition = (typeof NAME_CONDITIONS)[number];

/** One page of the pair: its docId among the sources, and the site name its text may mention. */
export interface NamePage {
  docId: string;
  /** The site's name as the page writes it ("Hivecraft Notes"); none when it never names itself. */
  brand?: string;
}

/** Two pages to compare: `a` is the small site's page (or the author's), `b` the big site's. */
export interface NamePair {
  a: NamePage;
  b: NamePage;
}

/** Said in place of a site name in the hidden condition. */
export const HIDDEN_NAME = 'this site';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word matches of any of `names`, longest first, ignoring case. */
function namePattern(names: string[]): RegExp | null {
  const kept = names.map((n) => n.trim()).filter((n) => n !== '');
  if (kept.length === 0) return null;
  const alternatives = [...new Set(kept)].sort((x, y) => y.length - x.length).map(escapeRegExp);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/** `text` with every mention of `brandA` and `brandB` swapped for the other, in one pass. */
export function swapBrands(text: string, brandA = '', brandB = ''): string {
  const a = brandA.trim();
  const b = brandB.trim();
  if (a === '' || b === '' || a.toLowerCase() === b.toLowerCase()) return text;
  const pattern = namePattern([a, b]);
  if (!pattern) return text;
  return text.replace(pattern, (m) => (m.toLowerCase() === a.toLowerCase() ? b : a));
}

/** `text` with every mention of `brands` replaced by HIDDEN_NAME. */
export function hideBrands(text: string, brands: string[]): string {
  const pattern = namePattern(brands);
  return pattern ? text.replace(pattern, HIDDEN_NAME) : text;
}

/**
 * The URL page `own` shows when it wears `partner`'s site: the partner's scheme and host with the
 * page's own path, query and fragment. Throws when either is not an http(s) URL.
 */
export function swappedUrl(own: string, partner: string): string {
  const parse = (u: string, which: string) => {
    let url: URL;
    try {
      url = new URL(u.trim());
    } catch {
      throw new TypeError(`The ${which} page needs an http(s) URL to swap, not "${u}".`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new TypeError(`The ${which} page needs an http(s) URL to swap, not "${u}".`);
    }
    return url;
  };
  const o = parse(own, 'first');
  const p = parse(partner, 'second');
  return `${p.protocol}//${p.host}${o.pathname}${o.search}${o.hash}`;
}

/**
 * The sources to show the model under one name condition, and the prompt labels to build them
 * with (`buildPrompt(query, sources, { labels })`). Only the pair's two pages change; the other
 * sources keep their text, and their URLs show or hide with the condition. Throws when a page of
 * the pair is not among `sources`, or when a shown or swapped condition lacks a page's URL.
 */
export function nameConditionSources(
  sources: readonly PackDocument[],
  condition: NameCondition,
  pair: NamePair,
): { sources: PackDocument[]; labels: SourceLabels } {
  const docA = sources.find((s) => s.docId === pair.a.docId);
  const docB = sources.find((s) => s.docId === pair.b.docId);
  if (!docA || !docB) {
    const missing = !docA ? pair.a.docId : pair.b.docId;
    throw new RangeError(`The pair's page "${missing}" is not among the sources.`);
  }
  if (condition !== 'hidden' && (!docA.url?.trim() || !docB.url?.trim())) {
    throw new TypeError(`The ${condition} condition needs a URL on both pages of the pair.`);
  }
  const brands = [pair.a.brand ?? '', pair.b.brand ?? ''];
  if (condition === 'shown') return { sources: [...sources], labels: 'shown' };
  if (condition === 'hidden') {
    const hide = (s: PackDocument): PackDocument => {
      const { url: _url, ...rest } = s;
      if (s.docId !== pair.a.docId && s.docId !== pair.b.docId) return rest;
      return { ...rest, title: hideBrands(s.title, brands), text: hideBrands(s.text, brands) };
    };
    return { sources: sources.map(hide), labels: 'hidden' };
  }
  const urlA = swappedUrl(docA.url ?? '', docB.url ?? '');
  const urlB = swappedUrl(docB.url ?? '', docA.url ?? '');
  const swap = (s: PackDocument): PackDocument => {
    if (s.docId !== pair.a.docId && s.docId !== pair.b.docId) return s;
    return {
      ...s,
      url: s.docId === pair.a.docId ? urlA : urlB,
      title: swapBrands(s.title, brands[0], brands[1]),
      text: swapBrands(s.text, brands[0], brands[1]),
    };
  };
  return { sources: sources.map(swap), labels: 'shown' };
}

/**
 * Citation rates of each text under each site name, from the shown and swapped conditions:
 * `aSmall` is text a under its own (small) site, `aBig` text a under b's site, and so on.
 */
export interface NameRates {
  aSmall: number;
  aBig: number;
  bSmall: number;
  bBig: number;
}

/**
 * The citation gap `aSmall - bBig` (what the shown condition sees), split into the part that comes
 * from the site name and the part that comes from the text. The split is the symmetric one of a
 * two-by-two design, so name + content equals the gap exactly:
 * name = -1/2 [(aBig - aSmall) + (bBig - bSmall)], content = 1/2 [(aSmall - bSmall) + (aBig - bBig)].
 * A negative name part means the small site's name costs it citations.
 */
export function nameContentSplit(r: NameRates): { gap: number; name: number; content: number } {
  return {
    gap: r.aSmall - r.bBig,
    name: -0.5 * (r.aBig - r.aSmall + (r.bBig - r.bSmall)),
    content: 0.5 * (r.aSmall - r.bSmall + (r.aBig - r.bBig)),
  };
}
