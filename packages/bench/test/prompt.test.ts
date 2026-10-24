import { describe, expect, it } from 'vitest';
import { buildPrompt, parseAnswer, stripReasoning } from '../src/prompt';
import type { PackDocument } from '../src/types';

const doc = (docId: string, title: string, text: string): PackDocument => ({
  docId,
  title,
  text,
  synthetic: true,
});

const REMINDER =
  'Answer the question above using only these sources. Write in English. End every sentence with its citation, for example [1][2].';

describe('buildPrompt, schemaVersion 2 reminder', () => {
  const prompt = buildPrompt('What is alpha?', [doc('x', 'T', 'Alpha text.')]);

  it('ends with the exact reminder sentence, after the sources', () => {
    expect(prompt.endsWith(REMINDER)).toBe(true);
    expect(prompt.indexOf(REMINDER)).toBeGreaterThan(prompt.indexOf('Alpha text.'));
  });

  it('keeps the GEO instruction verbatim at the top', () => {
    expect(
      prompt.startsWith('Write an accurate and concise answer for the given user question'),
    ).toBe(true);
    expect(prompt).toContain(
      "The user's language of choice such as English, Français, Español, Deutsch, or 日本語 should be used.",
    );
  });
});

describe('buildPrompt', () => {
  const sources = [
    doc('x', 'First title', 'Alpha text.'),
    doc('y', 'Second title', 'Beta text.'),
    doc('z', '', 'Gamma text.'),
  ];
  const prompt = buildPrompt('What is alpha?', sources);

  it('numbers the sources [1]..[n] in the given order', () => {
    // The instructions mention [1][2][3] themselves, so look only at the source listing.
    const listing = prompt.slice(prompt.indexOf('Search Results:'));
    const one = listing.indexOf('[1]');
    const two = listing.indexOf('[2]');
    const three = listing.indexOf('[3]');
    expect(one).toBeGreaterThan(-1);
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(three);
    expect(listing.indexOf('Alpha text.')).toBeGreaterThan(one);
    expect(listing.indexOf('Alpha text.')).toBeLessThan(two);
    expect(listing.indexOf('Beta text.')).toBeGreaterThan(two);
    expect(listing.indexOf('Beta text.')).toBeLessThan(three);
    expect(listing.indexOf('Gamma text.')).toBeGreaterThan(three);
    expect(listing).not.toContain('[4]');
  });

  it('keeps `$` sequences in page text literally', () => {
    const p = buildPrompt('price?', [doc('m', 'Money', "It costs $5 or $& or $'.")]);
    expect(p).toContain("It costs $5 or $& or $'.");
  });

  it('fills each placeholder once, even when the query names one', () => {
    const p = buildPrompt('what is {source_text}?', [doc('m', 'T', 'Body.')]);
    expect(p).toContain('Question: what is {source_text}?');
    expect(p.match(/Body\./g)).toHaveLength(1);
  });

  it('carries the question, titles and the GEO citation instructions', () => {
    expect(prompt).toContain('Question: What is alpha?');
    expect(prompt).toContain('First title');
    expect(prompt).toContain('using _only_ the provided');
    expect(prompt).toContain('use [1][2][3] format rather than [1, 2, 3]');
  });
});

describe('parseAnswer', () => {
  it('collects the [n] citations of each sentence', () => {
    const parsed = parseAnswer('A [1][2]. B [3]. C.');
    expect(parsed.sentences.map((s) => s.citations)).toEqual([[1, 2], [3], []]);
    expect(parsed.sentences.map((s) => s.text)).toEqual(['A [1][2].', 'B [3].', 'C.']);
  });

  it('attaches markers placed right after the full stop to that sentence', () => {
    const parsed = parseAnswer('Espresso is strong. [2] Tea is mild! [1][3]\n\nDone? Yes.');
    expect(parsed.sentences.map((s) => s.citations)).toEqual([[2], [1, 3], [], []]);
  });

  it('splits paragraphs and ignores blank lines', () => {
    const parsed = parseAnswer('\n\nOne line [1]\n\n\nTwo line [2]\n');
    expect(parsed.sentences.map((s) => s.text)).toEqual(['One line [1]', 'Two line [2]']);
  });

  it('follows the GEO marker pattern: [^1] counts, [1, 2] does not', () => {
    const parsed = parseAnswer('Footnote style [^4]. List style [1, 2].');
    expect(parsed.sentences.map((s) => s.citations)).toEqual([[4], []]);
  });

  it('returns no sentences for an empty answer', () => {
    expect(parseAnswer('   ').sentences).toEqual([]);
  });
});

describe('stripReasoning', () => {
  it('drops leading <think> blocks, so their [n] markers are not read as citations', () => {
    const answer = '<think>Source [3] says so, and [5] too.</think>\n\nEspresso is bitter [1].';
    expect(stripReasoning(answer)).toBe('Espresso is bitter [1].');
    expect(parseAnswer(answer).sentences).toEqual([
      { text: 'Espresso is bitter [1].', citations: [1] },
    ]);
    expect(stripReasoning('<thinking>a [2]</thinking><think>b</think> Answer [1].')).toBe(
      'Answer [1].',
    );
    expect(stripReasoning('  <REASONING>x [4]</REASONING>Answer [2].')).toBe('Answer [2].');
  });

  it('treats an unterminated trace as all reasoning, and a bare closing tag as the end of one', () => {
    expect(stripReasoning('<think>I will cite [1] and [2] and then')).toBe('');
    expect(parseAnswer('<think>I will cite [1]').sentences).toEqual([]);
    expect(stripReasoning('Let me look at [2].</think>\nThe answer [1].')).toBe('The answer [1].');
  });

  it('keeps the answer when a stray closing tag ends it with nothing after', () => {
    expect(stripReasoning('Answer [2]. </think>')).toBe('Answer [2].');
    expect(parseAnswer('Espresso is bitter [1].\n</think>\n').sentences).toEqual([
      { text: 'Espresso is bitter [1].', citations: [1] },
    ]);
  });

  it('leaves an answer without a leading trace unchanged', () => {
    const plain = 'Espresso is bitter [1]. The tag <think> later is kept [2].';
    expect(stripReasoning(plain)).toBe(plain);
  });
});
