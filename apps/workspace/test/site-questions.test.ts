import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { type ImportedQuery, siteQuestions } from '@citation-equity/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inputKindOf, MAX_QUESTIONS } from '@/lib/questions';
import { MY_DRAFT_SLUG } from '@/lib/samples';
import {
  addToDraft,
  draftSourceOf,
  EMPTY_SITE_INPUT,
  getSiteInput,
  IMPORT_KEEP,
  keepImported,
  openDraftQuestions,
  removeFromDraft,
  setSiteInput,
  siteQuestionsOf,
  subscribeSiteInput,
} from '@/lib/site-questions';
import { loadQuestions, saveDraft, saveQuestions } from '@/lib/storage';
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

/** Every app source file (app/, components/, lib/), relative to the app root, with "/" between parts. */
function appSources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.next', 'out', 'generated'].includes(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) out.push(relative(root, path).split(sep).join('/'));
    }
  };
  for (const dir of ['app', 'components', 'lib']) walk(join(root, dir));
  return out;
}

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

describe('siteQuestionsOf (the home list, built in one place for every view)', () => {
  it('builds the list from every stored field: keywords, imported queries and suggestions', () => {
    const list = siteQuestionsOf(INPUT);
    expect(list).toEqual(
      siteQuestions({
        keywords: INPUT.keywords,
        queries: INPUT.imported.queries,
        suggested: INPUT.suggested,
      }),
    );
    expect(list).toHaveLength(4);
    expect(new Set(list.map((q) => q.source))).toEqual(
      new Set(['keywords', 'search-console', 'local-model']),
    );
  });

  it('reads no import as no imported queries, and the empty input as an empty list', () => {
    expect(siteQuestionsOf({ ...INPUT, imported: null })).toEqual(
      siteQuestions({ keywords: INPUT.keywords, suggested: INPUT.suggested }),
    );
    expect(siteQuestionsOf(EMPTY_SITE_INPUT)).toEqual([]);
  });

  it("is the only builder: no other app file uses the engine's siteQuestions", () => {
    const root = join(__dirname, '..');
    const others = appSources(root).filter(
      (f) =>
        f !== 'lib/site-questions.ts' &&
        /\bsiteQuestions\b/.test(readFileSync(join(root, f), 'utf8')),
    );
    expect(others, 'build the list with siteQuestionsOf from lib/site-questions.ts').toEqual([]);
  });
});

