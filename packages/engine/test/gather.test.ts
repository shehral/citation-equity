import { describe, expect, it } from 'vitest';
import { countWords, gather, parseDraft, splitSentences, suggestionId } from '../src/index';
import basic from './fixtures/basic.md?raw';
import codeAndFrontmatter from './fixtures/code-and-frontmatter.md?raw';

describe('gather on basic.md', () => {
  const md = basic;
  const a = gather(parseDraft(md));
  const slice = (r: { start: number; end: number }) => a.markdown.slice(r.start, r.end);

  it('collects headings with plain text and the right depths', () => {
    expect(a.headings.map((h) => [h.depth, h.text])).toEqual([
      [1, 'Bitter espresso guide'],
      [2, 'Why does espresso taste bitter?'],
      [2, 'Settings that work'],
    ]);
    expect(a.headings.filter((h) => h.depth === 2)).toHaveLength(2);
  });

  it('splits sections at H2/H3, keeping the H1 and intro in a lead section', () => {
    expect(a.sections.map((s) => s.headingIndex)).toEqual([null, 1, 2]);
    expect(slice(a.sections[0]?.range ?? { start: 0, end: 0 })).toMatch(/^# Bitter espresso guide/);
    expect(slice(a.sections[1]?.range ?? { start: 0, end: 0 })).toMatch(
      /^## Why does espresso taste bitter\?/,
    );
    expect(a.sections[2]?.range.end).toBe(md.length);
    for (const [i, s] of a.sections.entries()) {
      for (const p of s.paragraphIndices) expect(a.paragraphs[p]?.sectionIndex).toBe(i);
    }
  });

  it('collects paragraphs with list and blockquote context', () => {
    const prose = a.paragraphs.filter((p) => !p.inListItem && !p.inBlockquote);
    expect(prose.map((p) => p.sectionIndex)).toEqual([0, 1]);
    expect(a.paragraphs.filter((p) => p.inListItem).map((p) => p.text)).toEqual([
      'Grind too fine',
      'Dose too high',
      'Water too hot',
    ]);
    const quote = a.paragraphs.filter((p) => p.inBlockquote);
    expect(quote).toHaveLength(1);
    expect(quote[0]?.sectionIndex).toBe(2);
  });

  it('splits paragraphs into sentences', () => {
    const intro = a.paragraphs[0];
    expect(intro?.sentences.map((s) => s.text)).toEqual([
      'Espresso tastes bitter when it is over-extracted.',
      'Grind size, dose and time are the main levers.',
    ]);
  });

  it('collects lists, tables and links', () => {
    expect(a.lists).toHaveLength(1);
    expect(a.lists[0]).toMatchObject({ ordered: false, itemCount: 3, sectionIndex: 1 });
    expect(a.lists[0]?.items.map((i) => i.text)).toEqual([
      'Grind too fine',
      'Dose too high',
      'Water too hot',
    ]);
    expect(a.tables).toHaveLength(1);
    expect(a.tables[0]).toMatchObject({ rows: 3, cols: 2, sectionIndex: 2 });
    expect(a.links).toEqual([
      expect.objectContaining({
        url: 'https://sca.coffee/research',
        text: 'the Specialty Coffee Association',
      }),
    ]);
  });

  it('gives every range offsets that slice back to the node text', () => {
    for (const h of a.headings) expect(slice(h.range)).toBe(h.text);
    for (const p of a.paragraphs) {
      expect(slice(p.range)).toBe(p.text);
      for (const s of p.sentences) expect(slice(s.range)).toBe(s.text);
    }
    for (const l of a.lists) {
      expect(slice(l.range)).toMatch(/^- Grind too fine\n/);
      for (const item of l.items) expect(slice(item.range)).toBe(item.text);
    }
    expect(slice(a.tables[0]?.range ?? { start: 0, end: 0 })).toMatch(/^\| Setting \| Value \|/);
    expect(slice(a.tables[0]?.range ?? { start: 0, end: 0 })).toMatch(/\| Time \| 28 s \|$/);
    for (const link of a.links) {
      expect(slice(link.range)).toBe(`[${link.text}](${link.url})`);
    }
  });

  it('counts words in prose, headings, list items and table cells', () => {
    expect(a.wordCount).toBeGreaterThan(50);
  });
});

describe('gather on code-and-frontmatter.md', () => {
  const a = gather(parseDraft(codeAndFrontmatter));

  it('never treats front matter, code or HTML as paragraphs or headings', () => {
    expect(a.paragraphs).toHaveLength(1);
    expect(a.paragraphs[0]?.text).toBe('Only this paragraph is real prose.');
    expect(a.headings).toHaveLength(0);
    expect(a.wordCount).toBe(6);
  });
});

describe('gather details', () => {
  it('resolves reference-style links through their definitions', () => {
    const a = gather(parseDraft('See [the report][r].\n\n[r]: https://example.org/report\n'));
    expect(a.links).toEqual([
      expect.objectContaining({ url: 'https://example.org/report', text: 'the report' }),
    ]);
  });

  it('keeps quote markers out of sentences on blockquote continuation lines', () => {
    const md = 'Intro.\n\n> Line one.\n> Line two.';
    const a = gather(parseDraft(md));
    const sentences = a.paragraphs[1]?.sentences ?? [];
    expect(sentences.map((s) => s.text)).toEqual(['Line one.', 'Line two.']);
    for (const s of sentences) expect(md.slice(s.range.start, s.range.end)).toBe(s.text);
  });

  it('keeps a paragraph wrapped across lines in one sentence', () => {
    const md = 'Espresso tastes bitter when the grind\nis too fine for the basket. Coarsen it.';
    const [p] = gather(parseDraft(md)).paragraphs;
    expect(p?.sentences.map((s) => s.text)).toEqual([
      'Espresso tastes bitter when the grind\nis too fine for the basket.',
      'Coarsen it.',
    ]);
    expect(p?.sentences[0]?.plain).toBe(
      'Espresso tastes bitter when the grind is too fine for the basket.',
    );
    for (const s of p?.sentences ?? []) expect(md.slice(s.range.start, s.range.end)).toBe(s.text);
  });

  it('keeps a wrapped blockquote sentence whole, without quote markers', () => {
    const md = 'Intro.\n\n> Line one\n> continues here. Next.';
    const sentences = gather(parseDraft(md)).paragraphs[1]?.sentences ?? [];
    expect(sentences.map((s) => s.text)).toEqual(['Line one\n> continues here.', 'Next.']);
    expect(sentences.map((s) => s.plain)).toEqual(['Line one   continues here.', 'Next.']);
    for (const s of sentences) expect(md.slice(s.range.start, s.range.end)).toBe(s.text);
  });

  it('masks inline code, inline HTML, URLs and link titles in plain text', () => {
    const md = [
      'Set `x = 42%` and <span data-v="99%">keep</span> it.',
      'See [the guide](https://a.example/50%25 "Title 10%") or https://b.example/20%',
      'or <https://c.example/3%>. ![chart 7%](c.png) **Bold** text.',
    ].join('\n');
    const [p] = gather(parseDraft(md)).paragraphs;
    expect(p?.plain).toHaveLength(p?.text.length ?? -1);
    expect(p?.plain).not.toMatch(/\d|%|https?:|Title|<|`|\*|\n/);
    expect(p?.plain.replace(/\s+/g, ' ').trim()).toBe(
      'Set and keep it. See the guide or or . Bold text.',
    );
    for (const s of p?.sentences ?? []) {
      expect(s.plain).toHaveLength(s.text.length);
      expect(
        p?.plain.slice(s.range.start - (p?.range.start ?? 0), s.range.end - (p?.range.start ?? 0)),
      ).toBe(s.plain);
    }
  });

  it('does not end a sentence at a period inside inline code or a URL', () => {
    const md =
      'Run `make build. Now go` first. Then `npm` starts. Visit https://x.example/a. Done.';
    const [p] = gather(parseDraft(md)).paragraphs;
    expect(p?.sentences.map((s) => s.text)).toEqual([
      'Run `make build. Now go` first.',
      'Then `npm` starts.',
      'Visit https://x.example/a.',
      'Done.',
    ]);
  });

  it('gives a draft that opens with an H2 no lead section', () => {
    const a = gather(parseDraft('## First\n\nText.\n\n### Sub\n\nMore.\n\n#### Deep\n\nDeeper.'));
    expect(a.sections.map((s) => s.headingIndex)).toEqual([0, 1]);
    expect(a.sections[1]?.paragraphIndices).toEqual([1, 2]);
  });

  it('returns empty artifacts for an empty draft', () => {
    const a = gather(parseDraft('   \n'));
    expect(a).toMatchObject({
      headings: [],
      sections: [],
      paragraphs: [],
      lists: [],
      tables: [],
      links: [],
      wordCount: 0,
    });
  });

  it('records the heading text range without the # markers', () => {
    const md = '## How do I fix bitter espresso\n\n## Next';
    const [h] = gather(parseDraft(md)).headings;
    expect(h?.text).toBe('How do I fix bitter espresso');
    expect(h?.range).toEqual({ start: 3, end: 31 });
  });
});

describe('gather on quoted and footnoted blocks', () => {
  it('marks footnote definition paragraphs, on one line or continuation lines', () => {
    const md =
      'Body text cites a source.[^1] And another.[^2]\n\n[^1]: Example Lab report, 2024.\n\n[^2]:\n    Example Lab report on 40 samples.\n';
    const a = gather(parseDraft(md));
    expect(a.paragraphs.map((p) => [p.text, p.inFootnote])).toEqual([
      ['Body text cites a source.[^1] And another.[^2]', false],
      ['Example Lab report, 2024.', true],
      ['Example Lab report on 40 samples.', true],
    ]);
  });

  it("records each list item's task state", () => {
    const a = gather(parseDraft('- [x] Done\n- [ ] Open\n- Plain\n'));
    expect(a.lists[0]?.items.map((i) => i.checked)).toEqual([true, false, null]);
  });

  it('does not split sections at headings inside a blockquote or a list item', () => {
    const md =
      '## Real heading\n\nText.\n\n> ## Quoted heading\n>\n> Quoted text.\n\n- ### Item heading\n\n## Second\n\nMore.\n';
    const a = gather(parseDraft(md));
    expect(a.headings.map((h) => h.text)).toEqual(['Real heading', 'Second']);
    expect(a.sections).toHaveLength(2);
    expect(a.wordCount).toBe(11);
  });
});

describe('text helpers', () => {
  it('splits sentences with offsets into the source', () => {
    const text = 'One sentence here. Another one!  Third?';
    const sentences = splitSentences(text, 10);
    expect(sentences.map((s) => s.text)).toEqual(['One sentence here.', 'Another one!', 'Third?']);
    for (const s of sentences)
      expect(text.slice(s.range.start - 10, s.range.end - 10)).toBe(s.text);
    expect(splitSentences('   ', 0)).toEqual([]);
  });

  it('joins soft line breaks and segments on the plain mask when given one', () => {
    expect(splitSentences('One line\ncontinues. Two.', 0).map((s) => s.text)).toEqual([
      'One line\ncontinues.',
      'Two.',
    ]);
    const text = 'Use `a. B` here. Next.';
    const plain = 'Use        here. Next.';
    const sentences = splitSentences(text, 0, plain);
    expect(sentences.map((s) => [s.text, s.plain])).toEqual([
      ['Use `a. B` here.', 'Use        here.'],
      ['Next.', 'Next.'],
    ]);
    expect(splitSentences('![img](a.png)', 0, ' '.repeat(13))).toEqual([]);
    expect(() => splitSentences('abc', 0, 'ab')).toThrow(RangeError);
  });

  it('does not end a sentence after an honorific or a common abbreviation', () => {
    const texts = (t: string) => splitSentences(t, 0).map((s) => s.text);
    expect(texts('Dr. Jane Doe, a coffee chemist at Example Lab, says so. Next one.')).toEqual([
      'Dr. Jane Doe, a coffee chemist at Example Lab, says so.',
      'Next one.',
    ]);
    expect(texts('Prof. Lee recommends it. Mr. Kim and Ms. Park agree.')).toEqual([
      'Prof. Lee recommends it.',
      'Mr. Kim and Ms. Park agree.',
    ]);
    expect(texts('It was Apple vs. Google in St. Louis. Then rain.')).toEqual([
      'It was Apple vs. Google in St. Louis.',
      'Then rain.',
    ]);
    expect(texts('Use a tool, e.g. Python or Go. Done.')).toEqual([
      'Use a tool, e.g. Python or Go.',
      'Done.',
    ]);
    // A real sentence end after an abbreviation that can close one, or a unit, still splits.
    expect(texts('We bought beans, milk, etc. Then we left.')).toEqual([
      'We bought beans, milk, etc.',
      'Then we left.',
    ]);
    expect(texts('The shot took 30 ms. Then it stopped.')).toEqual([
      'The shot took 30 ms.',
      'Then it stopped.',
    ]);
  });

  it('counts words, ignoring punctuation and whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  Hello, world.  It costs $18.50 today.')).toBe(6);
  });

  it('makes stable 8-digit FNV-1a hex suggestion ids', () => {
    const id = suggestionId('lists', 'some text', 0);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(suggestionId('lists', 'some text', 0)).toBe(id);
    expect(suggestionId('lists', 'some text', 1)).not.toBe(id);
    expect(suggestionId('tables', 'some text', 0)).not.toBe(id);
    // Reference FNV-1a 32-bit of "lists|some text|0" (same routine gives 0xe40c292c for "a").
    expect(id).toBe('1f722575');
  });
});
