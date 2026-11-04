import { describe, expect, it } from 'vitest';
import {
  applySuggestion,
  mapApplied,
  mapRange,
  moveRange,
  paragraphAt,
  replacesMostOf,
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

describe('moveRange', () => {
  const md = '## Shot time\n\nGrind fine.\n';
  const sentence = { start: md.indexOf('Grind'), end: md.indexOf('fine.') + 'fine.'.length };
  /** The empty spot right after the heading, where a new paragraph would go. */
  const spot = { start: '## Shot time'.length, end: '## Shot time'.length };

  it('keeps a range on the same text and moves it through a change above it', () => {
    expect(moveRange(sentence, md, md)).toEqual(sentence);
    expect(moveRange(sentence, md, `Intro.\n\n${md}`)).toEqual({
      start: sentence.start + 8,
      end: sentence.end + 8,
    });
    expect(moveRange(sentence, md, `${md}More.\n`)).toEqual(sentence);
  });

  it('is null when the change touches the range, or only borders it', () => {
    expect(moveRange(sentence, md, md.replace('fine', 'finer'))).toBeNull();
    expect(moveRange(sentence, md, md.replace('Grind', 'So: Grind'))).toBeNull();
  });

  it('moves an empty range through a change above it or well below it', () => {
    expect(moveRange(spot, md, `Intro. ${md}`)).toEqual({
      start: spot.start + 7,
      end: spot.end + 7,
    });
    expect(moveRange(spot, md, md.replace('fine.', 'fine, always.'))).toEqual(spot);
  });

  it('counts the two characters on each side of an empty range as part of it', () => {
    // Typing at the spot, or changing the blank line a new paragraph there was set apart by.
    expect(moveRange(spot, md, md.replace('time\n', 'time, roughly\n'))).toBeNull();
    expect(moveRange(spot, md, md.replace('\n\nGrind', '\nGrind'))).toBeNull();
    expect(
      moveRange(spot, md, md.replace('\n\nGrind', '\n\nAbout 30 seconds.\n\nGrind')),
    ).toBeNull();
    expect(moveRange({ start: 0, end: 0 }, md, `Intro. ${md}`)).toBeNull();
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

describe('replacesMostOf', () => {
  it('is true for a change that replaces more than half of the draft, not for typing', () => {
    const draft = 'A'.repeat(100);
    expect(replacesMostOf(draft, `${draft}more`)).toBe(false);
    expect(replacesMostOf(draft, `${'A'.repeat(60)}B`)).toBe(false);
    expect(replacesMostOf(draft, 'Something pasted in its place')).toBe(true);
    expect(replacesMostOf(draft, '')).toBe(true);
    // An empty draft has nothing to replace.
    expect(replacesMostOf('', 'Pasted post')).toBe(false);
    expect(replacesMostOf('  \n', 'Pasted post')).toBe(false);
  });
});

describe('paragraphAt', () => {
  /** The draft with `text` inserted at `at` as paragraphAt words it. */
  const insert = (md: string, at: number, text: string) =>
    `${md.slice(0, at)}${paragraphAt(md, at, text)}${md.slice(at)}`;

  it('puts a blank line between a heading and the text, and keeps the one before the next heading', () => {
    const md = '# Espresso\n\n## How long should a shot take?\n\n## Grind\n\nGrind fine.\n';
    const at = md.indexOf('?') + 1;
    expect(insert(md, at, 'About half a minute.')).toBe(
      '# Espresso\n\n## How long should a shot take?\n\nAbout half a minute.\n\n## Grind\n\nGrind fine.\n',
    );
  });

  it('adds a blank line after the text when the next line follows at once', () => {
    const md = '## Shot time\n- 25 seconds\n';
    const at = md.indexOf('\n');
    expect(insert(md, at, 'About half a minute.')).toBe(
      '## Shot time\n\nAbout half a minute.\n\n- 25 seconds\n',
    );
  });

  it('ends the draft on the text when the spot is at its end', () => {
    expect(insert('## Shot time\n', 12, 'About half a minute.')).toBe(
      '## Shot time\n\nAbout half a minute.\n',
    );
    expect(insert('## Shot time', 12, 'About half a minute.')).toBe(
      '## Shot time\n\nAbout half a minute.',
    );
  });

  it('splits a paragraph rather than run the text into it', () => {
    const md = 'Shots vary. Grind matters.\n';
    const at = 'Shots vary.'.length;
    expect(insert(md, at, 'About half a minute.')).toBe(
      'Shots vary.\n\nAbout half a minute.\n\n Grind matters.\n',
    );
  });

  it('adds nothing where a blank line already stands, and trims the text', () => {
    const md = '## Shot time\n\n';
    expect(paragraphAt(md, md.length, '  About half a minute.\n')).toBe('About half a minute.');
    expect(paragraphAt('Next.\n', 0, 'First.')).toBe('First.\n\n');
  });
});
