import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBaseline, replacesMostOf, saveBaseline, sinceStart } from '@/lib/baseline';
import { clearAll } from '@/lib/store';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('baseline ("+N since you started")', () => {
  it('is stored per draft slot', () => {
    saveBaseline('my-post', { standard: 30, evidence: 28 });
    saveBaseline('espresso-bitterness', { standard: 35, evidence: 33 });
    expect(loadBaseline('my-post')).toEqual({ standard: 30, evidence: 28 });
    expect(loadBaseline('espresso-bitterness')).toEqual({ standard: 35, evidence: 33 });
    saveBaseline('my-post', null);
    expect(loadBaseline('my-post')).toBeNull();
    expect(loadBaseline('espresso-bitterness')).not.toBeNull();
  });

  it('is removed by Clear my data', () => {
    saveBaseline('my-post', { standard: 30, evidence: 28 });
    clearAll();
    expect(loadBaseline('my-post')).toBeNull();
  });

  it('lasts for the page when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    saveBaseline('blocked', { standard: 1, evidence: 2 });
    expect(loadBaseline('blocked')).toEqual({ standard: 1, evidence: 2 });
  });

  it('ignores an unreadable stored value', () => {
    localStorage.setItem('ce:v1:baseline:my-post', '{"standard":"x"}');
    expect(loadBaseline('my-post')).toBeNull();
  });

  it('resets on a change that replaces more than half of the draft, not on typing', () => {
    const draft = 'A'.repeat(100);
    expect(replacesMostOf(draft, `${draft}more`)).toBe(false);
    expect(replacesMostOf(draft, `${'A'.repeat(60)}B`)).toBe(false);
    expect(replacesMostOf(draft, 'Something pasted in its place')).toBe(true);
    expect(replacesMostOf(draft, '')).toBe(true);
    // An empty draft has no baseline to reset.
    expect(replacesMostOf('', 'Pasted post')).toBe(false);
  });

  it('measures the score against the baseline, and nothing without one', () => {
    expect(sinceStart(38, 35)).toBe(3);
    expect(sinceStart(35, 35)).toBe(0);
    expect(sinceStart(null, 35)).toBeNull();
    expect(sinceStart(40, undefined)).toBeNull();
  });
});
