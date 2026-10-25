import { describe, expect, it } from 'vitest';
import espressoAfter from '../../../../samples/espresso-bitterness/after.md?raw';
import espressoBefore from '../../../../samples/espresso-bitterness/before.md?raw';
import espressoPack from '../../../../samples/espresso-bitterness/pack.json';
import ragBefore from '../../../../samples/rag-explained/before.md?raw';
import { check, readerWords } from '../../src/checks/reader-words';
import { analyze, EVIDENCE, gather, pageQuestions, parseDraft } from '../../src/index';

/** The check on `md`, measuring `questions` as the author's own (typed or imported) questions. */
const run = (md: string, questions?: string[]) =>
  check(
    gather(parseDraft(md)),
    questions === undefined ? undefined : { questions, readerQuestions: questions },
  );
const readerCheck = (r: ReturnType<typeof analyze>) =>
  r.checks.find((c) => c.checkId === 'reader-words');
/** A draft with neither a title nor a topic a question can be made from. */
const NO_PAGE_QUESTION = '## Notes\n\nThis paragraph is a test.\n';

const DRAFT = [
  '# Bitter espresso, fixed',
  '',
  '## Grind first',
  '',
  'A shot that runs too long tastes harsh. Most of the time the grind is the cause.',
  '',
  '## Water',
  '',
  'Water temperature matters less than grind, but it still shows up in the cup.',
  '',
].join('\n');

