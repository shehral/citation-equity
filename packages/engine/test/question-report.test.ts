import { describe, expect, it } from 'vitest';
import espressoAfter from '../../../samples/espresso-bitterness/after.md?raw';
import espressoBefore from '../../../samples/espresso-bitterness/before.md?raw';
import espressoPack from '../../../samples/espresso-bitterness/pack.json';
import ragAfter from '../../../samples/rag-explained/after.md?raw';
import ragBefore from '../../../samples/rag-explained/before.md?raw';
import ragPack from '../../../samples/rag-explained/pack.json';
import { topOfDraft } from '../src/checks/structure-issues';
import { uniqueQuestions } from '../src/import-queries';
import {
  analyze,
  gather,
  parseDraft,
  questionCoverage,
  questionReport,
  type Range,
  readerWords,
  suggestionFor,
} from '../src/index';

const artifactsOf = (md: string) => gather(parseDraft(md));
const questionsOf = (pack: { queries: { query: string }[] }) => pack.queries.map((q) => q.query);
const slice = (md: string, r: Range) => md.slice(r.start, r.end);
const ESPRESSO = questionsOf(espressoPack);
const RAG = questionsOf(ragPack);

const SAMPLES = [
  ['espresso before', espressoBefore, ESPRESSO],
  ['espresso after', espressoAfter, ESPRESSO],
  ['RAG before', ragBefore, RAG],
  ['RAG after', ragAfter, RAG],
] as const;

describe('questionReport on the samples, with their pack questions', () => {
  it.each([
    ['espresso before', espressoBefore, ESPRESSO, []],
    ['espresso after', espressoAfter, ESPRESSO, ['How do I fix bitter espresso?']],
    ['RAG before', ragBefore, RAG, ['Should I use RAG or fine-tuning?']],
    [
      'RAG after',
      ragAfter,
      RAG,
      [
        'What is retrieval-augmented generation?',
        'How does a RAG pipeline work?',
        'Should I use RAG or fine-tuning?',
      ],
    ],
  ])('%s covers %j of 4', (_name, md, questions, covered) => {
    const rows = questionReport(artifactsOf(md), [...questions]);
    expect(rows.map((r) => r.question)).toEqual(questions);
    expect(rows.filter((r) => r.covered).map((r) => r.question)).toEqual(covered);
  });

  it.each(SAMPLES)(
    '%s: line (a) is readerWords and line (b) is questionCoverage, for each question',
    (_name, md, questions) => {
      const a = artifactsOf(md);
      for (const row of questionReport(a, [...questions])) {
        const [words] = readerWords(a, [row.question]);
        expect(row.words, row.question).toEqual(
          words === undefined
            ? null
            : { found: words.found, total: words.total, missing: words.missing },
        );
        expect(row.answer, row.question).toEqual(questionCoverage(a, [row.question])[0]);
        expect(row.covered, row.question).toBe(
          (row.words === null || row.words.missing.length === 0) && row.answer.covered,
        );
        expect(row.wordsRange, row.question).toEqual(topOfDraft(a));
      }
    },
  );

  it('reads 2 of 4 on the espresso draft after the two typed edits of the paper figure', () => {
    const heading = '## Why espresso turns bitter\n\n';
    const at = espressoBefore.indexOf(heading) + heading.length;
    expect(at).toBeGreaterThan(heading.length);
    // (1) the title gains the second question; (2) the section opens with a direct answer.
    const answer =
      'Espresso tastes bitter when too much comes out of the coffee, and you fix it with a coarser grind or cooler water. ';
    const edited = `${espressoBefore.slice(0, at)}${answer}${espressoBefore.slice(at)}`.replace(
      '# Why does my espresso taste bitter?',
      '# Why does my espresso taste bitter, and how do I fix it?',
    );
    // The title edit took effect (a changed sample title would make it a silent no-op).
    expect(edited).toContain('# Why does my espresso taste bitter, and how do I fix it?\n');
    const rows = questionReport(artifactsOf(edited), ESPRESSO);
    expect(rows.map((r) => r.covered)).toEqual([true, true, false, false]);
  });
});

