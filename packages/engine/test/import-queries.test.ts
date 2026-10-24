import { describe, expect, it } from 'vitest';
import {
  type ImportedQuery,
  parseBingAiPerformanceCsv,
  parseBingAiQueries,
  parseQueriesCsv,
  parseSearchConsoleQueries,
  questionKey,
  rankImportedQueries,
  rankingNote,
  toTargetQuestions,
} from '../src/index';
import bingQueries from './fixtures/import-queries/bing-grounding-queries.csv?raw';
import bingPages from './fixtures/import-queries/bing-pages.csv?raw';
import scPages from './fixtures/import-queries/search-console-pages.csv?raw';
import scQueries from './fixtures/import-queries/search-console-queries.csv?raw';

describe('parseSearchConsoleQueries', () => {
  it('reads the Queries table of a Performance export (BOM, quoted thousands, CTR ignored)', () => {
    expect(parseSearchConsoleQueries(scQueries)).toEqual([
      {
        text: 'why is my espresso bitter',
        source: 'search-console',
        clicks: 31,
        impressions: 1204,
      },
      { text: 'espresso grind size', source: 'search-console', clicks: 12, impressions: 2310 },
      { text: 'best espresso grinder 2026', source: 'search-console', clicks: 4, impressions: 980 },
      { text: 'Espresso  grind size', source: 'search-console', clicks: 1, impressions: 40 },
      {
        text: 'how to descale an espresso machine',
        source: 'search-console',
        clicks: 9,
        impressions: 1204,
      },
      { text: 'espresso beans', source: 'search-console', clicks: 2, impressions: 1500 },
    ]);
  });

  it('matches headers case-insensitively, with aliases, and skips rows without a query', () => {
    expect(parseSearchConsoleQueries('QUERY,IMPRESSIONS\r\ncrema,7\r\n,9\r\n\r\n')).toEqual([
      { text: 'crema', source: 'search-console', impressions: 7 },
    ]);
  });

  it('fails with the headers it found when the query or impressions column is missing', () => {
    expect(() => parseSearchConsoleQueries('Keyword,Clicks,Impressions\nx,1,2\n')).toThrow(
      'Not a Search Console Queries export: no query column (Google names it "Top queries"). Headers found: Keyword, Clicks, Impressions.',
    );
    expect(() => parseSearchConsoleQueries('Top queries,Clicks\nx,1\n')).toThrow(
      'Not a Search Console Queries export: no impressions column. Headers found: Top queries, Clicks.',
    );
    expect(() => parseSearchConsoleQueries('')).toThrow('Headers found: (none).');
  });

  it('says so when the file is the Pages table instead of the Queries table', () => {
    expect(() => parseSearchConsoleQueries(scPages)).toThrow(
      /This is the Pages table; export the Queries table \(Queries\.csv\) instead\. Headers found: Top pages,/,
    );
  });

  it('fails on a count that is not a number, naming the row', () => {
    expect(() => parseSearchConsoleQueries('Top queries,Impressions\nx,many\n')).toThrow(
      'Row 2: impressions value "many" is not a number.',
    );
  });
});

describe('CSV line numbers, delimiter sniffing and preambles', () => {
  it('names the file line of a bad Search Console row, counting blank lines', () => {
    expect(() => parseSearchConsoleQueries('Top queries,Impressions\n\nok,3\n\nx,many\n')).toThrow(
      'Row 5: impressions value "many" is not a number.',
    );
  });

  it('names the file line of a bad Bing row, counting the preamble and blank lines', () => {
    const csv = 'AI Performance\n\nDate,Citations\n2026-10-01,3\n\n2026-10-02,lots\n';
    expect(() => parseBingAiPerformanceCsv(csv)).toThrow(
      /Row 6: citations value "lots" is not a number/,
    );
  });

  it('gives the friendly row error for a day-first or month-13 date', () => {
    for (const date of ['25/10/2026', '2026-13-01'])
      expect(() => parseBingAiPerformanceCsv(`Date,Citations\n${date},3\n`), date).toThrow(
        `Row 2: cannot read date "${date}"; expected YYYY-MM-DD or M/D/YYYY.`,
      );
  });

  it('sniffs a semicolon table under a preamble line that holds a comma', () => {
    const csv =
      'AI Performance report, sampled data\nGrounding query;Citations\nespresso grind;12\nwhat is crema;4\n';
    expect(parseBingAiQueries(csv)).toEqual([
      { text: 'espresso grind', source: 'bing-ai', citations: 12 },
      { text: 'what is crema', source: 'bing-ai', citations: 4 },
    ]);
  });

  it('lists the table header, not the preamble, when there is no citations column', () => {
    const csv = 'Exported from a tool, 2026\nKeyword,Clicks,Impressions\nx,1,2\ny,3,4\n';
    expect(() => parseBingAiPerformanceCsv(csv)).toThrow(
      'Not a Bing AI Performance export: no citations column. Headers found: Keyword, Clicks, Impressions.',
    );
  });
});

