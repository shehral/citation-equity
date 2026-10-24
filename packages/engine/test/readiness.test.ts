import { describe, expect, it } from 'vitest';
import evidenceDoc from '../../../docs/evidence.md?raw';
import {
  analyzeReadiness,
  type EvidenceGrade,
  READINESS_EVIDENCE,
  READINESS_IDS,
  type ReadinessId,
  type ReadinessResult,
} from '../src/index';
import blogPosting from './fixtures/readiness/blogposting.html?raw';
import noindex from './fixtures/readiness/noindex.html?raw';

const GRADES: EvidenceGrade[] = ['strong', 'moderate', 'mixed', 'untested'];
// Spelled in two parts so the retired grade word never appears in the repository.
const BANNED = new RegExp(['contra', 'dicted'].join(''), 'i');
const DOC: string = evidenceDoc;

const item = (result: ReadinessResult, id: ReadinessId) => {
  const found = result.items.find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

/** A minimal page with the given extra head markup. */
const page = (head: string) =>
  `<!doctype html><html><head><title>T</title>${head}</head><body><p>Hello.</p></body></html>`;

describe('analyzeReadiness', () => {
  it('reports the seven items in a fixed order, each with its evidence', () => {
    const result = analyzeReadiness({ html: blogPosting });
    expect(result.schemaVersion).toBe(1);
    expect(result.items.map((i) => i.id)).toEqual([...READINESS_IDS]);
    expect(READINESS_IDS).toEqual([
      'byline',
      'dates',
      'structured-data',
      'indexing-directives',
      'canonical',
      'crawler-access',
      'renders-without-js',
    ]);
    for (const i of result.items) {
      expect(i.evidence).toBe(READINESS_EVIDENCE[i.id]);
      expect(i.title.trim()).not.toBe('');
      expect(i.detail.trim()).not.toBe('');
    }
  });

  it('fails indexing directives for <meta name="robots" content="noindex">', () => {
    const result = analyzeReadiness({ html: noindex });
    const directives = item(result, 'indexing-directives');
    expect(directives.status).toBe('fail');
    expect(directives.detail).toContain('noindex');
  });

  it('passes byline, dates and structured data for a BlogPosting JSON-LD block', () => {
    const result = analyzeReadiness({ html: blogPosting });
    expect(item(result, 'byline').status).toBe('pass');
    expect(item(result, 'byline').detail).toContain('JSON-LD author (A)');
    expect(item(result, 'dates').status).toBe('pass');
    expect(item(result, 'dates').detail).toContain('2026-01-01');
    const structured = item(result, 'structured-data');
    expect(structured.status).toBe('pass');
    expect(structured.detail).toContain('BlogPosting');
    expect(item(result, 'indexing-directives').status).toBe('pass');
    expect(item(result, 'canonical').status).toBe('pass');
    expect(item(result, 'canonical').detail).toContain('https://example.com/espresso-bitterness');
  });

  it('reports every item unknown for empty input', () => {
    for (const input of [{}, { html: '' }, { html: '  \n ' }, { frontMatter: {} }]) {
      const result = analyzeReadiness(input);
      expect(result.items).toHaveLength(7);
      for (const i of result.items)
        expect(i.status, `${i.id} for ${JSON.stringify(input)}`).toBe('unknown');
    }
  });

  it('passes byline and dates from front matter alone, and leaves HTML-only items unknown', () => {
    const result = analyzeReadiness({ frontMatter: { author: 'A', date: '2026-01-01' } });
    expect(item(result, 'byline').status).toBe('pass');
    expect(item(result, 'dates').status).toBe('pass');
    for (const id of ['structured-data', 'indexing-directives', 'canonical'] as const) {
      expect(item(result, id).status, id).toBe('unknown');
    }
  });

  it('accepts a Date object and an author list in front matter', () => {
    const result = analyzeReadiness({
      frontMatter: { authors: ['A', 'B'], date: new Date('2026-01-01T00:00:00Z') },
    });
    expect(item(result, 'byline').status).toBe('pass');
    expect(item(result, 'byline').detail).toContain('B');
    expect(item(result, 'dates').status).toBe('pass');
  });

  it('warns when front matter is given but names no author or a date that does not parse', () => {
    const result = analyzeReadiness({ frontMatter: { title: 'T', date: 'someday' } });
    expect(item(result, 'byline').status).toBe('warn');
    expect(item(result, 'dates').status).toBe('warn');
  });

  it('warns on a page with no byline, no dates, no JSON-LD and no canonical', () => {
    const result = analyzeReadiness({ html: page('') });
    expect(item(result, 'byline').status).toBe('warn');
    expect(item(result, 'dates').status).toBe('warn');
    expect(item(result, 'structured-data').status).toBe('warn');
    expect(item(result, 'canonical').status).toBe('warn');
    expect(item(result, 'indexing-directives').status).toBe('pass');
  });

  it('finds bylines and dates outside JSON-LD', () => {
    const result = analyzeReadiness({
      html: page(
        '<meta name="author" content="Ana Lima"><meta property="article:published_time" content="2026-02-03T10:00:00Z">',
      ),
    });
    expect(item(result, 'byline').status).toBe('pass');
    expect(item(result, 'byline').detail).toContain('Ana Lima');
    expect(item(result, 'dates').status).toBe('pass');

    const body = analyzeReadiness({
      html: '<html><body><p class="byline">By <a rel="author" href="/ana">Ana Lima</a></p><time datetime="2026-02-03">3 Feb</time></body></html>',
    });
    expect(item(body, 'byline').status).toBe('pass');
    expect(item(body, 'dates').status).toBe('pass');
  });

  it('shortens a long author box to a name-sized excerpt in the detail', () => {
    const bio = `<div class="author"><h4>Ana Lima</h4><p>${'Ana has pulled shots for years. '.repeat(20)}</p></div>`;
    const result = analyzeReadiness({ html: `<html><body>${bio}</body></html>` });
    const byline = item(result, 'byline');
    expect(byline.status).toBe('pass');
    expect(byline.detail).toContain('Ana Lima');
    expect(byline.detail.length).toBeLessThan(160);
  });

  it('reads JSON-LD arrays and @graph, and lists every type', () => {
    const graph = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Example' },
        { '@type': ['FAQPage'], mainEntity: [] },
      ],
    });
    const list = JSON.stringify([{ '@type': 'HowTo', name: 'Pull a shot' }]);
    const result = analyzeReadiness({
      html: page(
        `<script type="application/ld+json">${graph}</script><script type="application/ld+json">${list}</script>`,
      ),
    });
    const structured = item(result, 'structured-data');
    expect(structured.status).toBe('pass');
    for (const t of ['Organization', 'FAQPage', 'HowTo']) expect(structured.detail).toContain(t);
  });

  it('notes sameAs profile links on the author or organization, without changing the status', () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name: 'Example Cafe',
          sameAs: ['https://www.linkedin.com/company/example-cafe', 'not a url'],
        },
        {
          '@type': 'BlogPosting',
          author: { '@type': 'Person', name: 'Ana', sameAs: 'https://www.youtube.com/@ana' },
          // A sameAs on the article itself is not a profile of its author.
          sameAs: 'https://en.wikipedia.org/wiki/Espresso',
        },
      ],
    });
    const result = analyzeReadiness({
      html: page(`<script type="application/ld+json">${ld}</script>`),
    });
    const structured = item(result, 'structured-data');
    expect(structured.status).toBe('pass');
    expect(structured.detail).toContain(
      'sameAs links the author or organization to 2 profiles: linkedin.com, youtube.com.',
    );
    expect(structured.detail).not.toContain('wikipedia');

    const without = item(analyzeReadiness({ html: blogPosting }), 'structured-data');
    expect(without.status).toBe('pass');
    expect(without.detail).toContain('No sameAs link ties the author or organization');
  });

  it('reads sameAs on LocalBusiness subtypes as profile links', () => {
    for (const type of ['CafeOrCoffeeShop', 'Restaurant', 'Store']) {
      const ld = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': type,
        name: 'Example Cafe',
        sameAs: 'https://www.instagram.com/examplecafe',
      });
      const detail = item(
        analyzeReadiness({ html: page(`<script type="application/ld+json">${ld}</script>`) }),
        'structured-data',
      ).detail;
      expect(detail, type).toContain('sameAs links the author or organization to 1 profile');
    }
  });

  it('does not read sameAs on pages, posts, listings, apps, services, places or brands as profiles', () => {
    for (const type of [
      'Blog',
      'DiscussionForumPosting',
      'JobPosting',
      'MobileApplication',
      'Service',
      'Place',
      'Brand',
      'SomeUnknownType',
    ]) {
      const ld = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': type,
        name: 'Example',
        sameAs: 'https://www.instagram.com/example',
      });
      const detail = item(
        analyzeReadiness({ html: page(`<script type="application/ld+json">${ld}</script>`) }),
        'structured-data',
      ).detail;
      expect(detail, type).not.toContain('sameAs links the author or organization');
    }
    for (const type of ['Person', 'NGO', 'BookStore', 'Dentist', 'ProfessionalService']) {
      const ld = JSON.stringify({ '@type': type, name: 'X', sameAs: 'https://x.com/example' });
      expect(
        item(
          analyzeReadiness({ html: page(`<script type="application/ld+json">${ld}</script>`) }),
          'structured-data',
        ).detail,
        type,
      ).toContain('sameAs links the author or organization to 1 profile');
    }
  });

  it('says nothing about sameAs when there is no readable JSON-LD', () => {
    for (const head of ['', '<script type="application/ld+json">{oops</script>']) {
      expect(item(analyzeReadiness({ html: page(head) }), 'structured-data').detail).not.toContain(
        'sameAs',
      );
    }
  });

  it('warns on JSON-LD that does not parse or has no @type', () => {
    const broken = analyzeReadiness({
      html: page('<script type="application/ld+json">{"@type": "Article",</script>'),
    });
    expect(item(broken, 'structured-data').status).toBe('warn');
    expect(item(broken, 'structured-data').detail).toMatch(/could not be read/i);
    const untyped = analyzeReadiness({
      html: page('<script type="application/ld+json">{"name": "x"}</script>'),
    });
    expect(item(untyped, 'structured-data').status).toBe('warn');
  });

  it('fails nosnippet, max-snippet:0, none and a googlebot noindex; warns on noarchive', () => {
    const cases: [string, 'fail' | 'warn' | 'pass'][] = [
      ['<meta name="robots" content="index, nosnippet">', 'fail'],
      ['<meta name="robots" content="max-snippet: 0">', 'fail'],
      ['<meta name="robots" content="none">', 'fail'],
      ['<meta name="googlebot" content="NOINDEX">', 'fail'],
      ['<meta name="robots" content="max-snippet:50">', 'pass'],
      ['<meta name="robots" content="max-snippet:-1, index, follow">', 'pass'],
      ['<meta name="bingbot" content="noarchive">', 'warn'],
      ['<meta name="otherbot" content="noindex">', 'pass'],
    ];
    for (const [head, status] of cases) {
      expect(item(analyzeReadiness({ html: page(head) }), 'indexing-directives').status, head).toBe(
        status,
      );
    }
  });

  it('fails indexing directives for an X-Robots-Tag header', () => {
    const result = analyzeReadiness({ html: page(''), xRobotsTag: 'noindex' });
    expect(item(result, 'indexing-directives').status).toBe('fail');
    expect(item(result, 'indexing-directives').detail).toContain('X-Robots-Tag');
  });

  it('reads a user-agent scope in an X-Robots-Tag header for the directive right after it', () => {
    const directives = (xRobotsTag: string) =>
      item(analyzeReadiness({ html: page(''), xRobotsTag }), 'indexing-directives');
    const cases: [string, 'fail' | 'warn' | 'pass'][] = [
      ['googlebot: noindex', 'fail'],
      ['BingBot: nosnippet', 'fail'],
      ['*: noindex', 'fail'],
      ['googlebot: index, nosnippet', 'fail'],
      ['otherbot: noindex', 'warn'],
      // fetch joins separate header lines with ", ", so a later directive may be a line of its
      // own that applies to every crawler ("otherbot: nofollow" then "noindex").
      ['otherbot: noindex, nosnippet', 'fail'],
      ['otherbot: nofollow, noindex', 'fail'],
      ['otherbot: noindex, noarchive', 'warn'],
      ['otherbot: noindex, googlebot: nosnippet', 'fail'],
      ['googlebot: noarchive', 'warn'],
      ['max-snippet: 0', 'fail'],
      ['googlebot: max-snippet: 0', 'fail'],
      ['otherbot: max-snippet: 0', 'warn'],
      ['googlebot: max-snippet: 50', 'pass'],
    ];
    for (const [header, status] of cases) expect(directives(header).status, header).toBe(status);
    expect(directives('googlebot: noindex').detail).toContain(
      'X-Robots-Tag header: googlebot: noindex',
    );
    const joined = directives('otherbot: nofollow, noindex').detail;
    expect(joined).toContain('X-Robots-Tag header: noindex (may be scoped to otherbot');
    expect(joined).toMatch(/header lines arrive joined/);
    expect(directives('otherbot: noindex').detail).toMatch(/only to the crawler named/);
  });

  it('warns on a relative canonical and on two different canonicals', () => {
    const relative = analyzeReadiness({ html: page('<link rel="canonical" href="/post">') });
    expect(item(relative, 'canonical').status).toBe('warn');
    const two = analyzeReadiness({
      html: page(
        '<link rel="canonical" href="https://example.com/a"><link rel="canonical" href="https://example.com/b">',
      ),
    });
    expect(item(two, 'canonical').status).toBe('warn');
  });

  it('leaves crawler access and rendering unknown, pointing at ce site', () => {
    const result = analyzeReadiness({ html: blogPosting });
    for (const id of ['crawler-access', 'renders-without-js'] as const) {
      expect(item(result, id).status, id).toBe('unknown');
      expect(item(result, id).detail, id).toContain('ce site');
    }
  });
});

