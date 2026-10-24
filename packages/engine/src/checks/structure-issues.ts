import { EVIDENCE } from '../evidence';
import type { Artifacts, Paragraph } from '../gather';
import { countWords, suggestionId } from '../text';
import type { CheckId, Finding, Range, Suggestion } from '../types';

/** One problem a check found: a finding plus its suggestion, anchored on `range`. */
export interface Issue {
  range: Range;
  /** What is wrong with this span (the finding's message). */
  message: string;
  title: string;
  rationale: string;
  /** Replacement text; present only for a deterministic, safe edit. */
  after?: string;
}

/**
 * Collects a check's findings and suggestions. Each issue yields one finding
 * and one suggestion with the same range; `before` is the exact source slice,
 * and the suggestion id counts earlier issues with the same `before` so
 * identical spans get distinct, stable ids.
 */
export function issueCollector(checkId: CheckId, markdown: string) {
  const findings: Finding[] = [];
  const suggestions: Suggestion[] = [];
  const seen = new Map<string, number>();
  const grade = EVIDENCE[checkId].grade;
  return {
    findings,
    suggestions,
    add({ range, message, title, rationale, after }: Issue): void {
      const before = markdown.slice(range.start, range.end);
      const occurrence = seen.get(before) ?? 0;
      seen.set(before, occurrence + 1);
      findings.push({ checkId, range, message });
      suggestions.push({
        id: suggestionId(checkId, before, occurrence),
        checkId,
        kind: after === undefined ? 'advisory' : 'edit',
        range,
        before,
        ...(after === undefined ? {} : { after }),
        title,
        rationale,
        grade,
      });
    },
  };
}

/**
 * A body paragraph with words: not inside a list item, a blockquote or a footnote definition,
 * not an image alone.
 */
export const isProse = (p: Paragraph): boolean =>
  !p.inListItem && !p.inBlockquote && !p.inFootnote && countWords(p.plain) > 0;

/** `n word` or `n words`. */
export const words = (n: number): string => `${n} word${n === 1 ? '' : 's'}`;

/**
 * Where draft-wide advice anchors: the draft's first heading, list or table, or the first
 * sentence of its first paragraph, so the advice keeps its id while the text below changes.
 */
export function topOfDraft(a: Artifacts): Range {
  const lead = a.paragraphs[0];
  const firsts = [
    a.headings[0]?.range,
    lead ? (lead.sentences[0]?.range ?? lead.range) : undefined,
    a.lists[0]?.range,
    a.tables[0]?.range,
  ].flatMap((r) => (r ? [r] : []));
  return firsts.sort((x, y) => x.start - y.start)[0] ?? { start: 0, end: 0 };
}