describe('parseBingAiQueries', () => {
  it('reads the grounding queries table with the Bing AI Performance header handling', () => {
    expect(parseBingAiQueries(bingQueries)).toEqual([
      { text: 'why is my espresso bitter', source: 'bing-ai', citations: 52 },
      { text: 'espresso grind size', source: 'bing-ai', citations: 17 },
      { text: 'what is crema', source: 'bing-ai', citations: 17 },
      { text: 'Why is my espresso bitter?', source: 'bing-ai', citations: 3 },
    ]);
  });

  it('agrees with parseBingAiPerformanceCsv on the same file', () => {
    expect(parseBingAiQueries(bingQueries).map((q) => [q.text, q.citations])).toEqual(
      parseBingAiPerformanceCsv(bingQueries).byQuery.map((q) => [q.query, q.citations]),
    );
  });

  it('fails with the headers it found for the pages table or a file that is not the export', () => {
    expect(() => parseBingAiQueries(bingPages)).toThrow(
      'Not the grounding queries table of a Bing AI Performance export: no query column. Headers found: Page, Citations, Citation Share.',
    );
    expect(() => parseBingAiQueries('Keyword,Clicks\nx,1\n')).toThrow(
      'Not a Bing AI Performance export: no citations column. Headers found: Keyword, Clicks.',
    );
  });
});

describe('parseQueriesCsv', () => {
  it('tells the two exports apart by the citations column', () => {
    expect(parseQueriesCsv(bingQueries)[0].source).toBe('bing-ai');
    expect(parseQueriesCsv(scQueries)[0].source).toBe('search-console');
    expect(() => parseQueriesCsv('Keyword,Clicks\nx,1\n')).toThrow(
      /Not a Search Console Queries export.*Headers found: Keyword, Clicks\./,
    );
  });

  it('reads a Search Console export whose data rows hold the word "citation" as Search Console', () => {
    // Regression: a query "citation" in the first rows once made the file read as Bing's.
    const csv = [
      'Top queries,Clicks,Impressions,CTR,Position',
      'citation,12,2310,0.52%,11.2',
      'citations,3,400,0.75%,9.0',
      'apa citation generator,1,90,1.1%,14',
    ].join('\n');
    expect(parseQueriesCsv(csv)).toEqual([
      { text: 'citation', source: 'search-console', clicks: 12, impressions: 2310 },
      { text: 'citations', source: 'search-console', clicks: 3, impressions: 400 },
      { text: 'apa citation generator', source: 'search-console', clicks: 1, impressions: 90 },
    ]);
  });

  it('still finds a Bing header below a preamble, and does not take a lone "citations" cell for one', () => {
    const preamble = `Bing AI Performance,,\nData is sampled,,\n${bingQueries}`;
    expect(parseQueriesCsv(preamble)[0]).toEqual({
      text: 'why is my espresso bitter',
      source: 'bing-ai',
      citations: 52,
    });
    // "citations" sits in a data row with no query, page or date header beside it.
    expect(() => parseQueriesCsv('Keyword,Clicks\ncitations,1\n')).toThrow(
      /Not a Search Console Queries export.*Headers found: Keyword, Clicks\./,
    );
  });
});

describe('questionKey', () => {
  it('ignores case, runs of spaces and closing punctuation', () => {
    expect(questionKey('  Why is my  espresso bitter?! ')).toBe('why is my espresso bitter');
    expect(questionKey('why is my espresso bitter.')).toBe(
      questionKey('Why is my espresso bitter?'),
    );
    expect(questionKey('What is crema?')).not.toBe(questionKey('What is a crema?'));
  });
});

