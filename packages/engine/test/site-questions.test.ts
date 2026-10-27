import { describe, expect, it } from 'vitest';
import {
  HOW_TO_VERBS,
  type ImportedQuery,
  keywordQuestion,
  parseKeywordList,
  parseQueriesCsv,
  SITE_QUESTIONS_MAX,
  siteQuestionNumbers,
  siteQuestions,
} from '../src/index';
import bingQueries from './fixtures/import-queries/bing-grounding-queries.csv?raw';
import scQueries from './fixtures/import-queries/search-console-queries.csv?raw';

const texts = (input: Parameters<typeof siteQuestions>[0]) =>
  siteQuestions(input).map((q) => q.text);

/** Words a template may add; every other word of a question comes from its keyword. */
const TEMPLATE_WORDS = new Set(
  'what is are the best how to does do work or which better in'.split(' '),
);
const wordsOf = (s: string): string[] =>
  s.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];

describe('parseKeywordList', () => {
  it('reads one keyword per line, with an optional volume after a comma or a tab', () => {
    expect(
      parseKeywordList(
        'espresso bitter\nespresso shot time, 1900\r\nespresso grinder\t1,200\n\n# a note\n  crema  \n',
      ),
    ).toEqual([
      { text: 'espresso bitter' },
      { text: 'espresso shot time', volume: 1900 },
      { text: 'espresso grinder', volume: 1200 },
      { text: 'crema' },
    ]);
  });

  it('keeps a comma that belongs to the keyword, and reads thousands separators', () => {
    expect(parseKeywordList('coffee, tea\nespresso, 1,900\n"cold brew", 40')).toEqual([
      { text: 'coffee, tea' },
      { text: 'espresso', volume: 1900 },
      { text: 'cold brew', volume: 40 },
    ]);
  });

  it('reads a keyword table with a header row, comma or tab separated', () => {
    const csv = 'Keyword,Volume,KD\nespresso bitter,880,12\n"espresso shot time","1,900",8\n';
    expect(parseKeywordList(csv)).toEqual([
      { text: 'espresso bitter', volume: 880 },
      { text: 'espresso shot time', volume: 1900 },
    ]);
    const tsv = 'Keyword\tSearch volume\ncrema\t320\nespresso beans\t\n';
    expect(parseKeywordList(tsv)).toEqual([
      { text: 'crema', volume: 320 },
      { text: 'espresso beans' },
    ]);
  });

  it('reads a one-column table and an empty text', () => {
    expect(parseKeywordList('Keywords\ncrema\nespresso beans')).toEqual([
      { text: 'crema' },
      { text: 'espresso beans' },
    ]);
    expect(parseKeywordList('')).toEqual([]);
    expect(parseKeywordList('\n  \n# only a note\n')).toEqual([]);
  });
});

