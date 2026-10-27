import { describe, expect, it } from 'vitest';
import { fanOutSearches, questionType } from '../src/index';

/** Words a search template may add; every other word comes from the question itself. */
const TEMPLATE_WORDS = new Set(
  (
    'how long time recommended much many amount to step by tips mistakes works work explained ' +
    'causes what fix definition pros and cons benefits downsides is are worth it ' +
    'safe risks safety cost price best reviews compared vs difference between'
  ).split(' '),
);
const wordsOf = (s: string): string[] =>
  s.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];

const QUESTIONS = [
  'What is crema?',
  'What are espresso beans?',
  'How do you descale an espresso machine?',
  'How to dial in espresso?',
  'How long should an espresso shot take?',
  'How much coffee for a double shot?',
  'How much does an espresso machine cost?',
  'Why is my espresso bitter?',
  'Why does espresso taste sour?',
  'Espresso or drip coffee: which is better?',
  'What is the difference between a latte and a flat white?',
  'Is espresso stronger than drip coffee?',
  'What is the best espresso grinder for beginners?',
  'Is a lever espresso machine worth it?',
  'What are the pros and cons of a moka pot?',
  'Is it safe to drink espresso while pregnant?',
  'Are weight loss pills safe?',
  'What are the best practices for react?',
  'Is react worth learning?',
  'How much protein per day?',
  'Can I deduct home office?',
  'Is it safe to eat raw eggs?',
  'Which is better: roth IRA or traditional IRA?',
  'How does an espresso machine work?',
  'Does grind size matter?',
  'Can I reuse espresso grounds?',
  'What is espresso shot time?',
  'grinder price',
];

describe('questionType', () => {
  it('names the kind of question', () => {
    expect(
      [
        'What is crema?',
        'How do you descale an espresso machine?',
        'How long should an espresso shot take?',
        'How much coffee for a double shot?',
        'How much does an espresso machine cost?',
        'Why is my espresso bitter?',
        'Which is better: espresso or drip coffee?',
        'What is the best espresso grinder for beginners?',
        'Is a lever espresso machine worth it?',
        'How does an espresso machine work?',
        'Does grind size matter?',
      ].map(questionType),
    ).toEqual([
      'definition',
      'how-to',
      'how-long',
      'how-much',
      'cost',
      'causes',
      'comparison',
      'best',
      'pros-cons',
      'how-it-works',
      'other',
    ]);
  });
});

