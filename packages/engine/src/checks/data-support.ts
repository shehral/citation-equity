import { EVIDENCE } from '../evidence';
import { suggestionId } from '../text';
import type { CheckId, Range, Suggestion } from '../types';

/** What a check decides about a suggestion; the id, check id and grade are filled in. */
export type SuggestionDraft = Omit<Suggestion, 'id' | 'checkId' | 'grade'>;

/**
 * Returns a builder of suggestions for one check run. Identical `before` texts get
 * increasing occurrence numbers, so ids are unique within the check and stable across runs.
 */
export function suggester(checkId: CheckId): (draft: SuggestionDraft) => Suggestion {
  const seen = new Map<string, number>();
  return (draft) => {
    const occurrence = seen.get(draft.before) ?? 0;
    seen.set(draft.before, occurrence + 1);
    return {
      id: suggestionId(checkId, draft.before, occurrence),
      checkId,
      grade: EVIDENCE[checkId].grade,
      ...draft,
    };
  };
}

/** `range` with trailing whitespace removed, so a section range ends at its last content. */
export function trimEnd(markdown: string, range: Range): Range {
  let end = range.end;
  while (end > range.start && /\s/.test(markdown[end - 1] ?? '')) end--;
  return { start: range.start, end };
}
