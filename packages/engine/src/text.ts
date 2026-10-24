import type { CheckId, Range } from './types';

export interface Sentence {
  text: string;
  /**
   * Prose-only copy of `text`, the same length, so an index into `plain` is an
   * index into `text`. Characters that are not prose (inline code, inline HTML,
   * images, link destinations and titles, autolinked URLs, emphasis markers,
   * quote markers) and line breaks are spaces. Checks that look for numbers,
   * quotes or phrases should read `plain`.
   */
  plain: string;
  /** Offsets into the Markdown source; `markdown.slice(range.start, range.end) === text`. */
  range: Range;
}

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' });

/** Line-leading blockquote markers on continuation lines (`\n> `, `\n  > > `). */
const QUOTE_MARKERS = /(?<=[\r\n])[ \t]*(?:>[ \t]?)+/g;

/**
 * `s` with line breaks and continuation-line quote markers turned into spaces,
 * keeping its length. Intl.Segmenter treats a line feed as a hard sentence
 * break, so wrapped Markdown lines must be joined before segmenting.
 */
export function joinLines(s: string): string {
  return s.replace(QUOTE_MARKERS, (m) => ' '.repeat(m.length)).replace(/[\r\n]/g, ' ');
}

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

/**
 * Abbreviations after which Intl.Segmenter wrongly ends a sentence ("Dr. Jane Doe says"):
 * honorifics and "vs.", "e.g.", "i.e.", "approx." never end one here.
 */
const TITLE_ABBREVIATION =
  /(?:^|[^\p{L}\p{N}.])(?:Dr|Prof|Mr|Mrs|Ms|Mx|St|[Vv]s|[Ee]\.g|[Ii]\.e|[Aa]pprox)\.$/u;
/** "No. 5", "Fig. 2": a label abbreviation keeps the sentence open only before a number. */
const NUMBER_ABBREVIATION = /(?:^|[^\p{L}\p{N}.])(?:No|Fig)\.$/u;
/** "Jr.", "Sr." and "etc." may end a sentence; they keep it open only before a lowercase word. */
const TRAILING_ABBREVIATION = /(?:^|[^\p{L}\p{N}.])(?:Jr|Sr|etc)\.$/u;

/** True when a sentence segment ends in an abbreviation and `next` continues the sentence. */
function endsInAbbreviation(content: string, next: string): boolean {
  if (TITLE_ABBREVIATION.test(content)) return true;
  if (NUMBER_ABBREVIATION.test(content)) return /^\p{N}/u.test(next);
  return TRAILING_ABBREVIATION.test(content) && /^[\p{Ll}\p{N},;]/u.test(next);
}

/**
 * Splits `text` into trimmed sentences. `offset` is where `text` starts in the
 * Markdown source, so each sentence range points into the source. `plain` is
 * an optional prose-only mask of `text` of the same length (see
 * `Sentence.plain`); segmentation runs on it, so a period inside inline code
 * or a URL never ends a sentence. Soft line breaks and quote markers never
 * split a sentence. Text whose mask is all blank (an image alone) has no
 * sentences.
 */
export function splitSentences(text: string, offset: number, plain: string = text): Sentence[] {
  if (plain.length !== text.length) throw new RangeError('plain must have the length of text');
  const layout = joinLines(text);
  const seg = joinLines(plain);

  // A cut sits right after the last prose character of each segment, so masked
  // text that opens a sentence (`npm` in "Done. `npm` is a tool.") stays with it.
  const cuts: number[] = [];
  const segments = [...sentenceSegmenter.segment(seg)];
  for (const [i, { segment, index }] of segments.entries()) {
    const content = segment.trimEnd();
    if (content.trim() === '') continue;
    const next = segments.slice(i + 1).find((s) => s.segment.trim() !== '');
    if (next && endsInAbbreviation(content, next.segment.trimStart())) continue;
    cuts.push(index + content.length);
  }
  if (cuts.length === 0) return [];
  cuts[cuts.length - 1] = text.length;

  const sentences: Sentence[] = [];
  let from = 0;
  for (const cut of cuts) {
    let start = from;
    let end = cut;
    while (start < end && isSpace(layout[start])) start++;
    while (end > start && isSpace(layout[end - 1])) end--;
    from = cut;
    if (start === end) continue;
    sentences.push({
      text: text.slice(start, end),
      plain: seg.slice(start, end),
      range: { start: offset + start, end: offset + end },
    });
  }
  return sentences;
}

/** Counts word-like segments (words and numbers; punctuation and symbols do not count). */
export function countWords(text: string): number {
  let count = 0;
  for (const { isWordLike } of wordSegmenter.segment(text)) if (isWordLike) count++;
  return count;
}

/**
 * Stable suggestion id: 32-bit FNV-1a over the UTF-16 code units of
 * `${checkId}|${before}|${occurrence}`, as 8 lowercase hex digits. `occurrence`
 * tells apart identical `before` texts within one check.
 */
export function suggestionId(checkId: CheckId, before: string, occurrence: number): string {
  const key = `${checkId}|${before}|${occurrence}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
