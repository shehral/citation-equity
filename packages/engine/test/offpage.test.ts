import { describe, expect, it } from 'vitest';
import evidenceDoc from '../../../docs/evidence.md?raw';
import {
  classifyDomain,
  type EvidenceGrade,
  groupByKind,
  hostOf,
  OFFPAGE_ADVICE,
  SOURCE_KINDS,
  type SourceKind,
  tallyCitedSources,
  urlsFromText,
} from '../src/index';

const GRADES: EvidenceGrade[] = ['strong', 'moderate', 'mixed', 'untested'];
// Spelled in two parts so the retired grade word never appears in the repository.
const BANNED = new RegExp(['contra', 'dicted'].join(''), 'i');
const EM_DASH = '—';
const DOC: string = evidenceDoc;

describe('classifyDomain', () => {
  const table: [string, SourceKind][] = [
    ['reddit.com', 'forum'],
    ['www.reddit.com', 'forum'],
    ['old.reddit.com', 'forum'],
    ['quora.com', 'forum'],
    ['cooking.stackexchange.com', 'forum'],
    ['stackoverflow.com', 'forum'],
    ['en.wikipedia.org', 'wiki'],
    ['en.m.wikipedia.org', 'wiki'],
    ['wikihow.com', 'wiki'],
    ['youtube.com', 'video'],
    ['m.youtube.com', 'video'],
    ['youtu.be', 'video'],
    ['vimeo.com', 'video'],
    ['g2.com', 'reviews'],
    ['yelp.com', 'reviews'],
    ['tripadvisor.com', 'reviews'],
    ['trustpilot.com', 'reviews'],
    ['reuters.com', 'news'],
    ['apnews.com', 'news'],
    ['forbes.com', 'news'],
    ['bbc.co.uk', 'news'],
    ['nih.gov', 'reference'],
    ['pubmed.ncbi.nlm.nih.gov', 'reference'],
    ['mayoclinic.org', 'reference'],
    ['britannica.com', 'reference'],
    ['cdc.gov', 'reference'],
    ['cs.stanford.edu', 'reference'],
    ['linkedin.com', 'social'],
    ['x.com', 'social'],
    ['instagram.com', 'social'],
    ['amazon.com', 'commerce'],
    ['etsy.com', 'commerce'],
    ['example-cafe.com', 'blog-or-other'],
    ['medium.com', 'blog-or-other'],
    // Suffix matches are on whole labels only.
    ['notreddit.com', 'blog-or-other'],
    ['reddit.com.example.net', 'blog-or-other'],
  ];
  it.each(table)('%s is %s', (domain, kind) => {
    expect(classifyDomain(domain)).toBe(kind);
  });

  it('accepts a full URL and any case', () => {
    expect(classifyDomain('https://WWW.Reddit.com/r/espresso/comments/abc')).toBe('forum');
  });

  it('defaults to blog-or-other for text that is not a host name', () => {
    expect(classifyDomain('')).toBe('blog-or-other');
    expect(classifyDomain('Espresso guide')).toBe('blog-or-other');
  });
});

describe('hostOf', () => {
  it('gives the lowercased host without www for a URL or a bare host, and "" otherwise', () => {
    expect(hostOf('https://WWW.Example.com/a?b')).toBe('example.com');
    expect(hostOf('blog.example.com')).toBe('blog.example.com');
    expect(hostOf(' www.example.com ')).toBe('example.com');
    for (const x of ['', 'Espresso guide', 'localhost', 'https://']) expect(hostOf(x), x).toBe('');
  });
});

describe('urlsFromText', () => {
  it('pulls bare URLs and Markdown links, without trailing punctuation', () => {
    const text = [
      'Espresso turns bitter when it over-extracts (see https://example.com/espresso).',
      'Grind finer, says [Example Lab](https://lab.example.org/grind "Grind guide"), or read https://www.reddit.com/r/espresso/comments/abc/bitter/,',
      'More: https://example.net/a?b=1&c=2; and **https://bold.example.com/x**!',
    ].join('\n');
    expect(urlsFromText(text)).toEqual([
      'https://example.com/espresso',
      'https://lab.example.org/grind',
      'https://www.reddit.com/r/espresso/comments/abc/bitter/',
      'https://example.net/a?b=1&c=2',
      'https://bold.example.com/x',
    ]);
  });

  it('keeps balanced parentheses in a URL and drops the closing one of a link', () => {
    expect(
      urlsFromText(
        'A drink ([Espresso](https://en.wikipedia.org/wiki/Espresso_(drink))) and (https://example.com/a).',
      ),
    ).toEqual(['https://en.wikipedia.org/wiki/Espresso_(drink)', 'https://example.com/a']);
  });

  it('reads source lists, angle brackets and link-as-text, each URL once', () => {
    const text = [
      '[1]: https://example.com/one',
      '2. <https://example.com/two>',
      '[https://example.com/one](https://example.com/one)',
      '"https://example.com/three"',
      'HTTP://EXAMPLE.COM/FOUR.',
    ].join('\n');
    expect(urlsFromText(text)).toEqual([
      'https://example.com/one',
      'https://example.com/two',
      'https://example.com/three',
      'HTTP://EXAMPLE.COM/FOUR',
    ]);
  });

  it('ignores other schemes, a bare "https://" and empty text', () => {
    expect(urlsFromText('ftp://example.com/x mailto:a@example.com https:// and http://.')).toEqual(
      [],
    );
    expect(urlsFromText('')).toEqual([]);
  });
});