describe('keywordQuestion: conservative templates', () => {
  it('keeps a question as written, with a capital and one "?"', () => {
    expect(keywordQuestion('Why is my espresso bitter?')).toEqual({
      text: 'Why is my espresso bitter?',
      template: 'as-written',
    });
    expect(keywordQuestion('how long should an espresso shot take').text).toBe(
      'How long should an espresso shot take?',
    );
    expect(keywordQuestion('how to descale an espresso machine').text).toBe(
      'How to descale an espresso machine?',
    );
    expect(keywordQuestion('can i reuse espresso grounds').text).toBe(
      'Can I reuse espresso grounds?',
    );
  });

  it('keeps a bare question stem as written', () => {
    for (const k of ['how to', 'what is', 'why', 'How to?']) {
      expect(keywordQuestion(k)).toEqual({ text: k, template: 'kept' });
    }
  });

  it('asks a yes-or-no question of a judgment, never "why" (no presupposed claim)', () => {
    expect(keywordQuestion('weight loss pills safe')).toEqual({
      text: 'Are weight loss pills safe?',
      template: 'yes-no',
    });
    expect(keywordQuestion('raw eggs safe to eat').text).toBe('Are raw eggs safe to eat?');
    expect(keywordQuestion('grapes safe for dogs').text).toBe('Are grapes safe for dogs?');
    expect(keywordQuestion('bitcoin legit').text).toBe('Is bitcoin legit?');
    expect(keywordQuestion('espresso healthy').text).toBe('Is espresso healthy?');
    for (const k of [
      'weight loss pills safe',
      'keto healthy',
      'flights cheap',
      'espresso bitter',
    ]) {
      expect(keywordQuestion(k).text, k).not.toMatch(/^Why\b/);
    }
    // A singular thing of several words would need an article: kept as written.
    expect(keywordQuestion('keto diet healthy')).toEqual({
      text: 'keto diet healthy',
      template: 'kept',
    });
    expect(keywordQuestion('lever espresso machine worth it').template).toBe('kept');
  });

  it('asks how to only after a verb from the curated list', () => {
    expect(keywordQuestion('make cold brew')).toEqual({
      text: 'How to make cold brew?',
      template: 'how-to',
    });
    expect(keywordQuestion('descale espresso machine').text).toBe(
      'How to descale espresso machine?',
    );
    expect(keywordQuestion('lose weight fast').text).toBe('How to lose weight fast?');
    for (const k of [
      'tax deductions for freelancers',
      'stock market crash',
      'clean eating',
      'build quality',
      'store hours',
      'pull request',
    ]) {
      expect(keywordQuestion(k).text, k).not.toMatch(/^How to/);
    }
  });

  it('keeps the curated how-to verb list explicit', () => {
    expect([...HOW_TO_VERBS].sort()).toEqual(
      [
        'make',
        'fix',
        'descale',
        'dial',
        'tamp',
        'choose',
        'install',
        'uninstall',
        'adjust',
        'calibrate',
        'froth',
        'remove',
        'replace',
        'measure',
        'reduce',
        'improve',
        'prevent',
        'avoid',
        'learn',
        'cook',
        'bake',
        'repair',
        'troubleshoot',
        'unclog',
        'backflush',
        'reuse',
        'recycle',
        'sharpen',
        'lose',
        'apply',
        'cancel',
        'calculate',
        'convert',
        'delete',
        'create',
        'invest',
        'save',
        'write',
        'become',
      ].sort(),
    );
    // None of them is a noun that starts a common compound.
    for (const noun of [
      'tax',
      'stock',
      'clean',
      'build',
      'store',
      'pull',
      'grind',
      'steam',
      'brew',
    ]) {
      expect(HOW_TO_VERBS.has(noun), noun).toBe(false);
    }
  });

  it('asks "What are X?" only of a short plural concept, and keeps singular, local, service, place and brand keywords', () => {
    expect(keywordQuestion('espresso beans')).toEqual({
      text: 'What are espresso beans?',
      template: 'what-is',
    });
    expect(keywordQuestion('index funds').text).toBe('What are index funds?');
    for (const k of [
      'credit card',
      'credit score',
      'crema',
      'houston plumber',
      'new york',
      'texas',
      'dentist near me',
      'weight watchers',
      'kubernetes',
    ]) {
      expect(keywordQuestion(k), k).toEqual({ text: k, template: 'kept' });
    }
  });

  it('asks for the best by the head noun’s number, and only when the keyword opens with "best"', () => {
    expect(keywordQuestion('best espresso grinder for beginners')).toEqual({
      text: 'What is the best espresso grinder for beginners?',
      template: 'best',
    });
    expect(keywordQuestion('best practices for react').text).toBe(
      'What are the best practices for react?',
    );
    expect(keywordQuestion('best espresso beans').text).toBe('What are the best espresso beans?');
    expect(keywordQuestion('best espresso grinder 2026').text).toBe(
      'What is the best espresso grinder in 2026?',
    );
    expect(keywordQuestion('best credit cards 2026').text).toBe(
      'What are the best credit cards in 2026?',
    );
    for (const k of ['best of 2026', 'best buy near me', 'best buy', 'best pizza near me']) {
      expect(keywordQuestion(k), k).toEqual({ text: k, template: 'kept' });
    }
    for (const k of ['espresso grinder', 'top espresso grinder', 'espresso grinder best']) {
      expect(keywordQuestion(k).text.toLowerCase(), k).not.toContain('the best');
    }
  });

  it('asks how X works of "X explained"', () => {
    expect(keywordQuestion('espresso extraction explained')).toEqual({
      text: 'How does espresso extraction work?',
      template: 'how-it-works',
    });
    expect(keywordQuestion('taxes explained').text).toBe('How do taxes work?');
  });

  it('compares two items as typed, and counts "X vs Y" and "X vs Y?" as one', () => {
    expect(keywordQuestion('espresso vs drip coffee')).toEqual({
      text: 'Which is better: espresso or drip coffee?',
      template: 'comparison',
    });
    expect(keywordQuestion('roth IRA vs traditional IRA').text).toBe(
      'Which is better: roth IRA or traditional IRA?',
    );
    expect(keywordQuestion('Python 3 vs Python 2').text).toBe(
      'Which is better: Python 3 or Python 2?',
    );
    expect(keywordQuestion('Apple iPhone 15 versus Samsung Galaxy S24').text).toBe(
      'Which is better: Apple iPhone 15 or Samsung Galaxy S24?',
    );
    expect(keywordQuestion('espresso vs drip?').text).toBe('Which is better: espresso or drip?');
    expect(texts({ keywords: 'Espresso vs drip\nespresso vs drip?' })).toEqual([
      'Which is better: Espresso or drip?',
    ]);
  });

  it('keeps a keyword with a comma or other punctuation inside as written', () => {
    expect(siteQuestions({ keywords: '"tea, green", 40' })).toEqual([
      {
        text: 'tea, green',
        keyword: 'tea, green',
        source: 'keywords',
        template: 'kept',
        volume: 40,
      },
    ]);
  });

  it('keeps other keywords exactly as written', () => {
    for (const k of [
      'espresso bitter',
      'espresso shot time',
      'grinder price',
      'running shoes for flat feet',
      'tesla model 3 battery life',
      'docker compose tutorial',
      'gluten free bread recipe',
      'bitcoin price',
      'cheap flights to paris',
    ]) {
      expect(keywordQuestion(k), k).toEqual({ text: k, template: 'kept' });
    }
  });

  // At least 40 realistic keywords across domains: what each becomes, or that it stays.
  const TABLE: [string, string][] = [
    // coffee
    ['espresso vs drip coffee', 'Which is better: espresso or drip coffee?'],
    ['best espresso grinder for beginners', 'What is the best espresso grinder for beginners?'],
    ['espresso beans', 'What are espresso beans?'],
    ['espresso bitter', 'espresso bitter'],
    ['espresso shot time', 'espresso shot time'],
    ['how to dial in espresso', 'How to dial in espresso?'],
    ['descale espresso machine', 'How to descale espresso machine?'],
    ['crema', 'crema'],
    // finance
    ['tax deductions for freelancers', 'tax deductions for freelancers'],
    ['stock market crash', 'stock market crash'],
    ['credit score', 'credit score'],
    ['credit card', 'credit card'],
    ['index funds', 'What are index funds?'],
    ['roth IRA vs traditional IRA', 'Which is better: roth IRA or traditional IRA?'],
    ['best credit cards 2026', 'What are the best credit cards in 2026?'],
    ['bitcoin legit', 'Is bitcoin legit?'],
    ['bitcoin price', 'bitcoin price'],
    ['invest in index funds', 'How to invest in index funds?'],
    ['save money on groceries', 'How to save money on groceries?'],
    ['calculate mortgage payment', 'How to calculate mortgage payment?'],
    ['mortgage rates', 'What are mortgage rates?'],
    ['what is a roth ira', 'What is a roth ira?'],
    // health
    ['weight loss pills safe', 'Are weight loss pills safe?'],
    ['raw eggs safe to eat', 'Are raw eggs safe to eat?'],
    ['grapes safe for dogs', 'Are grapes safe for dogs?'],
    ['keto diet healthy', 'keto diet healthy'],
    ['lose weight fast', 'How to lose weight fast?'],
    ['weight watchers', 'weight watchers'],
    ['gluten free bread recipe', 'gluten free bread recipe'],
    // tech
    ['best practices for react', 'What are the best practices for react?'],
    ['install python on mac', 'How to install python on mac?'],
    ['Python 3 vs Python 2', 'Which is better: Python 3 or Python 2?'],
    ['docker compose tutorial', 'docker compose tutorial'],
    ['kubernetes', 'kubernetes'],
    ['machine learning explained', 'How does machine learning work?'],
    ['is react worth learning', 'Is react worth learning?'],
    ['build quality', 'build quality'],
    // local and shopping
    ['houston plumber', 'houston plumber'],
    ['dentist near me', 'dentist near me'],
    ['best buy near me', 'best buy near me'],
    ['new york', 'new york'],
    ['cheap flights to paris', 'cheap flights to paris'],
    ['best running shoes', 'What are the best running shoes?'],
    ['running shoes for flat feet', 'running shoes for flat feet'],
    ['tesla model 3 battery life', 'tesla model 3 battery life'],
    ['best of 2026', 'best of 2026'],
    // home
    ['fix leaking faucet', 'How to fix leaking faucet?'],
    ['clean eating', 'clean eating'],
    ['how to', 'how to'],
  ];

  it(`gives the expected question or keeps the keyword, over ${TABLE.length} keywords`, () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(40);
    for (const [keyword, expected] of TABLE) {
      expect(keywordQuestion(keyword).text, keyword).toBe(expected);
    }
  });

  it('never presupposes a claim, never drops a keyword word, never adds one beyond its template', () => {
    for (const [keyword] of TABLE) {
      const { text, template } = keywordQuestion(keyword);
      expect(text, keyword).not.toMatch(/^Why\b/);
      const own = new Set(wordsOf(keyword));
      const asked = wordsOf(text);
      expect(
        asked.filter((w) => !own.has(w) && !TEMPLATE_WORDS.has(w)),
        keyword,
      ).toEqual([]);
      if (template !== 'comparison' && template !== 'how-it-works') {
        // Every keyword word survives (a closing year moves after "in"); only "vs" and
        // "explained" are replaced by their templates.
        expect(
          [...own].filter((w) => !asked.includes(w)),
          keyword,
        ).toEqual([]);
      }
    }
  });
});

