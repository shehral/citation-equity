import { describe, expect, it } from 'vitest';
import { retrieve } from '../src/retrieve';
import type { PackDocument } from '../src/types';

const doc = (docId: string, title: string, text: string): PackDocument => ({
  docId,
  title,
  text,
  synthetic: true,
});

const docs = [
  doc('a', 'Coffee basics', 'Coffee is brewed from roasted beans. Coffee tastes good.'),
  doc('b', 'Grinders', 'A burr grinder makes an even coffee grind for brewing coffee.'),
  doc('c', 'Crema', 'Crema forms on espresso when coffee oils emulsify under pressure.'),
];

describe('retrieve', () => {
  it('ranks the document holding the rare query term first', () => {
    const top = retrieve(docs, 'why does coffee crema form', 2);
    expect(top.map((d) => d.docId)[0]).toBe('c');
    expect(top).toHaveLength(2);
  });

  it('searches the title field as well as the text', () => {
    expect(retrieve(docs, 'grinders', 3).map((d) => d.docId)).toEqual(['b']);
  });

  it('returns every matching document when k exceeds the document count', () => {
    const all = retrieve(docs, 'coffee', 10);
    expect(all.map((d) => d.docId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns the original document objects', () => {
    expect(retrieve(docs, 'crema', 1)[0]).toBe(docs[2]);
  });

  it('never returns a document that matches no query term', () => {
    expect(retrieve(docs, 'tea kettle', 5)).toEqual([]);
  });

  it('is deterministic for tied scores (input order breaks ties)', () => {
    const twins = [doc('x', '', 'same words here'), doc('y', '', 'same words here')];
    expect(retrieve(twins, 'words', 2).map((d) => d.docId)).toEqual(['x', 'y']);
    expect(retrieve([...twins].reverse(), 'words', 2).map((d) => d.docId)).toEqual(['y', 'x']);
  });
});