describe('openDraftQuestions (what the ticks are read against)', () => {
  it("is the open draft's list: its saved questions, else the example's pack, else none", () => {
    expect(openDraftQuestions()).toEqual([]);
    setActiveSlot('espresso-bitterness');
    expect(openDraftQuestions().map((q) => q.source)).toEqual([
      'sample-pack',
      'sample-pack',
      'sample-pack',
      'sample-pack',
    ]);
    saveQuestions('espresso-bitterness', [{ text: 'Is crema good?', source: 'user' }]);
    expect(openDraftQuestions()).toEqual([{ text: 'Is crema good?', source: 'user' }]);
  });

  it('is what a tick adds to and an untick removes from', () => {
    setActiveSlot('espresso-bitterness');
    const first = openDraftQuestions()[0]?.text ?? '';
    expect(removeFromDraft(first)).toBe(true);
    expect(openDraftQuestions().map((q) => q.text)).not.toContain(first);
    addToDraft({ text: first, source: 'keywords', template: 'as-written' });
    expect(openDraftQuestions().at(-1)).toEqual({
      text: first,
      source: 'keywords',
      template: 'as-written',
    });
  });

  it("is read in one place: no app file keeps its own copy of a draft's fallback text or list", () => {
    const root = join(__dirname, '..');
    const copies = appSources(root).filter(
      (f) =>
        f !== 'lib/open-draft.ts' &&
        /\?\?\s*(startingText|initialQuestions)\(/.test(readFileSync(join(root, f), 'utf8')),
    );
    expect(
      copies,
      'read them with draftTextFor and draftQuestionsFor from lib/open-draft.ts',
    ).toEqual([]);
  });
});

describe('addToDraft (ticking a question)', () => {
  it("adds the question to the active draft's reader questions, with its source", () => {
    expect(addToDraft({ text: 'Why is espresso bitter?', source: 'keywords' })).toEqual({
      result: 'added',
      example: false,
      // My post has no text yet: the view says to add some to see Reader questions.
      empty: true,
    });
    const saved = loadQuestions(MY_DRAFT_SLUG) ?? [];
    expect(saved).toEqual([{ text: 'Why is espresso bitter?', source: 'keywords' }]);
    // A home-list question with no template reads as a keyword guess.
    expect(saved.map(inputKindOf)).toEqual(['keyword']);
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

  it("stores the question's template, which sets its input kind", () => {
    addToDraft({ text: 'How to dial in espresso?', source: 'keywords', template: 'how-to' });
    addToDraft({ text: 'Why is my espresso sour?', source: 'keywords', template: 'as-written' });
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([
      { text: 'How to dial in espresso?', source: 'keywords', template: 'how-to' },
      { text: 'Why is my espresso sour?', source: 'keywords', template: 'as-written' },
    ]);
  });

  it("refuses a repeat and a full draft without touching the draft's list", () => {
    saveQuestions(
      MY_DRAFT_SLUG,
      Array.from({ length: MAX_QUESTIONS - 1 }, (_, i) => ({
        text: `Question ${i}?`,
        source: 'user' as const,
      })),
    );
    expect(addToDraft({ text: 'question 0', source: 'keywords', template: 'kept' }).result).toBe(
      'already',
    );
    expect(addToDraft({ text: 'Last one?', source: 'keywords', template: 'as-written' })).toEqual({
      result: 'added',
      example: false,
      empty: true,
    });
    const full = loadQuestions(MY_DRAFT_SLUG);
    expect(addToDraft({ text: 'One more?', source: 'keywords', template: 'as-written' })).toEqual({
      result: 'full',
      example: false,
      empty: true,
    });
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual(full);
  });

  it('updates the draft summary as questions are added', () => {
    saveDraft(MY_DRAFT_SLUG, '# Bitter espresso\n\nEspresso turns bitter when it runs too long.\n');
    addToDraft({ text: 'Why is espresso bitter?', source: 'keywords', template: 'as-written' });
    expect(getSummary('draft')).toMatchObject({ slot: 'my-post', total: 1, fromPage: false });
    addToDraft({ text: 'How long should espresso run?', source: 'user' });
    expect(getSummary('draft')).toMatchObject({ slot: 'my-post', total: 2, fromPage: false });
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

describe('removeFromDraft (unticking a question)', () => {
  it('removes the question from the open draft\'s list, ignoring case and a closing "?"', () => {
    addToDraft({ text: 'Why is espresso bitter?', source: 'keywords', template: 'as-written' });
    addToDraft({ text: 'How long is a shot?', source: 'user' });
    expect(removeFromDraft('why is ESPRESSO bitter')).toBe(true);
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([{ text: 'How long is a shot?', source: 'user' }]);
  });

  it('changes nothing for a question the draft does not have', () => {
    addToDraft({ text: 'How long is a shot?', source: 'user' });
    expect(removeFromDraft('What is crema?')).toBe(false);
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([{ text: 'How long is a shot?', source: 'user' }]);
    // A draft with no saved list keeps none.
    setActiveSlot('rag-explained');
    expect(removeFromDraft('What is crema?')).toBe(false);
    expect(loadQuestions('rag-explained')).toBeNull();
  });

  it("removes one of the example's pack questions and updates its summary", () => {
    setActiveSlot('espresso-bitterness');
    const pack = loadQuestions('espresso-bitterness');
    expect(pack).toBeNull();
    addToDraft({ text: 'What is espresso shot time?', source: 'keywords', template: 'what-is' });
    expect(getSummary('draft')).toMatchObject({ slot: 'espresso-bitterness', total: 5 });
    const first = loadQuestions('espresso-bitterness')?.[0]?.text ?? '';
    expect(removeFromDraft(first)).toBe(true);
    expect(loadQuestions('espresso-bitterness')?.map((q) => q.text)).not.toContain(first);
    expect(getSummary('draft')).toMatchObject({ slot: 'espresso-bitterness', total: 4 });
  });

  it('leaves the page questions measured once the last question goes', () => {
    saveDraft(MY_DRAFT_SLUG, '# Why is espresso bitter?\n\nIt runs too long.\n');
    addToDraft({ text: 'How long is a shot?', source: 'user' });
    expect(getSummary('draft')).toMatchObject({ fromPage: false, total: 1 });
    removeFromDraft('How long is a shot?');
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([]);
    expect(getSummary('draft')).toMatchObject({ fromPage: true });
  });

  it('works with storage blocked', () => {
    blockStorage();
    addToDraft({ text: 'How long is a shot?', source: 'user' });
    expect(removeFromDraft('How long is a shot?')).toBe(true);
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([]);
  });
});

describe('draftSourceOf', () => {
  it("keeps an export's source and a local model's, and files the rest as Your keywords", () => {
    expect(draftSourceOf('search-console')).toBe('search-console');
    expect(draftSourceOf('bing-ai')).toBe('bing-ai');
    // A local model's question is a guess, so it keeps its source (input kind local-model).
    expect(draftSourceOf('local-model')).toBe('local-model');
    expect(draftSourceOf('keywords')).toBe('keywords');
  });
});