describe('READINESS_EVIDENCE', () => {
  it('has one entry per item with one of the four grades and linked https sources', () => {
    expect(Object.keys(READINESS_EVIDENCE)).toEqual([...READINESS_IDS]);
    for (const id of READINESS_IDS) {
      const { grade, summary, sources } = READINESS_EVIDENCE[id];
      expect(GRADES).toContain(grade);
      expect(summary.trim().length, id).toBeGreaterThan(40);
      expect(sources.length, id).toBeGreaterThanOrEqual(1);
      expect(sources.length, id).toBeLessThanOrEqual(4);
      for (const s of sources) {
        expect(s.url, `${id}/${s.id}`).toMatch(/^https:\/\//);
        expect(s.claim.trim(), `${id}/${s.id}`).not.toBe('');
        expect(s.citation.trim(), `${id}/${s.id}`).not.toBe('');
      }
    }
  });

  it('never uses the retired grade word', () => {
    expect(JSON.stringify(READINESS_EVIDENCE)).not.toMatch(BANNED);
  });
});

describe('docs/evidence.md, Site readiness', () => {
  const start = DOC.search(/^## Site readiness$/m);
  const next = DOC.indexOf('\n## ', start + 1);
  const section = DOC.slice(start, next === -1 ? undefined : next);

  it('has a Site readiness section that says it is not part of the GEO Score', () => {
    expect(start).toBeGreaterThan(-1);
    expect(section).toMatch(/not part of (the|any) GEO Score/i);
  });

  it('states the same grade as the registry for every item', () => {
    for (const id of READINESS_IDS) {
      const at = section.search(new RegExp(`^### .*\`${id}\``, 'm'));
      expect(at, `subsection for ${id}`).toBeGreaterThan(-1);
      const end = section.indexOf('\n### ', at + 1);
      const sub = section.slice(at, end === -1 ? undefined : end);
      expect(sub, id).toContain(`Grade: **${READINESS_EVIDENCE[id].grade}**`);
    }
  });
});
