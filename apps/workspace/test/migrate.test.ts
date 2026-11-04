// The update from the score build: what an older build stored is brought to the new shapes once
// per page load, before any page reads it, so no screen shows a score or a pass count.
import { act, cleanup, render } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';
import { draftSummaryFor } from '@/lib/draft-summary';
import { EXAMPLE_SLUG } from '@/lib/examples';
import { migrateStore } from '@/lib/migrate';
import type { WorkspaceQuestion } from '@/lib/questions';
import { MY_DRAFT_SLUG } from '@/lib/samples';
import { loadQuestions, saveQuestions } from '@/lib/storage';
import {
  type CitedSummary,
  clearAll,
  getSummary,
  MY_POST_SLOT,
  setActiveSlot,
  subscribe,
} from '@/lib/store';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const AT = '2026-10-24T10:00:00.000Z';
const OLD_DRAFT = {
  slot: 'my-post',
  score: 41,
  baseline: { standard: 35, evidence: 37 },
  openStartHere: 2,
  example: false,
  at: AT,
};
const OLD_SITE = { pass: 5, warn: 1, fail: 1, total: 7, needsLiveSite: 1, example: false, at: AT };
const CITED: CitedSummary = {
  answers: 3,
  citingYou: 1,
  topKinds: ['forum'],
  example: false,
  at: AT,
};

/** A post whose headings ask questions, as the old build's prefill read them. */
const POST =
  '# Cold brew at home\n\nCold brew is coffee steeped in cold water for many hours.\n\n## How long does cold brew keep?\n\nAbout a week in the fridge.\n';
/** What the old build saved for POST on load, before the author chose anything. */
const PREFILL = [{ text: 'How long does cold brew keep?', source: 'draft-heading' }];

const set = (key: string, value: unknown) =>
  window.localStorage.setItem(
    `ce:v1:${key}`,
    typeof value === 'string' ? value : JSON.stringify(value),
  );
const has = (key: string) => window.localStorage.getItem(`ce:v1:${key}`) !== null;
const baselineKeys = () =>
  Object.keys(window.localStorage).filter((k) => k.startsWith('ce:v1:baseline:'));

/** Seeds what a visitor of the score build left behind on My post. */
function seedOldBuild() {
  set('draft:my-draft', POST);
  set('questions:my-draft', PREFILL);
  set('summary:draft', OLD_DRAFT);
  set('summary:site', OLD_SITE);
  set('summary:cited', CITED);
  set('baseline:my-post', { standard: 35, evidence: 37 });
  set('baseline:espresso-bitterness', { standard: 20, evidence: 21 });
}

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
  cleanup();
  vi.restoreAllMocks();
  clearAll();
  window.localStorage.clear();
});

