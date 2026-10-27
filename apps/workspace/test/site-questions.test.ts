import type { ImportedQuery } from '@citation-equity/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorQuestionTexts, MAX_QUESTIONS } from '@/lib/questions';
import { MY_DRAFT_SLUG } from '@/lib/samples';
import {
  addToDraft,
  EMPTY_SITE_INPUT,
  getSiteInput,
  IMPORT_KEEP,
  keepImported,
  setSiteInput,
  subscribeSiteInput,
} from '@/lib/site-questions';
import { loadQuestions, saveQuestions } from '@/lib/storage';
import { clearAll, getSummary, setActiveSlot } from '@/lib/store';

const KEY = 'ce:v1:site-questions';
const INPUT = {
  keywords: 'espresso bitter\nespresso shot time, 1900',
  imported: {
    name: 'Queries.csv',
    queries: [
      { text: 'espresso beans', source: 'search-console', impressions: 1500 },
    ] as ImportedQuery[],
  },
  suggested: ['Is crema a sign of fresh beans?'],
};

/** Makes every localStorage access throw, as a private window or blocked site data does. */
function blockStorage() {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });
}

beforeEach(() => {
  window.localStorage.clear();
  clearAll();
});
afterEach(() => {
  vi.restoreAllMocks();
  clearAll();
  window.localStorage.clear();
});

describe('the site question list in this browser', () => {
  it('starts empty, and round-trips through localStorage under the app prefix', () => {
    expect(getSiteInput()).toEqual(EMPTY_SITE_INPUT);
    setSiteInput(INPUT);
    expect(getSiteInput()).toEqual(INPUT);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? 'null')).toEqual(INPUT);
  });

  it('returns the same object while nothing changed, and notifies on a change', () => {
    const listener = vi.fn();
    const stop = subscribeSiteInput(listener);
    setSiteInput(INPUT);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSiteInput()).toBe(getSiteInput());
    stop();
    setSiteInput(EMPTY_SITE_INPUT);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reads an unreadable or wrong-shaped stored value as empty', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(getSiteInput()).toEqual(EMPTY_SITE_INPUT);
    window.localStorage.setItem(KEY, JSON.stringify({ keywords: 3, suggested: 'no' }));
    expect(getSiteInput()).toEqual(EMPTY_SITE_INPUT);
  });

  it('works with storage blocked: the list lasts in memory and nothing throws', () => {
    blockStorage();
    expect(getSiteInput()).toEqual(EMPTY_SITE_INPUT);
    expect(() => setSiteInput(INPUT)).not.toThrow();
    expect(getSiteInput()).toEqual(INPUT);
  });

  it('is removed by Clear my data, from storage and from memory, and tells listeners', () => {
    setSiteInput(INPUT);
    const listener = vi.fn();
    subscribeSiteInput(listener);
    clearAll();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(getSiteInput()).toEqual(EMPTY_SITE_INPUT);
    expect(listener).toHaveBeenCalled();
  });

  it(`keeps the top ${IMPORT_KEEP} imported queries, by rank`, () => {
    const queries: ImportedQuery[] = Array.from({ length: IMPORT_KEEP + 50 }, (_, i) => ({
      text: `espresso query ${i}`,
      source: 'search-console',
      impressions: i,
    }));
    const kept = keepImported(queries);
    expect(kept).toHaveLength(IMPORT_KEEP);
    expect(kept[0]?.impressions).toBe(IMPORT_KEEP + 49);
  });
});

describe('addToDraft (Use in my draft)', () => {
  it("adds the question to the active draft's reader questions as the author's own", () => {
    expect(addToDraft({ text: 'Why is espresso bitter?', source: 'keywords' })).toEqual({
      result: 'added',
      example: false,
      // My post has no text yet: the view says to add some to see Reader questions.
      empty: true,
    });
    const saved = loadQuestions(MY_DRAFT_SLUG) ?? [];
    expect(saved).toEqual([{ text: 'Why is espresso bitter?', source: 'keywords' }]);
    expect(authorQuestionTexts(saved)).toEqual(['Why is espresso bitter?']);
  });

  it('keeps an imported query labelled with its export', () => {
    addToDraft({ text: 'What are espresso beans?', source: 'search-console' });
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([
      { text: 'What are espresso beans?', source: 'search-console' },
    ]);
  });

  it('adds to the example when the example is the open draft, and updates its tile', () => {
    setActiveSlot('espresso-bitterness');
    const before = loadQuestions('espresso-bitterness');
    expect(before).toBeNull();
    expect(addToDraft({ text: 'What is espresso shot time?', source: 'keywords' })).toEqual({
      result: 'added',
      example: true,
      empty: false,
    });
    const saved = loadQuestions('espresso-bitterness') ?? [];
    // The example's own pack questions stay, and the new one comes after them.
    expect(saved.length).toBeGreaterThan(1);
    expect(saved.at(-1)).toEqual({ text: 'What is espresso shot time?', source: 'keywords' });
    expect(getSummary('draft')?.slot).toBe('espresso-bitterness');
  });

  it('says so when the question is already there, or the draft holds the most it can', () => {
    addToDraft({ text: 'Why is espresso bitter?', source: 'keywords' });
    expect(addToDraft({ text: 'why is espresso bitter', source: 'keywords' }).result).toBe(
      'already',
    );
    saveQuestions(
      MY_DRAFT_SLUG,
      Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ text: `Question ${i}?`, source: 'user' })),
    );
    expect(addToDraft({ text: 'What is crema?', source: 'keywords' }).result).toBe('full');
    expect(loadQuestions(MY_DRAFT_SLUG)).toHaveLength(MAX_QUESTIONS);
  });

  it('works with storage blocked', () => {
    blockStorage();
    expect(addToDraft({ text: 'Why is espresso bitter?', source: 'keywords' }).result).toBe(
      'added',
    );
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([
      { text: 'Why is espresso bitter?', source: 'keywords' },
    ]);
  });
});
