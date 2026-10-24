import { describe, expect, it } from 'vitest';
import {
  applySuggestion,
  mapApplied,
  mapRange,
  revertSuggestion,
  sectionAround,
  textChange,
} from '@/lib/apply';
import { DRAFT, HEADING_EDIT, QUOTE_ADVISORY } from './fixtures';

describe('applySuggestion', () => {
  it('replaces exactly the suggestion range with `after`', () => {
    const out = applySuggestion(DRAFT, HEADING_EDIT);
    expect(out).toEqual({
      ok: true,
      markdown: '# Espresso\n\n## Why does espresso turn bitter?\n\nBitter shots run long.\n',
    });
  });

  it('refuses as stale when one character inside the range changed', () => {
    const at = HEADING_EDIT.range.start + 5;
    const edited = `${DRAFT.slice(0, at)}X${DRAFT.slice(at + 1)}`;
    expect(applySuggestion(edited, HEADING_EDIT)).toEqual({ ok: false, reason: 'stale' });
  });

  it('refuses as stale when text before the range shifted it', () => {
    expect(applySuggestion(`Intro.\n${DRAFT}`, HEADING_EDIT)).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('refuses a suggestion without `after` and a range past the end', () => {
    expect(applySuggestion(DRAFT, QUOTE_ADVISORY)).toEqual({ ok: false, reason: 'stale' });
    const shortDraft = DRAFT.slice(0, HEADING_EDIT.range.end - 1);
    expect(applySuggestion(shortDraft, HEADING_EDIT)).toEqual({ ok: false, reason: 'stale' });
  });
});

describe('revertSuggestion', () => {
  it('puts `before` back where an applied edit sits, and is stale once that text is edited', () => {
    const applied = applySuggestion(DRAFT, HEADING_EDIT);
    if (!applied.ok) throw new Error('apply failed');
    expect(revertSuggestion(applied.markdown, HEADING_EDIT)).toEqual({ ok: true, markdown: DRAFT });
    const edited = applied.markdown.replace('turn bitter?', 'turn sour?');
    expect(revertSuggestion(edited, HEADING_EDIT)).toEqual({ ok: false, reason: 'stale' });
  });
});

describe('textChange and mapRange', () => {
  it('finds the one replacement between two texts', () => {
    expect(textChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' });
    expect(textChange('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' });
  });

  it('shifts a range for a change before it and keeps it for a change after it', () => {
    const range = { start: 10, end: 20 };
    expect(mapRange(range, { from: 0, to: 0, insert: 'xyz' }, 'touches')).toEqual({
      start: 13,
      end: 23,
    });
    expect(mapRange(range, { from: 25, to: 30, insert: '' }, 'touches')).toEqual(range);
    expect(mapRange(range, { from: 12, to: 13, insert: 'q' }, 'outside')).toBeNull();
  });

  it('counts a change that only borders the range as touching it for Apply, not for Undo', () => {
    const range = { start: 10, end: 20 };
    const atEnd = { from: 20, to: 20, insert: ' fast' };
    expect(mapRange(range, atEnd, 'touches')).toBeNull();
    expect(mapRange(range, atEnd, 'outside')).toEqual(range);
    const atStart = { from: 10, to: 10, insert: 'x' };
    expect(mapRange(range, atStart, 'touches')).toBeNull();
    expect(mapRange(range, atStart, 'outside')).toEqual({ start: 11, end: 21 });
  });
});

describe('Undo after later edits (applied ranges stay current)', () => {
  const md =
    '# Coffee\n\n## Why espresso turns bitter\n\nText.\n\n## How grind size works\n\nMore.\n';
  const edit = (heading: string, id: string) => {
    const before = `## ${heading}`;
    const start = md.indexOf(before);
    return {
      ...HEADING_EDIT,
      id,
      range: { start, end: start + before.length },
      before,
      after: `${before}?`,
    };
  };
  /** Applies `s`, mapping every earlier applied edit through the change. */
  function step(text: string, applied: (typeof HEADING_EDIT)[], s: typeof HEADING_EDIT) {
    const out = applySuggestion(text, s);
    if (!out.ok) throw new Error('apply failed');
    const change = textChange(text, out.markdown);
    return { text: out.markdown, applied: [...applied.map((a) => mapApplied(a, change)), s] };
  }

  it('undoes the lower of two edits applied in reverse document order', () => {
    const upper = edit('Why espresso turns bitter', 'e-upper');
    const lower = edit('How grind size works', 'e-lower');
    let state = step(md, [], lower);
    state = step(state.text, state.applied, upper);
    const lowerNow = state.applied.find((a) => a.id === 'e-lower');
    if (!lowerNow) throw new Error('lost');
    // The upper edit added one character above it, so its range moved by one.
    expect(lowerNow.range.start).toBe(lower.range.start + 1);
    const undone = revertSuggestion(state.text, lowerNow);
    expect(undone).toEqual({
      ok: true,
      markdown: md.replace('## Why espresso turns bitter', '## Why espresso turns bitter?'),
    });
    // The stored, unmapped copy would have failed as stale.
    expect(revertSuggestion(state.text, lower)).toEqual({ ok: false, reason: 'stale' });
  });

  it('undoes an edit after the author typed, just before it, the character it starts with', () => {
    const upper = edit('Why espresso turns bitter', 'e-upper');
    const state = step(md, [], upper);
    // "#" typed right before "## Why ...?": the applied text is intact, one character later.
    const typed = `${state.text.slice(0, upper.range.start)}#${state.text.slice(upper.range.start)}`;
    const [moved] = state.applied.map((a) => mapApplied(a, textChange(state.text, typed)));
    if (!moved) throw new Error('lost');
    expect(moved.range.start).toBe(upper.range.start + 1);
    expect(revertSuggestion(typed, moved)).toEqual({
      ok: true,
      markdown: md.replace('## Why espresso turns bitter', '### Why espresso turns bitter'),
    });
  });

  it('undoes an edit after the author typed above it, and stays stale when its text was edited', () => {
    const upper = edit('Why espresso turns bitter', 'e-upper');
    const state = step(md, [], upper);
    const typed = `Intro paragraph.\n\n${state.text}`;
    const [moved] = state.applied.map((a) => mapApplied(a, textChange(state.text, typed)));
    if (!moved) throw new Error('lost');
    expect(revertSuggestion(typed, moved)).toEqual({
      ok: true,
      markdown: `Intro paragraph.\n\n${md}`,
    });
    const edited = typed.replace('bitter?', 'sour?');
    const [touched] = [moved].map((a) => mapApplied(a, textChange(typed, edited)));
    if (!touched) throw new Error('lost');
    expect(revertSuggestion(edited, touched)).toEqual({ ok: false, reason: 'stale' });
  });
});

describe('sectionAround', () => {
  const md = '# Title\n\nIntro.\n\n## One\n\nBody one.\n\n## Two\n\nBody two.\n';
  it('spans from the heading at or above the range to the next heading', () => {
    const start = md.indexOf('Body one');
    const { start: s, end: e } = sectionAround(md, { start, end: start + 4 });
    expect(md.slice(s, e)).toBe('## One\n\nBody one.\n\n');
  });
  it('starts at a heading range itself and runs to the end of the draft', () => {
    const start = md.indexOf('## Two');
    const { start: s, end: e } = sectionAround(md, { start, end: start + 6 });
    expect(md.slice(s, e)).toBe('## Two\n\nBody two.\n');
  });
});
