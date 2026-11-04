import type { Range, Suggestion } from '@citation-equity/engine';

export type ApplyOutcome = { ok: true; markdown: string } | { ok: false; reason: 'stale' };

/**
 * Replaces the suggestion's range with its `after` text, but only when the
 * range still holds exactly `before`. Anything else (the author edited inside
 * the range, text before it moved it, or there is no `after`) is `stale`, and
 * the draft is left as it is.
 */
export function applySuggestion(markdown: string, s: Suggestion): ApplyOutcome {
  const { start, end } = s.range;
  if (s.after === undefined || start < 0 || end > markdown.length || start > end) {
    return { ok: false, reason: 'stale' };
  }
  if (markdown.slice(start, end) !== s.before) return { ok: false, reason: 'stale' };
  return { ok: true, markdown: markdown.slice(0, start) + s.after + markdown.slice(end) };
}

/**
 * The inverse of an applied edit: puts `before` back where `after` now sits,
 * at `s.range.start` (keep it current with `mapApplied`). Stale when the
 * applied text has since been edited.
 */
export function revertSuggestion(markdown: string, s: Suggestion): ApplyOutcome {
  if (s.after === undefined) return { ok: false, reason: 'stale' };
  return applySuggestion(markdown, {
    ...s,
    range: { start: s.range.start, end: s.range.start + s.after.length },
    before: s.after,
    after: s.before,
  });
}

/** One replacement: `from`..`to` of the old text became `insert`. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
  /**
   * For a pure insertion or deletion inside a run of repeated text, the same change at the
   * leftmost place it could have been made: typing "#" before "## Why" is read as an insert
   * after "##", but it is just as much an insert before it. Absent when there is no choice.
   */
  leftmost?: { from: number; to: number; insert: string };
}

/**
 * The smallest single replacement that turns `before` into `after` (common prefix and suffix
 * kept), with its leftmost equivalent when it is a pure insertion or deletion that could sit
 * further left.
 */
export function textChange(before: string, after: string): TextChange {
  let from = 0;
  const max = Math.min(before.length, after.length);
  while (from < max && before.charCodeAt(from) === after.charCodeAt(from)) from++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > from &&
    endAfter > from &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore--;
    endAfter--;
  }
  const to = endBefore;
  const insert = after.slice(from, endAfter);
  let left = from;
  if (to === from && insert !== '') {
    while (left > 0 && before.charCodeAt(left - 1) === after.charCodeAt(left - 1 + insert.length))
      left--;
  } else if (insert === '' && to > from) {
    while (left > 0 && before.charCodeAt(left - 1) === before.charCodeAt(left - 1 + to - from))
      left--;
  }
  const change: TextChange = { from, to, insert };
  if (left < from) {
    change.leftmost = {
      from: left,
      to: left + (to - from),
      insert: after.slice(left, left + insert.length),
    };
  }
  return change;
}

/**
 * Where `range` sits after `change`, or null when the change touches it. With
 * `adjacent: 'touches'` a change that only borders the range (typing right
 * after a heading, say) counts as touching it, which is what Apply needs: the
 * suggestion was written for the text as it stood. With `'outside'` a change
 * that borders it leaves it alone, which is what Undo needs.
 */
export function mapRange(
  range: Range,
  change: TextChange,
  adjacent: 'touches' | 'outside',
): Range | null {
  const { from, to, insert } = change;
  if (from === to && insert === '') return range;
  const delta = insert.length - (to - from);
  const touches = adjacent === 'touches';
  if (touches ? to < range.start : to <= range.start) {
    return { start: range.start + delta, end: range.end + delta };
  }
  if (touches ? from > range.end : from >= range.end) return range;
  return null;
}

/**
 * Where `range`, measured on the text `from`, sits in the text `to`; null when the change between
 * them touches it, or only borders it (mapRange's `'touches'`, what Apply needs). An empty range,
 * a spot to write new text at, has no text of its own for Apply to check, so the two characters
 * on each side of it count as part of it: typing at the spot, or changing the blank lines that set
 * a new paragraph there apart (see paragraphAt), leaves it out of date too.
 */
export function moveRange(range: Range, from: string, to: string): Range | null {
  if (from === to) return range;
  const probe =
    range.start === range.end
      ? { start: Math.max(0, range.start - 2), end: Math.min(from.length, range.end + 2) }
      : range;
  const moved = mapRange(probe, textChange(from, to), 'touches');
  if (!moved) return null;
  const shift = moved.start - probe.start;
  return { start: range.start + shift, end: range.end + shift };
}

/**
 * An applied edit, kept current through a change to the draft: its range
 * starts where its `after` text now sits. Left as it was when the change
 * touches that text, so Undo then reports it as edited. A change that could
 * equally have been made further left (see TextChange.leftmost) is read there
 * when that keeps it outside the applied text.
 */
export function mapApplied(s: Suggestion, change: TextChange): Suggestion {
  if (s.after === undefined) return s;
  const at = { start: s.range.start, end: s.range.start + s.after.length };
  const mapped =
    mapRange(at, change, 'outside') ??
    (change.leftmost ? mapRange(at, change.leftmost, 'outside') : null);
  if (!mapped || mapped.start === s.range.start) return s;
  const shift = mapped.start - s.range.start;
  return { ...s, range: { start: s.range.start + shift, end: s.range.end + shift } };
}

/**
 * True when one change replaces more than half of the previous draft: a paste over most of the
 * text, which makes it another draft. Typing never does; an empty draft has nothing to replace.
 */
export function replacesMostOf(prev: string, next: string): boolean {
  if (prev.trim() === '') return false;
  const change = textChange(prev, next);
  return change.to - change.from > prev.length / 2;
}

/**
 * `text`, trimmed, with the blank lines it needs to stand as a paragraph of its own when it is
 * inserted at `at` in `markdown` (an empty range: the spot right after a heading, say). Without
 * them the text would join the heading's line or run into the paragraph beside it. Nothing is
 * added where a blank line, or the start or end of the draft, already stands.
 */
export function paragraphAt(markdown: string, at: number, text: string): string {
  const before = markdown.slice(0, at);
  const after = markdown.slice(at);
  const lead =
    before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail =
    after.trim() === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return `${lead}${text.trim()}${trail}`;
}

const HEADING_LINE = /^#{1,6}[ \t]/;

/**
 * The section around a range: from the heading line at or above it to the
 * line before the next heading below it (or the draft's start and end). Used
 * to keep the before/after preview short.
 */
export function sectionAround(markdown: string, range: { start: number; end: number }) {
  const lines: { start: number; heading: boolean }[] = [];
  let offset = 0;
  for (const line of markdown.split('\n')) {
    lines.push({ start: offset, heading: HEADING_LINE.test(line) });
    offset += line.length + 1;
  }
  let start = 0;
  let end = markdown.length;
  for (const line of lines) {
    if (line.heading && line.start <= range.start) start = line.start;
    if (line.heading && line.start >= range.end) {
      end = line.start;
      break;
    }
  }
  return { start, end };
}
