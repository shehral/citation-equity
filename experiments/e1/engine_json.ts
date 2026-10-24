// The engine's view of one page, as plain JSON for the Python side of E1 (experiments/PREREG_E1.md).
// Every offset is converted from the engine's UTF-16 code units to Unicode code points, so that
// Python string slicing (which indexes code points) lands on the same characters.
import { analyze, gather, parseDraft } from '../../packages/engine/src/index';

interface Span {
  start: number;
  end: number;
}

/** A function from a UTF-16 offset into `text` to the code point offset of the same position. */
export function utf16ToCodePoints(text: string): (offset: number) => number {
  const map = new Int32Array(text.length + 1);
  let cp = 0;
  for (let i = 0; i < text.length; i++) {
    map[i] = cp;
    const code = text.charCodeAt(i);
    // A high surrogate and its low surrogate are one code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        map[i + 1] = cp;
        i++;
      }
    }
    cp++;
  }
  map[text.length] = cp;
  return (offset: number) => map[Math.max(0, Math.min(text.length, offset))] ?? cp;
}

export interface EngineJson {
  wordCount: number;
  checks: Record<
    string,
    {
      applicable: boolean;
      score: number;
      metrics: Record<string, number>;
      findings: (Span & { message: string })[];
      suggestions: (Span & { kind: 'edit' | 'advisory'; after?: string })[];
    }
  >;
  artifacts: {
    headings: (Span & { depth: number; text: string })[];
    sections: (Span & { headingIndex: number | null; paragraphIndices: number[] })[];
    paragraphs: (Span & {
      sectionIndex: number;
      inListItem: boolean;
      inBlockquote: boolean;
      sentences: Span[];
    })[];
    lists: (Span & { sectionIndex: number; items: (Span & { text: string })[] })[];
    tables: (Span & { sectionIndex: number; rows: number })[];
    links: (Span & { url: string; text: string })[];
  };
}

/** Engine checks (with `question` as the target question) and artifacts of a Markdown page. */
export function engineJson(markdown: string, question: string): EngineJson {
  const result = analyze(markdown, { questions: question.trim() ? [question] : [] });
  const a = gather(parseDraft(markdown));
  const cp = utf16ToCodePoints(markdown);
  const span = (r: Span): Span => ({ start: cp(r.start), end: cp(r.end) });

  const checks: EngineJson['checks'] = {};
  for (const c of result.checks) {
    checks[c.checkId] = {
      applicable: c.applicable,
      score: c.score,
      metrics: c.metrics,
      findings: c.findings.map((f) => ({ ...span(f.range), message: f.message })),
      suggestions: c.suggestions.map((s) => ({
        ...span(s.range),
        kind: s.kind,
        ...(s.after === undefined ? {} : { after: s.after }),
      })),
    };
  }
  return {
    wordCount: result.wordCount,
    checks,
    artifacts: {
      headings: a.headings.map((h) => ({ ...span(h.range), depth: h.depth, text: h.text })),
      sections: a.sections.map((s) => ({
        ...span(s.range),
        headingIndex: s.headingIndex,
        paragraphIndices: s.paragraphIndices,
      })),
      paragraphs: a.paragraphs.map((p) => ({
        ...span(p.range),
        sectionIndex: p.sectionIndex,
        inListItem: p.inListItem,
        inBlockquote: p.inBlockquote,
        sentences: p.sentences.map((s) => span(s.range)),
      })),
      lists: a.lists.map((l) => ({
        ...span(l.range),
        sectionIndex: l.sectionIndex,
        items: l.items.map((i) => ({ ...span(i.range), text: i.text })),
      })),
      tables: a.tables.map((t) => ({
        ...span(t.range),
        sectionIndex: t.sectionIndex,
        rows: t.rows,
      })),
      links: a.links.map((l) => ({ ...span(l.range), url: l.url, text: l.text })),
    },
  };
}