describe('reader-words', () => {
  it('does not apply when the author has no questions and the page has none of its own', () => {
    expect(pageQuestions(NO_PAGE_QUESTION)).toEqual([]);
    expect(run(NO_PAGE_QUESTION).applicable).toBe(false);
    expect(run(NO_PAGE_QUESTION, []).applicable).toBe(false);
    expect(run(NO_PAGE_QUESTION, ['  ', '']).applicable).toBe(false);
    const viaAnalyze = readerCheck(analyze(NO_PAGE_QUESTION));
    expect(viaAnalyze).toMatchObject({ applicable: false, score: 0, suggestions: [] });
  });

  it("measures the page's title and topic questions when the author has none, never a section's", () => {
    const md = [
      '# Cold brew at home',
      '',
      'Cold brew is coffee steeped in cold water for many hours.',
      '',
      '## How long should cold brew steep?',
      '',
      'Steep it for 12 to 18 hours in the fridge.',
      '',
      '## Grind size',
      '',
      'Use a coarse grind.',
      '',
    ].join('\n');
    const page = pageQuestions(md);
    expect(page.map((q) => q.origin)).toEqual(['topic', 'topic']);
    expect(page.map((q) => q.text)).toEqual(['What is cold brew?', 'How does cold brew work?']);
    // The section questions are still reader questions for question-coverage, not for this check.
    const sections = ['How long should cold brew steep?'];
    const r = analyze(md, { questions: [...sections, ...page.map((q) => q.text)] });
    expect(readerCheck(r)?.metrics.questions).toBe(2);
    for (const s of readerCheck(r)?.suggestions ?? []) expect(s.title).not.toContain('steep');
    expect(readerCheck(analyze(md))?.metrics.questions).toBe(2);
  });

  it("uses the page's title when it reads as a question", () => {
    const md = '# Why does espresso taste bitter?\n\nUsually the grind is too fine.\n';
    expect(pageQuestions(md)[0]).toEqual({
      text: 'Why does espresso taste bitter?',
      source: 'draft-heading',
      origin: 'title',
    });
    expect(readerCheck(analyze(md))?.score).toBe(1);
  });

  it('measures exactly the questions the author typed or imported, when there are any', () => {
    const typed = ['What water temperature is best?'];
    const generated = pageQuestions(DRAFT).map((q) => q.text);
    expect(generated.length).toBeGreaterThan(0);
    const r = analyze(DRAFT, { questions: [...typed, ...generated], authorQuestions: typed });
    const rw = readerCheck(r);
    expect(rw?.metrics.questions).toBe(1);
    expect(rw?.suggestions.map((s) => s.title)).toEqual([
      'Use the words of "What water temperature is best?" up top',
    ]);
    // question-coverage still reads every question.
    const coverage = r.checks.find((c) => c.checkId === 'question-coverage');
    expect(coverage?.metrics.questions).toBe(1 + generated.length);
  });

  it('never scores lower when a question heading is added to the draft', () => {
    const section =
      '\n## Why does it go wrong so often?\n\nMost of the time the cause is simple.\n';
    const typed = ['How do I fix bitter espresso?'];
    for (const md of [DRAFT, espressoBefore, ragBefore, NO_PAGE_QUESTION]) {
      const added = `${md.trimEnd()}\n${section}`;
      for (const authorQuestions of [undefined, typed]) {
        const score = (text: string) => {
          const rw = readerCheck(analyze(text, { authorQuestions }));
          return rw?.applicable ? rw.score : null;
        };
        const before = score(md);
        const after = score(added);
        if (before === null) expect(after).toBeNull();
        else expect(after ?? -1).toBeGreaterThanOrEqual(before);
      }
    }
  });

  it('never scores lower when a question section goes in directly under the title', () => {
    const coffee = '# Coffee notes\n\n## Espresso extraction time\n\nPull a shot slowly.\n';
    const withIntro = `# Coffee notes\n\nNotes on espresso.\n\n## Extraction time\n\nPull a shot slowly.\n`;
    const typed = ['What is espresso extraction time?'];
    const insert = (md: string, at: string, text: string) => md.replace(at, `${text}${at}`);
    const question = '## Why is my coffee sour?\n\nUsually the shot ran too fast.\n\n';
    const headingOnly = '## Why is my coffee sour?\n\n';
    const cases = [
      // Above the first heading.
      [coffee, insert(coffee, '## Espresso', question)],
      [withIntro, insert(withIntro, '## Extraction', question)],
      // Between the title and the opening paragraph.
      [withIntro, insert(withIntro, 'Notes on', question)],
      [withIntro, insert(withIntro, 'Notes on', headingOnly)],
      [DRAFT, insert(DRAFT, '## Grind first', question)],
      [espressoBefore, insert(espressoBefore, '## ', question)],
      [ragBefore, insert(ragBefore, '## ', question)],
    ];
    expect(readerCheck(analyze(coffee, { authorQuestions: typed }))?.score).toBe(1);
    for (const [md, added] of cases) {
      expect(added).not.toBe(md);
      for (const authorQuestions of [undefined, typed]) {
        const score = (text: string) => {
          const rw = readerCheck(analyze(text, { authorQuestions }));
          return rw?.applicable ? rw.score : null;
        };
        const before = score(md);
        if (before === null) continue;
        expect(score(added) ?? -1).toBeGreaterThanOrEqual(before);
      }
    }
  });

  it('counts the opening heading and paragraph after any question sections above them', () => {
    const md = [
      '# Coffee notes',
      '',
      '## Why is my coffee sour?',
      '',
      'Usually the shot ran too fast.',
      '',
      '## Grind size',
      '',
      'A finer grind slows the shot down.',
      '',
      '## Water',
      '',
      'Use filtered water.',
      '',
    ].join('\n');
    // "sour" from the question heading, "grind" from the first ordinary heading, "finer" from
    // the first paragraph outside a question section; "filtered" is further down.
    const [row] = readerWords(gather(parseDraft(md)), [
      'Is sour coffee a grind or finer filtered?',
    ]);
    expect(row?.missing).toEqual(['filtered']);
  });

  it('never names a weak verb ("work", "use", "take", "make") as a missing word', () => {
    const md = '# Cold brew at home\n\nSteep coarse coffee in cold water for a long night.\n';
    for (const q of [
      'How does cold brew work?',
      'How do you use cold brew?',
      'How long does cold brew take?',
      'How do you make cold brew?',
    ]) {
      const r = run(md, [q]);
      expect(r.score, q).toBe(1);
      expect(r.suggestions).toEqual([]);
    }
    const [s] = run(md, ['How long does a French press take to make?']).suggestions;
    expect(s?.rationale).toContain('Missing: "French", "press".');
    expect(s?.rationale).not.toMatch(/"take"|"make"/);
  });

  it('counts a question repeated by the author once', () => {
    const r = run(DRAFT, ['What water temperature is best?', '  what water temperature is best ']);
    expect(r.metrics.questions).toBe(1);
    expect(r.suggestions).toHaveLength(1);
  });

  it('does not score the espresso sample lower after its edits, with or without the pack questions', () => {
    const pack = espressoPack.queries.map((q) => q.query);
    for (const authorQuestions of [undefined, pack]) {
      const before = readerCheck(analyze(espressoBefore, { authorQuestions }));
      const after = readerCheck(analyze(espressoAfter, { authorQuestions }));
      expect(before?.applicable).toBe(true);
      expect(after?.score ?? -1).toBeGreaterThanOrEqual(before?.score ?? 2);
    }
  });

  it('scores 1 when every key word of the question is in the title, first heading or first paragraph', () => {
    // "bitter" and "espresso" are in the title, "grind" in the first heading, "shot" in the first paragraph.
    const r = run(DRAFT, ['Is a bitter espresso shot the grind?']);
    expect(r).toMatchObject({ checkId: 'reader-words', applicable: true, score: 1 });
    expect(r.suggestions).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it('scores the share of key words up top, averaged over questions', () => {
    // Key words: espresso, taste, sour. "tastes" up top meets "taste", so 2 of 3 are present.
    const sour = 'Why does my espresso taste sour?';
    // Key words: water, temperature, best (none up top: the first two are only in the second section).
    const water = 'What water temperature is best?';
    const r = run(DRAFT, [sour, water]);
    const rows = readerWords(gather(parseDraft(DRAFT)), [sour, water]);
    expect(rows.map((q) => [q.question, q.found, q.total])).toEqual([
      [sour, 2, 3],
      [water, 0, 3],
    ]);
    expect(r.score).toBeCloseTo((2 / 3 + 0) / 2);
    expect(r.metrics).toEqual({ questions: 2, complete: 0 });
  });

  it('gives advice, never an edit, naming the missing words and where they could go', () => {
    const water = 'What water temperature is best?';
    const r = run(DRAFT, [water]);
    expect(r.suggestions).toHaveLength(1);
    const [s] = r.suggestions;
    expect(s?.kind).toBe('advisory');
    expect(s?.after).toBeUndefined();
    expect(s?.title).toBe(`Use the words of "${water}" up top`);
    expect(s?.rationale).toContain('"water", "temperature", "best"');
    expect(s?.rationale).toMatch(/title, first heading or first paragraph/);
    expect(s?.rationale).toContain('if it fits naturally');
    expect(s?.grade).toBe(EVIDENCE['reader-words'].grade);
    expect(s?.rationale).toContain(`Evidence grade: ${EVIDENCE['reader-words'].grade}.`);
    expect(s?.rationale).toContain(
      'Measured in our own test (E1): helps, possibly through length or query-term overlap (d +0.035, 95% CI [+0.008, +0.066], n 33, Holm p 0.037;',
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.range).toEqual(s?.range);
    expect(DRAFT.slice(s?.range.start, s?.range.end)).toBe(s?.before);
  });

  it('never names a word that is already up top', () => {
    const sour = 'Why does my espresso taste sour?';
    const [s] = run(DRAFT, [sour]).suggestions;
    expect(s?.rationale).toContain('"sour"');
    expect(s?.rationale).not.toMatch(/"espresso"|"taste"/);
  });

  it('names at most 3 words per question, in the order the question uses them', () => {
    const long = 'Which burr grinder, kettle, scale and tamper should beginners buy?';
    const [s] = run(DRAFT, [long]).suggestions;
    expect(s?.rationale).toContain('"burr", "grinder", "kettle"');
    for (const word of ['scale', 'tamper', 'beginners', 'buy']) {
      expect(s?.rationale).not.toContain(`"${word}"`);
    }
  });

  it('warns against stuffing words that do not fit, in one plain line', () => {
    const [s] = run(DRAFT, ['What water temperature is best?']).suggestions;
    const warnings = (s?.rationale ?? '')
      .split(/(?<=[.!?])\s+/)
      .filter((line) => /do not (force|stuff)/i.test(line));
    expect(warnings).toHaveLength(1);
  });

  it('keeps one advisory per question, with distinct stable ids', () => {
    const qs = ['What water temperature is best?', 'Which milk foams best for a latte?'];
    const first = run(DRAFT, qs).suggestions.map((s) => s.id);
    const reordered = run(DRAFT, [...qs].reverse()).suggestions.map((s) => s.id);
    expect(new Set(first).size).toBe(2);
    expect([...reordered].sort()).toEqual([...first].sort());
  });

  it('matches word forms, so "steeps" up top counts for "steep"', () => {
    const md = '# How long cold brew steeps\n\nIt depends on the grind.\n';
    expect(run(md, ['How long should cold brew steep?']).score).toBe(1);
  });
});
