import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAll } from '@/lib/store';
import {
  getTrancoList,
  listName,
  loadTrancoText,
  setTrancoList,
  subscribeTrancoList,
} from '@/lib/tranco-list';

const CSV = '1,google.com\n2,quora.com\n3,regionalnews.com\n';

afterEach(() => setTrancoList(null));

describe('loadTrancoText', () => {
  it('reads the list and takes its ID from the file name Tranco gives', () => {
    const loaded = loadTrancoText(CSV, 'tranco_6GWVX.csv');
    expect(loaded.list.id).toBe('6GWVX');
    expect(loaded.list.depth).toBe(3);
    expect(loaded.list.rankOf('quora.com')).toBe(2);
    expect(listName(loaded)).toBe('Tranco list 6GWVX, top 3 sites');
  });

  it('names a list by its file when the name holds no ID', () => {
    expect(listName(loadTrancoText(CSV, 'my-list.csv'))).toBe(
      'Tranco list my-list.csv, top 3 sites',
    );
  });

  it('turns a bad file into a plain Error with a readable message', () => {
    expect(() => loadTrancoText('{"packId": "x"}', 'pack.json')).toThrow(/no sites/);
    expect(() => loadTrancoText('1,a.com\n3,b.com', 'x.csv')).toThrow(/expected/);
    try {
      loadTrancoText('', 'x.csv');
    } catch (err) {
      expect((err as Error).name).toBe('Error');
    }
  });
});

describe('the loaded list', () => {
  it('starts empty, tells subscribers of each change, and stops when they leave', () => {
    expect(getTrancoList()).toBeNull();
    const listener = vi.fn();
    const leave = subscribeTrancoList(listener);
    const loaded = loadTrancoText(CSV, 'tranco_6GWVX.csv');
    setTrancoList(loaded);
    expect(getTrancoList()).toBe(loaded);
    expect(listener).toHaveBeenCalledTimes(1);
    leave();
    setTrancoList(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is forgotten by Clear my data', () => {
    setTrancoList(loadTrancoText(CSV, 'tranco_6GWVX.csv'));
    clearAll();
    expect(getTrancoList()).toBeNull();
  });
});
