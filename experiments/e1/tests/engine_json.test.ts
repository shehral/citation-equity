import { describe, expect, it } from 'vitest';
import { engineJson, utf16ToCodePoints } from '../engine_json';

describe('utf16ToCodePoints', () => {
  it('maps UTF-16 offsets to code point offsets past an astral character', () => {
    const map = utf16ToCodePoints('a😀b');
    expect([map(0), map(1), map(3), map(4)]).toEqual([0, 1, 2, 3]);
  });
});

describe('engineJson', () => {
  const md =
    '# Title 😀\n\n## Why it works\n\nThis is one. It is two.\n\n- a\n- b\n\n[x](https://e.com)\n';

  it('reports check results and artifacts in code point offsets', () => {
    const out = engineJson(md, 'Why does it work?');
    const chars = [...md];
    const slice = (r: { start: number; end: number }) => chars.slice(r.start, r.end).join('');
    expect(Object.keys(out.checks)).toContain('question-headings');
    expect(out.artifacts.headings.map(slice)).toEqual(['Title 😀', 'Why it works']);
    expect(out.artifacts.headings[1]).toMatchObject({ depth: 2, text: 'Why it works' });
    const para = out.artifacts.paragraphs.find((p) => slice(p).startsWith('This'));
    expect(para?.sentences.map(slice)).toEqual(['This is one.', 'It is two.']);
    expect(out.artifacts.lists[0]?.items.map(slice)).toEqual(['a', 'b']);
    expect(out.artifacts.links.map((l) => [slice(l), l.url])).toEqual([
      ['[x](https://e.com)', 'https://e.com'],
    ]);
    for (const c of Object.values(out.checks))
      for (const f of c.findings) expect(f.end).toBeLessThanOrEqual(chars.length);
  });
});