describe('tallyCitedSources', () => {
  const input = [
    {
      question: 'Why does espresso taste bitter?',
      urls: [
        'https://www.reddit.com/r/espresso/comments/1',
        'https://reddit.com/r/espresso/comments/2',
        'https://en.wikipedia.org/wiki/Espresso',
        'https://www.example.com/espresso',
      ],
    },
    {
      question: 'How fine should I grind for espresso?',
      urls: ['https://reddit.com/r/espresso/comments/3', 'https://blog.example.com/grind'],
    },
    { question: 'Why does espresso taste bitter?', urls: ['https://youtube.com/watch?v=x'] },
    { question: 'What is a ristretto?', urls: [] },
  ];

  it('counts each domain once per answer, with the questions it was cited for', () => {
    const { domains, ownCitations } = tallyCitedSources(input);
    expect(ownCitations).toBe(0);
    expect(domains).toEqual([
      {
        domain: 'reddit.com',
        kind: 'forum',
        citations: 2,
        questions: ['Why does espresso taste bitter?', 'How fine should I grind for espresso?'],
      },
      {
        domain: 'blog.example.com',
        kind: 'blog-or-other',
        citations: 1,
        questions: ['How fine should I grind for espresso?'],
      },
      {
        domain: 'example.com',
        kind: 'blog-or-other',
        citations: 1,
        questions: ['Why does espresso taste bitter?'],
      },
      {
        domain: 'wikipedia.org',
        kind: 'wiki',
        citations: 1,
        questions: ['Why does espresso taste bitter?'],
      },
      {
        domain: 'youtube.com',
        kind: 'video',
        citations: 1,
        questions: ['Why does espresso taste bitter?'],
      },
    ]);
  });

  it('folds subdomains of known sites into their entry, once per answer', () => {
    const { domains } = tallyCitedSources([
      {
        question: 'q1',
        urls: ['https://old.reddit.com/r/espresso', 'https://reddit.com/r/coffee'],
      },
      { question: 'q2', urls: ['https://www.reddit.com/r/x', 'https://m.youtube.com/watch?v=1'] },
      {
        question: 'q3',
        urls: ['https://news.ycombinator.com/item?id=1', 'https://blog.example.com'],
      },
    ]);
    expect(domains.map((d) => [d.domain, d.citations])).toEqual([
      ['reddit.com', 2],
      ['blog.example.com', 1],
      ['news.ycombinator.com', 1],
      ['youtube.com', 1],
    ]);
  });

  it('counts the own domain, with www and subdomains, apart from the other domains', () => {
    for (const own of ['example.com', 'www.example.com', 'https://example.com/espresso']) {
      const { domains, ownCitations } = tallyCitedSources(input, own);
      expect(ownCitations, own).toBe(2);
      expect(
        domains.map((d) => d.domain),
        own,
      ).toEqual(['reddit.com', 'wikipedia.org', 'youtube.com']);
    }
  });

  it('does not take a different site that only ends in the same letters as its own', () => {
    const { ownCitations, domains } = tallyCitedSources(
      [{ question: 'Q', urls: ['https://notexample.com/x'] }],
      'example.com',
    );
    expect(ownCitations).toBe(0);
    expect(domains.map((d) => d.domain)).toEqual(['notexample.com']);
  });

  it('accepts bare host names, as a LiveReport source domain gives them', () => {
    const { domains } = tallyCitedSources([
      { question: 'Q', urls: ['reddit.com', 'Not a host', ''] },
    ]);
    expect(domains.map((d) => d.domain)).toEqual(['reddit.com']);
  });

  it('ignores an own domain that is empty or not a host name', () => {
    expect(tallyCitedSources(input, '').ownCitations).toBe(0);
    expect(tallyCitedSources(input, '   ').domains).toHaveLength(5);
  });
});

