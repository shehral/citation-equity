import { QUESTION_LABELS, type SiteQuestionTemplate } from '@citation-equity/engine';
import { describe, expect, it } from 'vitest';
import * as questionsModule from '@/lib/questions';
import {
  editProblem,
  hasQuestion,
  initialQuestions,
  inputKindOf,
  isQuestionTemplate,
  labelsFor,
  MAX_QUESTIONS,
  mergeQuestions,
  SOURCE_LABELS,
  type WorkspaceQuestionSource,
} from '@/lib/questions';
import { getSample, SAMPLES } from '@/lib/samples';

describe('the questions the engine measures', () => {
  it('are every listed question: no author-only subset is kept for the engine', () => {
    // The engine measures the draft's whole list; each row's input kind gives its label.
    expect(questionsModule).not.toHaveProperty('authorQuestionTexts');
  });
});

describe('initialQuestions', () => {
  it("prefills a sample from its pack's queries", () => {
    const sample = getSample('espresso-bitterness');
    const pack = sample.pack as { queries: { query: string }[] };
    const questions = initialQuestions(sample);
    expect(questions.map((q) => q.text)).toEqual(
      pack.queries.slice(0, MAX_QUESTIONS).map((q) => q.query),
    );
    expect(questions.every((q) => q.source === 'sample-pack')).toBe(true);
  });

  it('starts a draft without a pack with no questions, so the page questions are measured', () => {
    const custom = { ...getSample(SAMPLES[0]?.slug ?? ''), pack: undefined };
    expect(initialQuestions(custom)).toEqual([]);
    expect(initialQuestions(null)).toEqual([]);
  });
});

describe('inputKindOf and labelsFor', () => {
  const TEMPLATES: SiteQuestionTemplate[] = [
    'as-written',
    'what-is',
    'how-to',
    'how-it-works',
    'comparison',
    'best',
    'yes-no',
    'kept',
  ];

  it("reads typed, pack and imported questions as the reader's own", () => {
    for (const source of ['user', 'sample-pack', 'search-console', 'bing-ai'] as const) {
      expect(inputKindOf({ text: 'Q?', source }), source).toBe('reader');
      // A template on an export's query does not make it a guess.
      expect(inputKindOf({ text: 'Q?', source, template: 'what-is' }), source).toBe('reader');
    }
  });

  it("reads a home-list question typed as a question as the reader's, a keyword guess as a keyword", () => {
    expect(inputKindOf({ text: 'Q?', source: 'keywords', template: 'as-written' })).toBe('reader');
    for (const template of TEMPLATES.filter((t) => t !== 'as-written')) {
      expect(inputKindOf({ text: 'Q?', source: 'keywords', template }), template).toBe('keyword');
    }
    // An item saved before templates were stored is a keyword.
    expect(inputKindOf({ text: 'Q?', source: 'keywords' })).toBe('keyword');
  });

  it('reads local-model questions as such, and heading or template questions as the page', () => {
    expect(inputKindOf({ text: 'Q?', source: 'local-model' })).toBe('local-model');
    expect(inputKindOf({ text: 'Q?', source: 'local-model', template: 'as-written' })).toBe(
      'local-model',
    );
    expect(inputKindOf({ text: 'Q?', source: 'draft-heading' })).toBe('page');
    expect(inputKindOf({ text: 'Q?', source: 'template' })).toBe('page');
  });

  it('gives every source a kind', () => {
    for (const source of Object.keys(SOURCE_LABELS) as WorkspaceQuestionSource[]) {
      expect(['reader', 'keyword', 'local-model', 'page']).toContain(
        inputKindOf({ text: 'Q?', source }),
      );
    }
  });

  it("gives a row the engine's two line labels for its kind", () => {
    expect(labelsFor({ text: 'Q?', source: 'sample-pack' })).toEqual(QUESTION_LABELS.reader);
    expect(labelsFor({ text: 'Q?', source: 'keywords', template: 'how-to' })).toEqual(
      QUESTION_LABELS.keyword,
    );
    expect(labelsFor({ text: 'Q?', source: 'local-model' })).toEqual(
      QUESTION_LABELS['local-model'],
    );
    expect(labelsFor({ text: 'Q?', source: 'draft-heading' })).toEqual(QUESTION_LABELS.page);
    // The label values themselves are E5's to change (engine/src/e5.ts), so none is fixed here.
    expect(labelsFor({ text: 'Q?', source: 'user' })).toEqual(QUESTION_LABELS.reader);
    expect(labelsFor({ text: 'Q?', source: 'keywords' })).toEqual(QUESTION_LABELS.keyword);
  });

  it('knows the template names', () => {
    for (const t of TEMPLATES) expect(isQuestionTemplate(t), t).toBe(true);
    for (const v of ['', 'What-is', 'template', 3, null, undefined]) {
      expect(isQuestionTemplate(v), String(v)).toBe(false);
    }
  });
});

describe('mergeQuestions', () => {
  it('adds only new questions (ignoring case and spacing) and stops at 8', () => {
    const base = [{ text: 'What is cold brew?', source: 'template' as const }];
    expect(
      mergeQuestions(base, [
        { text: 'what is  COLD brew?', source: 'local-model' },
        { text: 'Is cold brew strong?', source: 'local-model' },
      ]),
    ).toEqual([...base, { text: 'Is cold brew strong?', source: 'local-model' }]);
    const many = Array.from({ length: 12 }, (_, i) => ({
      text: `Q${i}?`,
      source: 'user' as const,
    }));
    expect(mergeQuestions(base, many)).toHaveLength(MAX_QUESTIONS);
  });

  it("keeps a question's template, and adds none to a question without one", () => {
    const merged = mergeQuestions(
      [],
      [
        { text: ' How to dial in espresso? ', source: 'keywords', template: 'how-to' },
        { text: 'Is crema good?', source: 'user' },
      ],
    );
    expect(merged).toEqual([
      { text: 'How to dial in espresso?', source: 'keywords', template: 'how-to' },
      { text: 'Is crema good?', source: 'user' },
    ]);
    expect(merged[1]).not.toHaveProperty('template');
  });
});

describe('SOURCE_LABELS', () => {
  it('labels every source in plain words', () => {
    for (const label of Object.values(SOURCE_LABELS)) expect(label).toMatch(/^[A-Z][a-z]/);
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual([
      'bing-ai',
      'draft-heading',
      'keywords',
      'local-model',
      'sample-pack',
      'search-console',
      'template',
      'user',
    ]);
  });
});

describe('question keys follow the engine (a closing "?" does not make a new question)', () => {
  const list = [
    { text: 'What is crema?', source: 'user' as const },
    { text: 'How long is a shot?', source: 'user' as const },
  ];

  it('treats "What is crema" and "What is crema?" as the same question', () => {
    expect(hasQuestion(list, 'what is crema')).toBe(true);
    expect(mergeQuestions(list, [{ text: 'What is crema', source: 'template' }])).toEqual(list);
  });

  it('refuses an edit that empties a question or repeats another', () => {
    expect(editProblem(list, 1, '   ')).toMatch(/empty/);
    expect(editProblem(list, 1, 'What is crema')).toMatch(/already on the list/);
    expect(editProblem(list, 0, 'What is crema!')).toBeNull();
    expect(editProblem(list, 1, 'How long should a shot take?')).toBeNull();
  });
});