describe('fanOutSearches', () => {
  it('a definition: what it means, explained', () => {
    expect(fanOutSearches('What is crema?')).toEqual(['crema definition', 'crema explained']);
  });

  it('a how-to: the steps and tips', () => {
    expect(fanOutSearches('How do you descale an espresso machine?')).toEqual([
      'how to descale espresso machine',
      'descale espresso machine step by step',
      'descale espresso machine tips',
    ]);
  });

  it('how long and how much, with no leaked "much" and no ungrammatical "amount"', () => {
    expect(fanOutSearches('How long should an espresso shot take?')).toEqual([
      'how long espresso shot',
      'espresso shot time',
    ]);
    expect(fanOutSearches('How much coffee for a double shot?')).toEqual([
      'coffee for double shot',
      'how much coffee for double shot',
    ]);
    expect(fanOutSearches('How much protein per day?')).toEqual(['protein per day']);
  });

  it('cost when the question asks about money, never "how much X cost"', () => {
    expect(fanOutSearches('How much does an espresso machine cost?')).toEqual([
      'espresso machine cost',
      'espresso machine price',
    ]);
    expect(fanOutSearches('bitcoin price')).toEqual(['bitcoin cost']);
  });

  it('causes, and the fix when it is the reader’s own problem', () => {
    expect(fanOutSearches('Why is my espresso bitter?')).toEqual([
      'bitter espresso',
      'bitter espresso causes',
      'what causes bitter espresso',
      'how to fix bitter espresso',
    ]);
    // Not a thing and a quality: only its key words, no "what causes espresso taste sour".
    expect(fanOutSearches('Why does espresso taste sour?')).toEqual(['espresso taste sour']);
  });

  it('never looks up the "causes" of a judgment', () => {
    const searches = fanOutSearches('Why are weight loss pills safe?');
    expect(searches.join(' | ')).not.toMatch(/causes|safe weight loss pills/);
    expect(searches).toEqual([
      'weight loss pills',
      'are weight loss pills safe',
      'weight loss pills risks',
      'weight loss pills safety',
    ]);
  });

  it('a comparison: both items, side by side and each on its own, names kept', () => {
    const both = [
      'espresso vs drip coffee',
      'difference between espresso and drip coffee',
      'espresso pros and cons',
      'drip coffee pros and cons',
    ];
    expect(fanOutSearches('Which is better: espresso or drip coffee?')).toEqual(both);
    expect(fanOutSearches('Espresso or drip coffee: which is better?')).toEqual(both);
    expect(fanOutSearches('Is espresso stronger than drip coffee?')).toEqual(both);
    expect(fanOutSearches('What is the difference between a latte and a flat white?')).toEqual([
      'latte vs flat white',
      'difference between latte and flat white',
      'latte pros and cons',
      'flat white pros and cons',
    ]);
    expect(fanOutSearches('Which is better: roth IRA or traditional IRA?')[0]).toBe(
      'roth IRA vs traditional IRA',
    );
  });

  it('the best options, with reviews only for a product, the head noun kept', () => {
    expect(fanOutSearches('What is the best espresso grinder for beginners?')).toEqual([
      'best espresso grinder for beginners',
      'espresso grinder reviews',
      'espresso grinder compared',
    ]);
    expect(fanOutSearches('What are the best practices for react?')).toEqual([
      'best practices for react',
    ]);
    expect(fanOutSearches('best of 2026')).toEqual([]);
    expect(fanOutSearches('best buy near me')).toEqual([]);
    for (const q of ['What are the best practices for react?', 'What is the best buy near me?']) {
      expect(fanOutSearches(q).join(' | '), q).not.toMatch(/^practices|buy near|reviews/);
    }
  });

  it('pros and cons, and safety when the question asks', () => {
    expect(fanOutSearches('Is a lever espresso machine worth it?')).toEqual([
      'lever espresso machine pros and cons',
      'lever espresso machine benefits',
      'lever espresso machine downsides',
      'is lever espresso machine worth it',
    ]);
    expect(fanOutSearches('Is react worth learning?')).toEqual([
      'learning react pros and cons',
      'learning react benefits',
      'learning react downsides',
      'is learning react worth it',
    ]);
    expect(fanOutSearches('Is keto good?')).toEqual([
      'keto pros and cons',
      'keto benefits',
      'keto downsides',
    ]);
    expect(fanOutSearches('Are weight loss pills safe?')).toEqual([
      'weight loss pills',
      'weight loss pills risks',
      'weight loss pills safety',
    ]);
    expect(fanOutSearches('Is it safe to eat raw eggs?')).toEqual([
      'eat raw eggs',
      'raw eggs risks',
      'raw eggs safety',
    ]);
  });

  it('how something works', () => {
    expect(fanOutSearches('How does an espresso machine work?')).toEqual([
      'how espresso machine works',
      'espresso machine explained',
    ]);
  });

  it('any other question: its key words and its main thing, no bare object', () => {
    expect(fanOutSearches('Does grind size matter?')).toEqual([
      'grind size matter',
      'grind size',
      'grind size explained',
    ]);
    expect(fanOutSearches('Can I reuse espresso grounds?')).toEqual(['reuse espresso grounds']);
    expect(fanOutSearches('Can I deduct home office?')).toEqual(['deduct home office']);
  });

  it('keeps a name as written and lowercases the rest', () => {
    expect(fanOutSearches('Is the Breville Bambino worth it?')[0]).toBe(
      'Breville Bambino pros and cons',
    );
  });

  it('returns nothing for a local search or a question without key words', () => {
    expect(fanOutSearches('dentist near me')).toEqual([]);
    expect(fanOutSearches('What is it?')).toEqual([]);
    expect(fanOutSearches('')).toEqual([]);
  });

  it('never gives the ungrammatical searches a looser template would', () => {
    const bad: [string, RegExp][] = [
      ['What are the best practices for react?', /practices (reviews|compared)/],
      ['What is the best buy near me?', /buy near/],
      ['best of 2026', /best 2026|2026 reviews/],
      ['Why are weight loss pills safe?', /what causes safe/],
      ['Is it safe to eat raw eggs?', /is eat raw eggs safe/],
      ['How much protein per day?', /much protein per day$|amount/],
      ['Is react worth learning?', /react learning/],
      ['Can I deduct home office?', /^home office$/],
      ['bitcoin price', /how much bitcoin cost/],
    ];
    for (const [q, re] of bad) {
      for (const s of fanOutSearches(q)) expect(s, q).not.toMatch(re);
    }
  });

  it.each(QUESTIONS)('%s: at most 8 searches, none repeated, none the question itself', (q) => {
    const searches = fanOutSearches(q);
    expect(searches.length).toBeGreaterThanOrEqual(1);
    expect(searches.length).toBeLessThanOrEqual(8);
    expect(new Set(searches.map((s) => s.toLowerCase())).size).toBe(searches.length);
    const asked = wordsOf(q).join(' ');
    for (const s of searches) expect(wordsOf(s).join(' ')).not.toBe(asked);
  });

  it.each(QUESTIONS)('%s: built from its own key words, never padded', (q) => {
    const own = new Set(wordsOf(q));
    for (const s of fanOutSearches(q)) {
      const extra = wordsOf(s).filter((w) => !own.has(w) && !TEMPLATE_WORDS.has(w));
      expect(extra, s).toEqual([]);
      // Every search keeps at least one of the question's own words.
      expect(
        wordsOf(s).some((w) => own.has(w) && !TEMPLATE_WORDS.has(w)),
        s,
      ).toBe(true);
    }
  });

  it('is deterministic', () => {
    for (const q of QUESTIONS) expect(fanOutSearches(q)).toEqual(fanOutSearches(q));
  });
});