describe('groupByKind', () => {
  it('groups domains by kind, the most cited kind first, ties in SOURCE_KINDS order', () => {
    const d = (domain: string, citations: number) => ({
      domain,
      kind: classifyDomain(domain),
      citations,
      questions: ['Q'],
    });
    const groups = groupByKind([
      d('reddit.com', 1),
      d('en.wikipedia.org', 2),
      d('quora.com', 1),
      d('youtube.com', 2),
      d('example.com', 1),
    ]);
    expect(groups.map((g) => [g.kind, g.citations, g.domains.map((x) => x.domain)])).toEqual([
      ['forum', 2, ['reddit.com', 'quora.com']],
      ['wiki', 2, ['en.wikipedia.org']],
      ['video', 2, ['youtube.com']],
      ['blog-or-other', 1, ['example.com']],
    ]);
    expect(groupByKind([])).toEqual([]);
  });
});

describe('OFFPAGE_ADVICE', () => {
  it('has one card per source kind, in SOURCE_KINDS order', () => {
    expect(Object.keys(OFFPAGE_ADVICE)).toEqual([...SOURCE_KINDS]);
    for (const kind of SOURCE_KINDS) expect(OFFPAGE_ADVICE[kind].kind).toBe(kind);
  });

  it('grades every card with one of the four public grades and cites what it read', () => {
    for (const card of Object.values(OFFPAGE_ADVICE)) {
      expect(GRADES, card.kind).toContain(card.evidence.grade);
      for (const field of [card.title, card.advice, card.avoid, card.evidence.summary])
        expect(field.trim(), card.kind).not.toBe('');
      expect(card.evidence.sources.length, card.kind).toBeGreaterThan(0);
      for (const s of card.evidence.sources) {
        expect(s.url, s.id).toMatch(/^https:\/\//);
        expect(s.claim.trim(), s.id).not.toBe('');
      }
    }
  });

  it('grades every card by the off-page rules applied to the published top lists', () => {
    // The per-engine lists the cards rest on, as read on 2026-10-23 (docs/evidence.md, Off-page).
    // Profound and Ahrefs publish a full top ten per engine (Ahrefs' as charts); Semrush names
    // only each engine's first five in its text, so it can show a kind present, never absent.
    const topTen: Record<string, Record<string, string[]>> = {
      ChatGPT: {
        profound: [
          'wikipedia.org',
          'reddit.com',
          'forbes.com',
          'g2.com',
          'techradar.com',
          'nerdwallet.com',
          'businessinsider.com',
          'nypost.com',
          'toxigon.com',
          'reuters.com',
        ],
        ahrefs: [
          'wikipedia.org',
          'reuters.com',
          'apple.com',
          'justwatch.com',
          'as.com',
          'amazon.com',
          'apnews.com',
          'google.com',
          'axios.com',
          'uol.com.br',
        ],
      },
      'Google AI Overviews': {
        profound: [
          'reddit.com',
          'youtube.com',
          'quora.com',
          'linkedin.com',
          'gartner.com',
          'nerdwallet.com',
          'forbes.com',
          'wikipedia.org',
          'businessinsider.com',
          'medium.com',
        ],
        ahrefs: [
          'wikipedia.org',
          'youtube.com',
          'reddit.com',
          'quora.com',
          'translate.google.com',
          'healthline.com',
          'mayoclinic.org',
          'clevelandclinic.org',
          'nih.gov',
          'medicalnewstoday.com',
        ],
      },
      Perplexity: {
        profound: [
          'reddit.com',
          'youtube.com',
          'gartner.com',
          'yelp.com',
          'linkedin.com',
          'forbes.com',
          'nerdwallet.com',
          'tripadvisor.com',
          'g2.com',
          'pcmag.com',
        ],
        ahrefs: [
          'youtube.com',
          'wikipedia.org',
          'apple.com',
          'google.com',
          'healthline.com',
          'tuasaude.com',
          'justwatch.com',
          'imdb.com',
          'microsoft.com',
          'instagram.com',
        ],
      },
    };
    const semrushTopFive: Record<string, string[]> = {
      ChatGPT: ['wikipedia.org', 'reddit.com', 'medium.com', 'forbes.com', 'linkedin.com'],
      'Google AI Mode': ['linkedin.com', 'youtube.com', 'reddit.com', 'google.com', 'blog.google'],
      Perplexity: ['reddit.com', 'linkedin.com', 'nih.gov', 'microsoft.com', 'google.com'],
    };
    // Semrush: Reddit and Wikipedia citations in ChatGPT fell sharply from August to September 2025.
    const fellSharply: SourceKind[] = ['forum', 'wiki'];

    const has = (list: string[], kind: SourceKind) => list.some((d) => classifyDomain(d) === kind);
    const engines = new Set([...Object.keys(topTen), ...Object.keys(semrushTopFive)]);
    for (const kind of SOURCE_KINDS) {
      let present = false;
      let agreed = false;
      for (const engine of engines) {
        const full = Object.values(topTen[engine] ?? {});
        const listed = full.some((l) => has(l, kind)) || has(semrushTopFive[engine] ?? [], kind);
        if (!listed) continue;
        present = true;
        if (full.length > 0 && full.every((l) => has(l, kind))) agreed = true;
      }
      const grade = !present
        ? 'untested'
        : agreed && !fellSharply.includes(kind)
          ? 'moderate'
          : 'mixed';
      expect(OFFPAGE_ADVICE[kind].evidence.grade, kind).toBe(grade);
    }
  });

  it('never uses the retired grade word or an em dash', () => {
    const text = JSON.stringify(OFFPAGE_ADVICE);
    expect(text).not.toMatch(BANNED);
    expect(text).not.toContain(EM_DASH);
  });

  it('states the ethical line on the cards where a rule applies', () => {
    expect(OFFPAGE_ADVICE.wiki.avoid).toMatch(/conflict of interest/i);
    expect(OFFPAGE_ADVICE.wiki.avoid).toMatch(/independent/i);
    expect(OFFPAGE_ADVICE.forum.avoid).toMatch(/disclose/i);
    expect(OFFPAGE_ADVICE.reviews.avoid).toMatch(/fake reviews/i);
    expect(OFFPAGE_ADVICE['blog-or-other'].avoid).toMatch(/link/i);
  });

  it('cuts every card to one Do and one Avoid line of 20 words or fewer', () => {
    const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
    for (const card of Object.values(OFFPAGE_ADVICE)) {
      expect(card.short.do.trim(), `${card.kind} do`).not.toBe('');
      expect(card.short.avoid.trim(), `${card.kind} avoid`).not.toBe('');
      expect(words(card.short.do), `${card.kind} do`).toBeLessThanOrEqual(20);
      expect(words(card.short.avoid), `${card.kind} avoid`).toBeLessThanOrEqual(20);
    }
  });

  it('keeps the guardrails of the full text in the short lines', () => {
    // Each pattern names a guardrail the full advice or avoid text states. The short lines must
    // state it too, so editing a guardrail in one place and not the other fails here.
    const guardrails: Record<SourceKind, RegExp[]> = {
      forum: [/\byours\b/i, /link/i, /vote/i],
      wiki: [/place yourself/i, /\bconnected\b/i, /yourself|your business/i, /clients/i],
      video: [/disclose/i, /sponsor/i, /reuploads/i, /titles/i],
      reviews: [/fake/i, /paid|paying/i, /staff or family/i, /negative/i, /real customers/i],
      news: [/paid placements/i, /paid links/i, /press releases/i, /disclose any sponsored/i],
      reference: [/place yourself/i, /endorses/i, /copy its text/i],
      social: [/fake accounts/i, /bought followers/i, /engagement/i, /disclose/i, /own name/i],
      commerce: [/fake or bought reviews/i, /staff or family/i, /claims/i, /accurate/i],
      'blog-or-other': [/bought/i, /guest posts/i, /mass-produced/i, /accurate/i],
    };
    for (const kind of SOURCE_KINDS) {
      const card = OFFPAGE_ADVICE[kind];
      const full = `${card.advice} ${card.avoid}`;
      const short = `${card.short.do} ${card.short.avoid}`;
      for (const rule of guardrails[kind]) {
        expect(full, `${kind} full text ${rule}`).toMatch(rule);
        expect(short, `${kind} short lines ${rule}`).toMatch(rule);
      }
    }
  });
});

describe('docs/evidence.md, Off-page', () => {
  const start = DOC.search(/^## Off-page$/m);
  const next = DOC.indexOf('\n## ', start + 1);
  const section = DOC.slice(start, next === -1 ? undefined : next);

  it('has an Off-page section', () => {
    expect(start).toBeGreaterThan(-1);
  });

  it('states the same grade as the advice registry for every kind', () => {
    for (const kind of SOURCE_KINDS) {
      const at = section.search(new RegExp(`^### .*\`${kind}\``, 'm'));
      expect(at, `subsection for ${kind}`).toBeGreaterThan(-1);
      const end = section.indexOf('\n### ', at + 1);
      const sub = section.slice(at, end === -1 ? undefined : end);
      expect(sub, kind).toContain(`Grade: **${OFFPAGE_ADVICE[kind].evidence.grade}**`);
    }
  });
});