describe('siteQuestions', () => {
  const ESPRESSO = [
    'espresso bitter',
    'espresso shot time, 1900',
    'best espresso grinder for beginners, 720',
    'espresso vs drip coffee, 2400',
    'how to dial in espresso',
  ].join('\n');

  it('ranks by volume when given, then the rest in list order, each with its keyword', () => {
    expect(siteQuestions({ keywords: ESPRESSO })).toEqual([
      {
        text: 'Which is better: espresso or drip coffee?',
        keyword: 'espresso vs drip coffee',
        source: 'keywords',
        template: 'comparison',
        volume: 2400,
      },
      {
        text: 'espresso shot time',
        keyword: 'espresso shot time',
        source: 'keywords',
        template: 'kept',
        volume: 1900,
      },
      {
        text: 'What is the best espresso grinder for beginners?',
        keyword: 'best espresso grinder for beginners',
        source: 'keywords',
        template: 'best',
        volume: 720,
      },
      {
        text: 'espresso bitter',
        keyword: 'espresso bitter',
        source: 'keywords',
        template: 'kept',
      },
      {
        text: 'How to dial in espresso?',
        keyword: 'how to dial in espresso',
        source: 'keywords',
        template: 'as-written',
      },
    ]);
  });

  it('keeps input order when no keyword has a volume', () => {
    expect(texts({ keywords: 'espresso beans\ncrema\nmake cold brew' })).toEqual([
      'What are espresso beans?',
      'crema',
      'How to make cold brew?',
    ]);
  });

  it('lists a question once, at its best rank, ignoring case, spacing and the "?"', () => {
    expect(
      texts({ keywords: 'crema\nCrema, 90\nwhat is  crema\nWhat is crema?\nespresso beans, 10' }),
    ).toEqual(['Crema', 'What are espresso beans?', 'What is crema?']);
    const [first] = siteQuestions({ keywords: 'crema\nCrema, 90' });
    expect(first).toMatchObject({ keyword: 'Crema', volume: 90 });
    expect(texts({ keywords: 'make money online\nhow to make money online' })).toEqual([
      'How to make money online?',
    ]);
  });

  it(`lists at most ${SITE_QUESTIONS_MAX}, or max`, () => {
    const many = Array.from({ length: 70 }, (_, i) => `espresso question ${i + 1}?`).join('\n');
    expect(SITE_QUESTIONS_MAX).toBe(50);
    expect(siteQuestions({ keywords: many })).toHaveLength(50);
    expect(siteQuestions({ keywords: many, max: 3 })).toHaveLength(3);
    expect(siteQuestions({ keywords: '' })).toEqual([]);
    expect(siteQuestions({})).toEqual([]);
  });

  it('takes Search Console and Bing rows from the importer, citations first, then volume', () => {
    const queries: ImportedQuery[] = [
      ...parseQueriesCsv(scQueries),
      ...parseQueriesCsv(bingQueries),
    ];
    const list = siteQuestions({ keywords: 'espresso shot time, 1900', queries });
    expect(list.map((q) => [q.text, q.source])).toEqual([
      ['Why is my espresso bitter?', 'bing-ai'],
      ['espresso grind size', 'bing-ai'],
      ['What is crema?', 'bing-ai'],
      ['espresso shot time', 'keywords'],
      ['What are espresso beans?', 'search-console'],
      ['How to descale an espresso machine?', 'search-console'],
      ['What is the best espresso grinder in 2026?', 'search-console'],
    ]);
    expect(list[0]).toMatchObject({ citations: 52, keyword: 'why is my espresso bitter' });
    expect(list[4]).toMatchObject({ volume: 1500 });
  });

  it('adds suggested questions after the ranked ones, as written', () => {
    expect(
      siteQuestions({
        keywords: 'espresso beans, 5',
        suggested: ['Is crema a sign of fresh beans?', 'what are espresso beans'],
      }),
    ).toEqual([
      {
        text: 'What are espresso beans?',
        keyword: 'espresso beans',
        source: 'keywords',
        template: 'what-is',
        volume: 5,
      },
      {
        text: 'Is crema a sign of fresh beans?',
        keyword: 'Is crema a sign of fresh beans?',
        source: 'local-model',
        template: 'as-written',
      },
    ]);
  });

  it('is deterministic', () => {
    expect(siteQuestions({ keywords: ESPRESSO })).toEqual(siteQuestions({ keywords: ESPRESSO }));
  });
});

describe('siteQuestionNumbers', () => {
  it('says the number by what it counts', () => {
    const [kw, sc, bing, none] = [
      { volume: 1900, source: 'keywords' },
      { volume: 2310, source: 'search-console' },
      { citations: 52, source: 'bing-ai' },
      { source: 'keywords' },
    ] as const;
    expect(siteQuestionNumbers(kw)).toBe('Volume 1,900');
    expect(siteQuestionNumbers(sc)).toBe('2,310 impressions');
    expect(siteQuestionNumbers(bing)).toBe('52 citations');
    expect(siteQuestionNumbers({ citations: 1, source: 'bing-ai' })).toBe('1 citation');
    expect(siteQuestionNumbers(none)).toBe('');
  });
});
