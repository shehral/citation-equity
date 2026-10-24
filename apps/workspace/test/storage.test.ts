import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDraft,
  forgetDraft,
  loadDraft,
  loadQuestions,
  loadStatuses,
  saveDraft,
  saveQuestions,
  saveStatuses,
} from '@/lib/storage';
import { clearAll } from '@/lib/store';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  clearAll();
});

/** A private window: the localStorage accessor itself throws. */
function blockStorage() {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
}

describe('storage when localStorage throws (private mode)', () => {
  it('loadStatuses returns {} and loadDraft returns null', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(loadStatuses('espresso')).toEqual({});
    expect(loadDraft('espresso')).toBeNull();
  });

  it('saveDraft and saveStatuses do not throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => saveDraft('espresso', '# Draft')).not.toThrow();
    expect(() => saveStatuses('espresso', { a: 'ignored' })).not.toThrow();
  });

  it('survives the localStorage accessor itself throwing', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(loadStatuses('espresso')).toEqual({});
    expect(() => saveDraft('espresso', 'x')).not.toThrow();
  });
});

describe('storage when localStorage is blocked, for the page lifetime', () => {
  it('keeps the draft, its statuses and its questions in memory', () => {
    blockStorage();
    saveDraft('my-draft', '# My post');
    saveStatuses('my-draft', { a: 'done', b: 'ignored' });
    saveQuestions('my-draft', [{ text: 'Why?', source: 'user' }]);
    expect(loadDraft('my-draft')).toBe('# My post');
    expect(loadStatuses('my-draft')).toEqual({ a: 'done', b: 'ignored' });
    expect(loadQuestions('my-draft')).toEqual([{ text: 'Why?', source: 'user' }]);
    expect(loadDraft('espresso')).toBeNull();
  });

  it('forgets in memory too: forgetDraft, clearDraft and Clear my data', () => {
    blockStorage();
    saveDraft('a', 'text a');
    saveStatuses('a', { x: 'done' });
    forgetDraft('a');
    expect(loadDraft('a')).toBeNull();
    expect(loadStatuses('a')).toEqual({ x: 'done' });
    saveDraft('a', 'again');
    clearDraft('a');
    expect(loadDraft('a')).toBeNull();
    expect(loadStatuses('a')).toEqual({});
    saveDraft('b', 'text b');
    clearAll();
    expect(loadDraft('b')).toBeNull();
  });

  it('reads localStorage again once it takes the value', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    saveDraft('a', 'in memory');
    expect(loadDraft('a')).toBe('in memory');
    saveDraft('a', 'stored');
    expect(localStorage.getItem('ce:v1:draft:a')).toBe('stored');
    localStorage.setItem('ce:v1:draft:a', 'changed elsewhere');
    expect(loadDraft('a')).toBe('changed elsewhere');
  });
});

describe('storage when localStorage works', () => {
  it('round-trips statuses and drafts under ce:v1: keys, per draft', () => {
    saveStatuses('espresso', { a: 'ignored', b: 'done', c: 'applied' });
    saveDraft('espresso', '# Espresso');
    expect(loadStatuses('espresso')).toEqual({ a: 'ignored', b: 'done', c: 'applied' });
    expect(loadDraft('espresso')).toBe('# Espresso');
    expect(loadStatuses('rag')).toEqual({});
    expect(loadDraft('rag')).toBeNull();
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.key(i)).toMatch(/^ce:v1:/);
    }
  });

  it('ignores corrupt JSON and unknown status values', () => {
    saveStatuses('espresso', { a: 'ignored' });
    const key = localStorage.key(0) ?? '';
    localStorage.setItem(key, '{not json');
    expect(loadStatuses('espresso')).toEqual({});
    localStorage.setItem(key, JSON.stringify({ a: 'done', b: 'deleted', c: 3 }));
    expect(loadStatuses('espresso')).toEqual({ a: 'done' });
    localStorage.setItem(key, JSON.stringify(['done']));
    expect(loadStatuses('espresso')).toEqual({});
  });
});

describe('target question storage', () => {
  it('round-trips questions under ce:v1:questions:<draftKey>, and null when none are saved', () => {
    expect(loadQuestions('espresso')).toBeNull();
    saveQuestions('espresso', [
      { text: 'Why is my espresso bitter?', source: 'sample-pack' },
      { text: 'What grind size works?', source: 'user' },
    ]);
    expect(localStorage.getItem('ce:v1:questions:espresso')).not.toBeNull();
    expect(loadQuestions('espresso')).toEqual([
      { text: 'Why is my espresso bitter?', source: 'sample-pack' },
      { text: 'What grind size works?', source: 'user' },
    ]);
    saveQuestions('rag', []);
    expect(loadQuestions('rag')).toEqual([]);
  });

  it('drops malformed entries, unknown sources and anything past 8, and reads corrupt JSON as none', () => {
    const key = 'ce:v1:questions:espresso';
    localStorage.setItem(key, '{not json');
    expect(loadQuestions('espresso')).toBeNull();
    localStorage.setItem(key, JSON.stringify({ text: 'x' }));
    expect(loadQuestions('espresso')).toBeNull();
    localStorage.setItem(
      key,
      JSON.stringify([
        { text: 'Kept?', source: 'template' },
        { text: 'Bad source?', source: 'scraped' },
        { text: '   ', source: 'user' },
        'just a string',
        ...Array.from({ length: 10 }, (_, i) => ({ text: `Q${i}?`, source: 'user' })),
      ]),
    );
    const loaded = loadQuestions('espresso');
    expect(loaded).toHaveLength(8);
    expect(loaded?.[0]).toEqual({ text: 'Kept?', source: 'template' });
  });

  it('drops duplicate questions an older build saved ("What is crema" and "What is crema?")', () => {
    localStorage.setItem(
      'ce:v1:questions:espresso',
      JSON.stringify([
        { text: 'What is crema?', source: 'user' },
        { text: 'What is crema', source: 'template' },
      ]),
    );
    expect(loadQuestions('espresso')).toEqual([{ text: 'What is crema?', source: 'user' }]);
  });

  it('forgets only the draft text, keeping statuses and questions', () => {
    saveDraft('espresso', 'text');
    saveStatuses('espresso', { a: 'done' });
    saveQuestions('espresso', [{ text: 'Q?', source: 'user' }]);
    forgetDraft('espresso');
    expect(loadDraft('espresso')).toBeNull();
    expect(loadStatuses('espresso')).toEqual({ a: 'done' });
    expect(loadQuestions('espresso')).toEqual([{ text: 'Q?', source: 'user' }]);
  });

  it('reads null and saves nothing when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(loadQuestions('espresso')).toBeNull();
    expect(() => saveQuestions('espresso', [{ text: 'Q?', source: 'user' }])).not.toThrow();
  });
});