describe('migrateStore', () => {
  it('replaces an old draft summary with one computed from the stored draft and questions', () => {
    set('draft:my-draft', POST);
    set('questions:my-draft', [{ text: 'How long does cold brew keep?', source: 'user' }]);
    set('summary:draft', OLD_DRAFT);
    migrateStore(new Date(AT));
    expect(getSummary('draft')).toEqual({
      slot: MY_POST_SLOT,
      covered: expect.any(Number),
      total: 1,
      fromPage: false,
      example: false,
      at: AT,
    });
    expect(getSummary('draft')).toEqual(draftSummaryFor(MY_POST_SLOT, new Date(AT)));
  });

  it("computes the active slot's summary, so an example's reads as the example", () => {
    setActiveSlot(EXAMPLE_SLUG);
    set('summary:draft', { ...OLD_DRAFT, slot: EXAMPLE_SLUG, example: true });
    migrateStore(new Date(AT));
    expect(getSummary('draft')).toEqual({
      slot: EXAMPLE_SLUG,
      covered: 0,
      total: 4,
      fromPage: false,
      example: true,
      at: AT,
    });
  });

  it('removes an old draft summary when the draft it belongs to is empty', () => {
    set('summary:draft', OLD_DRAFT);
    migrateStore();
    expect(has('summary:draft')).toBe(false);
  });

  it('removes an old site summary, since the pasted page was never stored', () => {
    set('summary:site', OLD_SITE);
    migrateStore();
    expect(has('summary:site')).toBe(false);
    expect(getSummary('site')).toBeNull();
  });

  it('keeps summaries already in the new shape, and the cited summary', () => {
    const draft = {
      slot: MY_POST_SLOT,
      covered: 1,
      total: 2,
      fromPage: false,
      example: false,
      at: AT,
    };
    const site = {
      blockers: [],
      checks: ['crawler-access'],
      needsLiveSite: 1,
      example: false,
      at: AT,
    };
    set('summary:draft', draft);
    set('summary:site', site);
    set('summary:cited', CITED);
    migrateStore();
    expect(getSummary('draft')).toEqual(draft);
    expect(getSummary('site')).toEqual(site);
    expect(getSummary('cited')).toEqual(CITED);
  });

  it('removes every baseline key and nothing else', () => {
    set('baseline:my-post', { standard: 35, evidence: 37 });
    set('baseline:rag-explained', { standard: 50, evidence: 52 });
    set('statuses:my-draft', { a: 'done' });
    window.localStorage.setItem('other-app:baseline:x', 'keep');
    migrateStore();
    expect(baselineKeys()).toEqual([]);
    expect(has('statuses:my-draft')).toBe(true);
    expect(window.localStorage.getItem('other-app:baseline:x')).toBe('keep');
  });

  it("removes My post's untouched heading prefill, so the page questions are measured", () => {
    set('draft:my-draft', POST);
    set('questions:my-draft', [
      ...PREFILL,
      { text: 'Is cold brew stronger?', source: 'draft-heading' },
    ]);
    set('summary:draft', OLD_DRAFT);
    migrateStore(new Date(AT));
    expect(has('questions:my-draft')).toBe(false);
    // Step 4 ran before the summary was computed, so it already measures the page questions.
    expect(getSummary('draft')).toMatchObject({ slot: MY_POST_SLOT, fromPage: true });
  });

  it('also reads an older site summary alone as the older build', () => {
    set('draft:my-draft', POST);
    set('questions:my-draft', PREFILL);
    set('summary:site', OLD_SITE);
    migrateStore();
    expect(has('questions:my-draft')).toBe(false);
    expect(has('summary:site')).toBe(false);
  });

  it('also reads a score baseline alone as the older build, which this build never writes', () => {
    set('draft:my-draft', POST);
    set('questions:my-draft', PREFILL);
    set('baseline:my-post', { standard: 35, evidence: 37 });
    migrateStore();
    expect(has('questions:my-draft')).toBe(false);
    expect(baselineKeys()).toEqual([]);
    // Once the baseline is gone, a heading list saved afterwards is the author's and stays.
    saveQuestions(MY_DRAFT_SLUG, PREFILL as WorkspaceQuestion[]);
    migrateStore();
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual(PREFILL);
  });

  it('keeps a My post list with any other source, and an example list of heading questions', () => {
    const mixed = [...PREFILL, { text: 'Is cold brew stronger?', source: 'user' }];
    set('draft:my-draft', POST);
    set('questions:my-draft', mixed);
    set('questions:espresso-bitterness', PREFILL);
    set('summary:draft', OLD_DRAFT);
    migrateStore();
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual(mixed);
    expect(loadQuestions(EXAMPLE_SLUG)).toEqual(PREFILL);
  });

  it('keeps an empty My post list', () => {
    set('questions:my-draft', []);
    set('summary:draft', OLD_DRAFT);
    migrateStore();
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual([]);
  });

  it('keeps a heading list this build saved, since only an older build saves one unasked', () => {
    // The author added only heading questions with a click; the store holds this build's shapes.
    saveQuestions(MY_DRAFT_SLUG, [
      { text: 'How long does cold brew keep?', source: 'draft-heading' },
    ]);
    set('summary:draft', {
      slot: MY_POST_SLOT,
      covered: 0,
      total: 1,
      fromPage: false,
      example: false,
      at: AT,
    });
    migrateStore();
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual(PREFILL);
    // Nor after "Clear my data", which leaves nothing older behind.
    clearAll();
    saveQuestions(MY_DRAFT_SLUG, [
      { text: 'How long does cold brew keep?', source: 'draft-heading' },
    ]);
    migrateStore();
    expect(loadQuestions(MY_DRAFT_SLUG)).toEqual(PREFILL);
  });

  it("leaves no older build's draft summary stored when the new one cannot be written (a full quota)", () => {
    // Otherwise the next load would read the older build again, and step 4 would remove a heading
    // list the author built in this build.
    set('draft:my-draft', POST);
    set('questions:my-draft', [{ text: 'How long does cold brew keep?', source: 'user' }]);
    set('summary:draft', OLD_DRAFT);
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'ce:v1:summary:draft') throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    migrateStore(new Date(AT));
    // This page reads the new summary from memory; localStorage holds none, old or new.
    expect(getSummary('draft')).toMatchObject({ slot: MY_POST_SLOT, total: 1, fromPage: false });
    expect(has('summary:draft')).toBe(false);
  });

  it('notifies subscribers once, and a second run changes nothing', () => {
    seedOldBuild();
    const listener = vi.fn();
    const off = subscribe(listener);
    migrateStore(new Date(AT));
    expect(listener).toHaveBeenCalledTimes(1);
    const after = { ...window.localStorage };
    migrateStore(new Date('2026-11-01T00:00:00.000Z'));
    expect({ ...window.localStorage }).toEqual(after);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('does nothing, and never throws, when storage throws', () => {
    seedOldBuild();
    blockStorage();
    expect(() => migrateStore()).not.toThrow();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => migrateStore()).not.toThrow();
  });
});

describe('the app shell runs the migration on load', () => {
  it('ends with a new-shape draft summary, no heading prefill and no baseline key', () => {
    seedOldBuild();
    act(() => {
      render(createElement(AppShell, null, createElement('main', null, 'Page')));
    });
    expect(getSummary('draft')).toEqual({
      slot: MY_POST_SLOT,
      covered: expect.any(Number),
      total: expect.any(Number),
      fromPage: true,
      example: false,
      at: expect.any(String),
    });
    expect(
      JSON.parse(window.localStorage.getItem('ce:v1:summary:draft') ?? '{}'),
    ).not.toHaveProperty('score');
    expect(has('questions:my-draft')).toBe(false);
    expect(baselineKeys()).toEqual([]);
    expect(has('summary:site')).toBe(false);
    expect(getSummary('cited')).toEqual(CITED);
  });

  it('runs before the page reads the store, so a page effect sees the new shapes', () => {
    seedOldBuild();
    const seen: unknown[] = [];
    const page = createElement(Probe, { onMount: () => seen.push(getSummary('draft')) });
    render(createElement(AppShell, null, page));
    expect(seen).toEqual([expect.objectContaining({ slot: MY_POST_SLOT, fromPage: true })]);
  });
});

/** A page that reads the store in its mount effect, as the home and the views do. */
function Probe({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return null;
}