describe('toTargetQuestions', () => {
  it('ranks by impressions, keeps questions, turns noun phrases into "What is", dedupes', () => {
    expect(toTargetQuestions(parseSearchConsoleQueries(scQueries))).toEqual([
      { text: 'What is espresso grind size?', source: 'search-console' },
      { text: 'What are espresso beans?', source: 'search-console' },
      { text: 'Why is my espresso bitter?', source: 'search-console' },
      { text: 'How to descale an espresso machine?', source: 'search-console' },
      { text: 'best espresso grinder 2026', source: 'search-console' },
    ]);
  });

  it('ranks by citations first, then impressions, across both sources', () => {
    const q: ImportedQuery[] = [
      { text: 'crema', source: 'search-console', impressions: 5000, clicks: 90 },
      { text: 'what is a portafilter', source: 'bing-ai', citations: 3 },
      { text: 'milk frother', source: 'search-console', impressions: 6000 },
      { text: 'how long should a shot take', source: 'bing-ai', citations: 9 },
    ];
    expect(toTargetQuestions(q).map((t) => t.text)).toEqual([
      'How long should a shot take?',
      'What is a portafilter?',
      'What is milk frother?',
      'What is crema?',
    ]);
  });

  it('dedupes queries that become the same question, keeping the higher-ranked one', () => {
    expect(toTargetQuestions(parseBingAiQueries(bingQueries))).toEqual([
      { text: 'Why is my espresso bitter?', source: 'bing-ai' },
      { text: 'What is espresso grind size?', source: 'bing-ai' },
      { text: 'What is crema?', source: 'bing-ai' },
    ]);
    const q: ImportedQuery[] = [
      { text: 'what is crema', source: 'bing-ai', citations: 2 },
      { text: 'Crema', source: 'search-console', impressions: 10 },
    ];
    expect(toTargetQuestions(q)).toEqual([{ text: 'What is crema?', source: 'bing-ai' }]);
  });

  it('keeps long or non-noun-phrase keyword queries verbatim', () => {
    const q = (text: string): ImportedQuery => ({ text, source: 'search-console' });
    expect(
      toTargetQuestions([
        q('espresso vs drip'),
        q('best burr grinder'),
        q('espresso machine cleaning tablet price list'),
      ]).map((t) => t.text),
    ).toEqual([
      'espresso vs drip',
      'best burr grinder',
      'espresso machine cleaning tablet price list',
    ]);
  });

  it('keeps navigational queries verbatim and capitalises "i"', () => {
    const q = (text: string): ImportedQuery => ({ text, source: 'search-console' });
    expect(
      toTargetQuestions([
        q('road bike size chart'),
        q('burr grinder price'),
        q('how much should i spend'),
        q("i'm new to espresso"),
      ]).map((t) => t.text),
    ).toEqual([
      'road bike size chart',
      'burr grinder price',
      'How much should I spend?',
      "I'm new to espresso",
    ]);
  });

  it('words the ranking by the numbers the file has', () => {
    expect(rankingNote(parseSearchConsoleQueries(scQueries))).toBe('ranked by impressions');
    expect(rankingNote(parseBingAiQueries(bingQueries))).toBe('ranked by citations');
    expect(
      rankingNote([...parseSearchConsoleQueries(scQueries), ...parseBingAiQueries(bingQueries)]),
    ).toBe('ranked by citations, then impressions');
  });

  it('returns at most 8 by default, and honours max', () => {
    const many: ImportedQuery[] = Array.from({ length: 12 }, (_, i) => ({
      text: `how do I fix problem ${i}`,
      source: 'search-console',
      impressions: 100 - i,
    }));
    expect(toTargetQuestions(many)).toHaveLength(8);
    expect(toTargetQuestions(many, { max: 3 }).map((t) => t.text)).toEqual([
      'How do I fix problem 0?',
      'How do I fix problem 1?',
      'How do I fix problem 2?',
    ]);
    expect(toTargetQuestions(many, { max: 0 })).toEqual([]);
  });
});

describe('rankImportedQueries', () => {
  it('pairs each ranked query with the question it becomes, without a cap', () => {
    const ranked = rankImportedQueries(parseSearchConsoleQueries(scQueries));
    expect(ranked).toHaveLength(5);
    expect(ranked[0]).toEqual({
      query: {
        text: 'espresso grind size',
        source: 'search-console',
        clicks: 12,
        impressions: 2310,
      },
      question: { text: 'What is espresso grind size?', source: 'search-console' },
    });
  });
});
