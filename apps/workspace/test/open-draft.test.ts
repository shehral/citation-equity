import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draftQuestionsFor, draftTextFor, isEmptyDraft } from '@/lib/open-draft';
import { initialQuestions } from '@/lib/questions';
import { getSample, MY_DRAFT_SLUG } from '@/lib/samples';
import { saveDraft, saveQuestions } from '@/lib/storage';
import { clearAll } from '@/lib/store';

const EXAMPLE = 'espresso-bitterness';

beforeEach(() => {
  window.localStorage.clear();
  clearAll();
});
afterEach(() => {
  clearAll();
  window.localStorage.clear();
});

describe('a draft as the draft view opens it', () => {
  it('reads the saved text, else the starting text: the example before, or nothing for My post', () => {
    expect(draftTextFor(MY_DRAFT_SLUG)).toBe('');
    expect(draftTextFor(EXAMPLE)).toBe(getSample(EXAMPLE).before);
    saveDraft(EXAMPLE, '# Edited\n\nThe author changed it.');
    expect(draftTextFor(EXAMPLE)).toBe('# Edited\n\nThe author changed it.');
    // An emptied draft stays empty: it does not fall back to the example.
    saveDraft(EXAMPLE, '');
    expect(draftTextFor(EXAMPLE)).toBe('');
  });

  it("reads the saved questions, else the example's pack, else none", () => {
    expect(draftQuestionsFor(MY_DRAFT_SLUG)).toEqual([]);
    expect(draftQuestionsFor(EXAMPLE)).toEqual(initialQuestions(getSample(EXAMPLE)));
    saveQuestions(EXAMPLE, []);
    expect(draftQuestionsFor(EXAMPLE)).toEqual([]);
  });
});

describe('isEmptyDraft (nothing to measure)', () => {
  it('is true for a blank draft and one with no words outside code, front matter and HTML', () => {
    for (const text of [
      '',
      '  \n ',
      '```\nnpm run build\n```\n',
      '---\ntitle: x\n---\n',
      '<div></div>',
    ])
      expect(isEmptyDraft(text), JSON.stringify(text)).toBe(true);
    for (const text of ['# Cold brew', 'One sentence of prose.', '- a list item'])
      expect(isEmptyDraft(text), JSON.stringify(text)).toBe(false);
  });
});
