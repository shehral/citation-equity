import { describe, expect, it } from 'vitest';
import { generateQuestions, questionContext } from '../src/index';
import declarative from './fixtures/questions/declarative.md?raw';
import noTitle from './fixtures/questions/no-title.md?raw';
import questions from './fixtures/questions/questions.md?raw';

describe('generateQuestions', () => {
  it('rewrites declarative H2/H3 headings with templates, then adds topic questions', () => {
    expect(generateQuestions(declarative)).toEqual([
      { text: 'How do you make a concentrate?', source: 'template' },
      { text: 'What are the benefits of a long steep?', source: 'template' },
      { text: 'Cold brew or iced coffee: which is better?', source: 'template' },
      { text: 'Glass or plastic jars: which is better?', source: 'template' },
      { text: 'Why the taste is smoother?', source: 'template' },
      { text: 'What is cold brew?', source: 'template' },
      { text: 'How does cold brew work?', source: 'template' },
    ]);
  });

  it('keeps a question H1 and question headings first, deduplicated case-insensitively', () => {
    expect(generateQuestions(questions)).toEqual([
      { text: 'What is cold brew?', source: 'draft-heading' },
      { text: 'How long should it steep?', source: 'draft-heading' },
      { text: 'Does grind size matter?', source: 'draft-heading' },
      { text: 'How do you filter it?', source: 'template' },
      { text: 'How does cold brew work?', source: 'template' },
    ]);
  });

  it('never returns a question-like sentence from the body, a list or a quote', () => {
    const texts = generateQuestions(declarative).map((q) => q.text.toLowerCase());
    for (const body of ['stronger than espresso', 'add milk', 'keep for a week'])
      expect(texts.some((t) => t.includes(body))).toBe(false);
  });

  it('takes the topic from the first paragraph when there is no H1, and reads no further', () => {
    expect(generateQuestions(noTitle)).toEqual([
      { text: 'What are sourdough starters?', source: 'template' },
      { text: 'How do sourdough starters work?', source: 'template' },
    ]);
  });

  it('keeps hyphens, drops page-kind words, and lowercases only words the draft writes lowercase', () => {
    const rag =
      '# Retrieval-augmented generation, explained\n\nRetrieval-augmented generation lets a model look things up.\n\n## What is retrieval-augmented generation?\n\nIt is retrieval plus generation.\n';
    expect(generateQuestions(rag)).toEqual([
      { text: 'What is retrieval-augmented generation?', source: 'draft-heading' },
      { text: 'How does retrieval-augmented generation work?', source: 'template' },
    ]);
    const k8s = '# A Kubernetes guide\n\nKubernetes runs containers for small teams.\n';
    expect(generateQuestions(k8s).map((q) => q.text)).toEqual([
      'What is Kubernetes?',
      'How does Kubernetes work?',
    ]);
  });

  it('gives the topic the article the draft uses, and asks how it works only of a mechanism', () => {
    const texts = (md: string) => generateQuestions(md).map((q) => q.text);
    expect(texts('# Choosing a road bike\n\nA road bike is light and fast on pavement.\n')).toEqual(
      ['What is a road bike?', 'How does a road bike work?'],
    );
    expect(texts('# A weekend in Lisbon\n\nLisbon is a hilly city on the coast.\n')).toEqual([
      'What is Lisbon?',
    ]);
    // Only "This paragraph": no topic question reads naturally.
    expect(texts('# Notes\n\nThis paragraph is a test.\n')).toEqual([]);
    expect(texts('# My new pan\n\nIt works great.\n')).toEqual([]);
  });

  it('reads a Title Case title in lowercase, so a capitalised verb is not a topic', () => {
    const texts = generateQuestions(
      '# How I Built a Sourdough Starter\n\nIt took me two weeks.\n',
    ).map((q) => q.text);
    expect(texts).not.toContain('What is Built?');
    expect(texts).toEqual(['What is a sourdough starter?', 'How does a sourdough starter work?']);
  });

  it('keeps the capitals of a name in a Title Case title or heading', () => {
    const texts = (md: string) => generateQuestions(md).map((q) => q.text);
    expect(texts('# Steve Jobs\n\nSteve Jobs founded Apple in a garage.\n')).toEqual([
      'What is Steve Jobs?',
    ]);
    expect(
      texts('# Visual Studio Code Tips\n\nVisual Studio Code is a free code editor.\n'),
    ).toEqual(['What is Visual Studio Code?', 'How does Visual Studio Code work?']);
    expect(
      texts(
        '# Analytics\n\nTrack visits.\n\n## Benefits of Google Analytics\n\nA.\n\n## Setup\n\nB.\n',
      ),
    ).toContain('What are the benefits of Google Analytics?');
    // The draft writes "a Chemex" mid-sentence, here in the section body.
    expect(
      texts(
        '# Pour over\n\nPour over is slow.\n\n## How to Brew with a Chemex\n\nA Chemex uses thick filters.\n\n## Grind\n\nB.\n',
      ),
    ).toContain('How do you brew with a Chemex?');
    // A word next to a name is not a name itself.
    expect(texts('# Steve Jobs Biography\n\nHe founded a company.\n')).toEqual([
      'What is Steve Jobs biography?',
    ]);
  });

  it('keeps a topic the draft writes only after "the", with "the"', () => {
    const texts = (md: string) => generateQuestions(md).map((q) => q.text);
    expect(texts('# The French press\n\nThe French press makes a heavy cup.\n')[0]).toBe(
      'What is the French press?',
    );
    expect(texts('# Apple Watch tips\n\nThe Apple Watch is a smartwatch.\n')[0]).toBe(
      'What is the Apple Watch?',
    );
  });

  it('rewrites Title Case headings in lowercase and skips templates that misread a heading', () => {
    const md =
      '# Cold brew\n\nCold brew is coffee steeped in cold water.\n\n## How to Make Cold Brew at Home\n\nA.\n\n## Why grind or dose matters\n\nB.\n\n## How we tested\n\nC.\n\n## Why it matters\n\nD.\n\n## Burr or blade\n\nE.\n';
    expect(generateQuestions(md).map((q) => q.text)).toEqual([
      'How do you make cold brew at home?',
      'Why grind or dose matters?',
      'Burr or blade: which is better?',
      'What is cold brew?',
      'How does cold brew work?',
    ]);
  });

  it('returns at most 8 questions by default, or `max`', () => {
    const md = `# Ten questions\n\n${Array.from(
      { length: 10 },
      (_, i) => `## Question number ${i + 1}?\n\nAnswer ${i + 1}.\n`,
    ).join('\n')}`;
    const all = generateQuestions(md);
    expect(all).toHaveLength(8);
    expect(all[0]).toEqual({ text: 'Question number 1?', source: 'draft-heading' });
    expect(generateQuestions(md, { max: 3 }).map((q) => q.text)).toEqual([
      'Question number 1?',
      'Question number 2?',
      'Question number 3?',
    ]);
    expect(generateQuestions(md, { max: 0 })).toEqual([]);
  });

  it('returns nothing for an empty draft', () => {
    expect(generateQuestions('')).toEqual([]);
    expect(generateQuestions('   \n\n')).toEqual([]);
  });
});

describe('questionContext', () => {
  it('is the H1 and the first prose paragraph only', () => {
    expect(questionContext(declarative)).toEqual({
      title: 'Cold brew at home',
      intro:
        'Cold brew is coffee steeped in cold water for twelve hours or more. Making it at home takes a jar, a filter and some patience.',
    });
    expect(questionContext(noTitle).title).toBe('');
    expect(questionContext(noTitle).intro).toMatch(/^Sourdough starters/);
  });
});
