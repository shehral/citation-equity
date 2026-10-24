import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CitedSummary,
  clearAll,
  clearSummary,
  type DraftSummary,
  getActiveSlot,
  getLastView,
  getSummary,
  hasLeftHome,
  MY_POST_SLOT,
  type SiteSummary,
  setActiveSlot,
  setLastView,
  setSummary,
  storageAvailable,
  subscribe,
} from '@/lib/store';

const DRAFT: DraftSummary = {
  slot: 'espresso-bitterness',
  score: 41,
  baseline: { standard: 35, evidence: 37 },
  openStartHere: 3,
  example: true,
  at: '2026-10-24T10:00:00.000Z',
};
const SITE: SiteSummary = {
  pass: 5,
  warn: 1,
  fail: 1,
  total: 7,
  needsLiveSite: 1,
  example: true,
  at: '2026-10-24T10:00:00.000Z',
};
const CITED: CitedSummary = {
  answers: 3,
  citingYou: 1,
  topKinds: ['forum', 'wiki'],
  example: false,
  at: '2026-10-24T10:00:00.000Z',
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

describe('summaries', () => {
  it('round-trip each kind through localStorage', () => {
    setSummary('draft', DRAFT);
    setSummary('site', SITE);
    setSummary('cited', CITED);
    expect(getSummary('draft')).toEqual(DRAFT);
    expect(getSummary('site')).toEqual(SITE);
    expect(getSummary('cited')).toEqual(CITED);
    expect(window.localStorage.getItem('ce:v1:summary:site')).toBe(JSON.stringify(SITE));
  });

  it('are null when nothing is stored', () => {
    expect(getSummary('draft')).toBeNull();
    expect(getSummary('site')).toBeNull();
    expect(getSummary('cited')).toBeNull();
  });

  it('read back a value another page load wrote', () => {
    window.localStorage.setItem('ce:v1:summary:cited', JSON.stringify(CITED));
    expect(getSummary('cited')).toEqual(CITED);
  });

  it('ignore unreadable or wrongly shaped values', () => {
    window.localStorage.setItem('ce:v1:summary:draft', '{not json');
    window.localStorage.setItem('ce:v1:summary:site', JSON.stringify({ ...SITE, pass: '5' }));
    window.localStorage.setItem(
      'ce:v1:summary:cited',
      JSON.stringify({ ...CITED, topKinds: 'forum' }),
    );
    expect(getSummary('draft')).toBeNull();
    expect(getSummary('site')).toBeNull();
    expect(getSummary('cited')).toBeNull();
    window.localStorage.setItem(
      'ce:v1:summary:draft',
      JSON.stringify({ ...DRAFT, baseline: { standard: 35 } }),
    );
    expect(getSummary('draft')).toBeNull();
  });

  it('accept a cited summary with or without its site, but only a string one', () => {
    setSummary('cited', { ...CITED, site: 'example.com' });
    expect(getSummary('cited')?.site).toBe('example.com');
    setSummary('cited', CITED);
    expect(getSummary('cited')?.site).toBeUndefined();
    clearAll();
    window.localStorage.setItem('ce:v1:summary:cited', JSON.stringify({ ...CITED, site: true }));
    expect(getSummary('cited')).toBeNull();
  });

  it('clear one summary and leave the others (Use my own post with an empty draft)', () => {
    setSummary('draft', DRAFT);
    setSummary('site', SITE);
    const heard = vi.fn();
    const off = subscribe(heard);
    clearSummary('draft');
    off();
    expect(getSummary('draft')).toBeNull();
    expect(window.localStorage.getItem('ce:v1:summary:draft')).toBeNull();
    expect(getSummary('site')).toEqual(SITE);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('return the same object until the stored value changes (safe for useSyncExternalStore)', () => {
    setSummary('site', SITE);
    const first = getSummary('site');
    expect(getSummary('site')).toBe(first);
    setSummary('site', { ...SITE, pass: 6 });
    expect(getSummary('site')).not.toBe(first);
    expect(getSummary('site')?.pass).toBe(6);
  });
});

describe('active slot', () => {
  it('defaults to the My post slot', () => {
    expect(MY_POST_SLOT).toBe('my-post');
    expect(getActiveSlot()).toBe('my-post');
  });

  it('round-trips an example slug', () => {
    setActiveSlot('rag-explained');
    expect(getActiveSlot()).toBe('rag-explained');
    expect(window.localStorage.getItem('ce:v1:active-slot')).toBe('rag-explained');
  });
});

describe('last view', () => {
  it('is null until a view is recorded, then round-trips', () => {
    expect(getLastView()).toBeNull();
    setLastView('cited');
    expect(getLastView()).toBe('cited');
    setLastView('home');
    expect(getLastView()).toBe('home');
  });

  it('ignores a stored value that is not a view', () => {
    window.localStorage.setItem('ce:v1:last-view', 'research');
    expect(getLastView()).toBeNull();
  });

  it('remembers that the user left the home, even after going back to it', () => {
    setLastView('home');
    expect(hasLeftHome()).toBe(false);
    setLastView('draft');
    setLastView('home');
    expect(hasLeftHome()).toBe(true);
  });
});

describe('clearAll', () => {
  it('removes every ce:v1:* key and nothing else', () => {
    setSummary('draft', DRAFT);
    setActiveSlot('espresso-bitterness');
    setLastView('site');
    // Keys other modules write under the same prefix (draft text, theme).
    window.localStorage.setItem('ce:v1:draft:my-draft', 'My text');
    window.localStorage.setItem('ce:v1:theme', 'dark');
    // Keys that are not ours, or another version's.
    window.localStorage.setItem('other-app:key', 'keep');
    window.localStorage.setItem('ce:v2:summary:draft', 'keep');
    window.localStorage.setItem('ce:v1', 'keep');

    clearAll();

    const left = Object.keys(window.localStorage).sort();
    expect(left).toEqual(['ce:v1', 'ce:v2:summary:draft', 'other-app:key']);
    expect(getSummary('draft')).toBeNull();
    expect(getActiveSlot()).toBe('my-post');
    expect(getLastView()).toBeNull();
    expect(hasLeftHome()).toBe(false);
  });
});

describe('subscribe', () => {
  it('notifies on every write and on clearAll, until unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setSummary('site', SITE);
    setActiveSlot('rag-explained');
    setLastView('draft');
    clearAll();
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    setLastView('site');
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

describe('with localStorage throwing', () => {
  it('reports storage as unavailable', () => {
    expect(storageAvailable()).toBe(true);
    blockStorage();
    expect(storageAvailable()).toBe(false);
  });

  it('keeps every value in memory for this page, without throwing', () => {
    blockStorage();
    expect(getSummary('draft')).toBeNull();
    expect(getActiveSlot()).toBe('my-post');
    expect(getLastView()).toBeNull();

    setSummary('draft', DRAFT);
    setSummary('site', SITE);
    setSummary('cited', CITED);
    setActiveSlot('espresso-bitterness');
    setLastView('site');

    expect(getSummary('draft')).toEqual(DRAFT);
    expect(getSummary('site')).toEqual(SITE);
    expect(getSummary('cited')).toEqual(CITED);
    expect(getActiveSlot()).toBe('espresso-bitterness');
    expect(getLastView()).toBe('site');
    expect(hasLeftHome()).toBe(true);

    clearAll();
    expect(getSummary('draft')).toBeNull();
    expect(getActiveSlot()).toBe('my-post');
    expect(getLastView()).toBeNull();
  });

  it('also works when only writes fail (a full quota)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    expect(storageAvailable()).toBe(false);
    setSummary('cited', CITED);
    expect(getSummary('cited')).toEqual(CITED);
  });
});