describe('questionReport', () => {
  const a = artifactsOf(espressoBefore);

  it('drops blank and repeated questions (ignoring case, spacing and a closing "?"), keeps order and the first wording', () => {
    const rows = questionReport(a, [
      '  ',
      ' How do I fix bitter espresso? ',
      '',
      'Why does my espresso taste bitter?',
      'how do i  fix bitter espresso',
      '?',
      'WHY DOES MY ESPRESSO TASTE BITTER??',
    ]);
    expect(rows.map((r) => r.question)).toEqual([
      'How do I fix bitter espresso?',
      'Why does my espresso taste bitter?',
    ]);
    expect(questionReport(a, [])).toEqual([]);
    expect(questionReport(a, [' ', '?'])).toEqual([]);
  });

  it('reads both lines from the checks over the whole list: blanks, repeats, stray spaces and a question with no key words', () => {
    const asked = [
      '',
      '  How does it work? ',
      'How do I fix bitter espresso?',
      'how do i  fix bitter espresso',
      'Why does my espresso taste bitter?',
      '   ',
      'HOW DOES IT WORK??',
      'What water temperature is best?',
    ];
    const rows = questionReport(a, asked);
    const unique = uniqueQuestions(asked);
    expect(rows.map((r) => r.question)).toEqual(unique);
    expect(rows.map((r) => r.words === null)).toEqual([true, false, false, false]);
    // Line (a): readerWords over the same list keeps exactly the rows with key words, as they are.
    expect(
      rows.flatMap((r) => (r.words === null ? [] : [{ question: r.question, ...r.words }])),
    ).toEqual(readerWords(a, asked));
    // A null line (a) only ever means the question has no key words to look for.
    for (const row of rows.filter((r) => r.words === null))
      expect(readerWords(a, [row.question]), row.question).toEqual([]);
    // Line (b): questionCoverage over the same questions, row for row.
    expect(rows.map((r) => r.answer)).toEqual(questionCoverage(a, unique));
  });

  it('gives words: null to a question with no key words to look for, and judges it on its answer alone', () => {
    const md =
      '# Notes\n\n## How does it work?\n\nIt works by pushing hot water through a puck of ground coffee.\n';
    const [row] = questionReport(artifactsOf(md), ['How does it work?']);
    expect(row?.words).toBeNull();
    expect(row?.answer.covered).toBe(true);
    expect(row?.covered).toBe(true);
  });

  it('marks a question covered only when its words are up top and a section answers it', () => {
    const rows = questionReport(a, ESPRESSO);
    // The title is the first question: its words are up top, but no section answers it yet.
    expect(rows[0]?.words).toEqual({ found: 3, total: 3, missing: [] });
    expect(rows[0]?.answer.covered).toBe(false);
    expect(rows[0]?.covered).toBe(false);
    expect(rows[1]?.words?.missing).toEqual(['fix']);
  });

  describe('answerRange', () => {
    it("is the first sentence of the matching section's first paragraph", () => {
      const md =
        '# Espresso\n\n## How long should a shot take?\n\nA shot should take 25 to 30 seconds from the first drip. Taste matters more.\n';
      const [row] = questionReport(artifactsOf(md), ['How long should a shot take?']);
      expect(slice(md, row?.answer.range ?? { start: 0, end: 0 })).toBe(
        'How long should a shot take?',
      );
      expect(slice(md, row?.answerRange ?? { start: 0, end: 0 })).toBe(
        'A shot should take 25 to 30 seconds from the first drip.',
      );
    });

    it('is an empty range right after the heading when its section has no prose', () => {
      const md = '# Espresso\n\n## How long should a shot take?\n\n- 25 seconds\n- 30 seconds\n';
      const [row] = questionReport(artifactsOf(md), ['How long should a shot take?']);
      const end =
        md.indexOf('How long should a shot take?') + 'How long should a shot take?'.length;
      expect(row?.answer.message).toBe(
        'The matching section has no sentence that answers this question.',
      );
      expect(row?.answerRange).toEqual({ start: end, end });
    });

    it('is the matching sentence itself when a paragraph, not a heading, matches', () => {
      const md = '# Notes\n\nA good shot takes about 25 seconds from the first drip to the last.\n';
      const [row] = questionReport(artifactsOf(md), ['How long does a shot take?']);
      expect(slice(md, row?.answerRange ?? { start: 0, end: 0 })).toBe(
        'A good shot takes about 25 seconds from the first drip to the last.',
      );
      expect(row?.answerRange).toEqual(row?.answer.range);
    });

    it('is an empty range right after the top of the draft when nothing matches', () => {
      const md = '# Notes\n\nNothing here yet.\n';
      const b = artifactsOf(md);
      const [row] = questionReport(b, ['Why is the sky blue?']);
      expect(row?.answer.message).toBe(
        'No heading or paragraph in the draft uses the key words of this question.',
      );
      const top = topOfDraft(b);
      expect(row?.answerRange).toEqual({ start: top.end, end: top.end });
    });
  });
});

describe('suggestionFor', () => {
  const result = analyze(espressoBefore, { questions: ESPRESSO });
  const rows = questionReport(artifactsOf(espressoBefore), ESPRESSO);

  it("finds each open line's suggestion by the check's title, and none for a line that is met", () => {
    for (const row of rows) {
      const words = suggestionFor(result, 'reader-words', row.question);
      if (row.words === null || row.words.missing.length === 0) expect(words).toBeUndefined();
      else {
        expect(words?.checkId, row.question).toBe('reader-words');
        expect(words?.title).toBe(`Use the words of "${row.question}" up top`);
        expect(words?.range).toEqual(row.wordsRange);
      }
      const answer = suggestionFor(result, 'question-coverage', row.question);
      if (row.answer.covered) expect(answer).toBeUndefined();
      else {
        expect(answer?.checkId, row.question).toBe('question-coverage');
        expect(answer?.title).toBe(`Answer "${row.question}" directly`);
        expect(answer?.range).toEqual(row.answer.range);
      }
    }
    // Three questions miss words up top ("fix"; "water", "temperature"; "long"); none is answered.
    expect(rows.filter((r) => suggestionFor(result, 'reader-words', r.question))).toHaveLength(3);
    expect(rows.filter((r) => suggestionFor(result, 'question-coverage', r.question))).toHaveLength(
      4,
    );
  });

  it('trims the question and finds nothing for a question the result did not measure', () => {
    expect(suggestionFor(result, 'question-coverage', '  How do I fix bitter espresso? ')).toBe(
      suggestionFor(result, 'question-coverage', 'How do I fix bitter espresso?'),
    );
    expect(suggestionFor(result, 'question-coverage', 'Is decaf bitter?')).toBeUndefined();
    expect(suggestionFor(analyze(''), 'reader-words', ESPRESSO[0] ?? '')).toBeUndefined();
  });
});
