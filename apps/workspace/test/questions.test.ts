import { generateQuestions } from '@citation-equity/engine';
import { describe, expect, it } from 'vitest';
import {
  authorQuestionTexts,
  editProblem,
  hasQuestion,
  initialQuestions,
  MAX_QUESTIONS,
  mergeQuestions,
  SOURCE_LABELS,
} from '@/lib/questions';
import { getSample, SAMPLES } from '@/lib/samples';

describe('authorQuestionTexts', () => {
  it('keeps the questions the author typed or imported, never the generated ones', () => {
    expect(
      authorQuestionTexts([
        { text: 'Typed?', source: 'user' },
        { text: 'From a heading?', source: 'draft-heading' },
        { text: 'From a template?', source: 'template' },
        { text: 'From the local model?', source: 'local-model' },
        { text: 'Pack?', source: 'sample-pack' },
        { text: 'Search Console?', source: 'search-console' },
        { text: 'Bing?', source: 'bing-ai' },
      ]),
    ).toEqual(['Typed?', 'Pack?', 'Search Console?', 'Bing?']);
  });
});

describe('initialQuestions', () => {
  it("prefills a sample from its pack's queries", () => {
    const sample = getSample('espresso-bitterness');
    const pack = sample.pack as { queries: { query: string }[] };
    const questions = initialQuestions(sample, sample.before);
    expect(questions.map((q) => q.text)).toEqual(
      pack.queries.slice(0, MAX_QUESTIONS).map((q) => q.query),
    );
    expect(questions.every((q) => q.source === 'sample-pack')).toBe(true);
  });

  it('starts a draft without a pack from its own question headings; templates wait for a click', () => {
    const custom = { ...getSample(SAMPLES[0]?.slug ?? ''), pack: undefined };
    const md =
      '# Cold brew at home\n\nCold brew is coffee steeped in cold water.\n\n## How long does it keep?\n\nA week.\n\n## How to store it\n\nIn the fridge.\n';
    const own = [{ text: 'How long does it keep?', source: 'draft-heading' }];
    expect(initialQuestions(custom, md)).toEqual(own);
    expect(initialQuestions(null, md)).toEqual(own);
    // The templates are what "Suggest from draft" adds.
    expect(generateQuestions(md).some((q) => q.source === 'template')).toBe(true);
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
