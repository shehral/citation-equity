import { describe, expect, it } from 'vitest';
import { check } from '../../src/checks/expert-quotes';
import { analyze, EVIDENCE, gather, parseDraft } from '../../src/index';
import fail from '../fixtures/checks/expert-quotes/fail.md?raw';
import pass from '../fixtures/checks/expert-quotes/pass.md?raw';

const run = (md: string) => check(gather(parseDraft(md)));
const slice = (md: string, r: { start: number; end: number }) => md.slice(r.start, r.end);
/** 320 words of prose with no quotation. */
const FILLER = Array.from(
  { length: 40 },
  () => 'Fresh coffee tastes sweet when brewed with care.',
).join(' ');
const withFiller = (quote: string) => `${FILLER}\n\n${quote}\n`;

describe('expert-quotes check', () => {
  it('passes a draft with an attributed quote', () => {
    const result = run(pass);
    expect(result.checkId).toBe('expert-quotes');
    expect(result.applicable).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.suggestions.filter((s) => s.kind === 'advisory')).toEqual([]);
    expect(result.metrics).toMatchObject({ quotes: 1, attributed: 1 });
  });

  it('fails a draft with no quotation and points at the top of the draft', () => {
    const result = run(fail);
    expect(result.applicable).toBe(true);
    expect(result.score).toBeLessThanOrEqual(0.2);
    expect(result.suggestions).toHaveLength(1);
    const [s] = result.suggestions;
    expect(s?.kind).toBe('advisory');
    expect(s?.grade).toBe(EVIDENCE['expert-quotes'].grade);
    expect(slice(fail, s?.range ?? { start: 0, end: 0 })).toBe(s?.before);
    expect(s?.before).toBe('Why does espresso taste bitter?');
  });

  it('keeps the no-quote advisory id when the text below the title changes', () => {
    const id = (md: string) => run(md).suggestions[0]?.id;
    expect(id(fail)).toBeDefined();
    expect(id(fail.replace('sweet and balanced', 'sweet and round'))).toBe(id(fail));
  });

  it('does not apply under 300 words', () => {
    expect(run('"Taste every shot," says Jane Doe.').applicable).toBe(false);
  });

  it('scores an unattributed quote 0.5 and points at it', () => {
    const md = withFiller('"Taste every shot before you serve it," says one barista.');
    const result = run(md);
    expect(result.score).toBe(0.5);
    expect(result.metrics).toMatchObject({ quotes: 1, attributed: 0 });
    const [s] = result.suggestions;
    expect(s?.kind).toBe('advisory');
    expect(s?.before).toBe('"Taste every shot before you serve it,"');
    expect(slice(md, s?.range ?? { start: 0, end: 0 })).toBe(s?.before);
  });

  it('does not read a callout blockquote as a quote', () => {
    for (const callout of [
      '> **Note:** Taste every shot before you serve it.',
      '> **Tip**: Taste every shot before you serve it.',
      '> [!NOTE]\n> Taste every shot before you serve it.',
    ]) {
      const result = run(withFiller(callout));
      expect(result.metrics, callout).toMatchObject({ quotes: 0 });
    }
  });

  it('treats an unattributed blockquote as a quote', () => {
    const md = withFiller('> Taste every shot before you serve it.\n> Then taste it again.');
    const result = run(md);
    expect(result.score).toBe(0.5);
    expect(result.suggestions[0]?.before).toBe(
      'Taste every shot before you serve it.\n> Then taste it again.',
    );
  });

  it.each([
    ['says + name', '"Taste every shot before you serve it," says Jane Doe.'],
    ['name + said', '"Taste every shot before you serve it," Jane Doe said.'],
    ['said + title', '“Taste every shot before you serve it,” said Dr. Lee.'],
    ['according to', 'According to Maria Rossi, "every shot deserves a taste first."'],
    ['name says before', 'Jane Doe says, "taste every shot before you serve it."'],
    ['em dash name', '"Taste every shot before you serve it." — Jane Doe'],
    [
      'title at org',
      '"Taste every shot before you serve it," says the head roaster at Example Coffee.',
    ],
    ['blockquote em dash', '> Taste every shot before you serve it.\n>\n> — Jane Doe'],
    ['blockquote double dash', '> Taste every shot before you serve it. -- Jane Doe'],
    ['bold name', '"Taste every shot before you serve it," says **Jane Doe**.'],
    [
      'name, role at org',
      '"Taste every shot before you serve it," Jane Doe, head roaster at Example Coffee.',
    ],
    [
      'role at org + said',
      '"Taste every shot before you serve it," the head roaster at Example Coffee said.',
    ],
    [
      'blockquote name, role at org',
      '> Taste every shot before you serve it.\n>\n> Jane Doe, head roaster at Example Coffee',
    ],
    [
      'blockquote title, role at org',
      '> Taste every shot before you serve it. Dr. Lee, a chemist at Example Lab.',
    ],
    // A sentence opener before a name, or a given name or surname that is also a short word.
    ['"But" before name says', 'But Jane Doe says, "taste every shot before you serve it."'],
    ['"And" before name adds', 'And Jane Doe adds: "taste every shot before you serve it."'],
    ['says + "An" given name', '"Taste every shot before you serve it," says An Nguyen.'],
    ['em dash "An" given name', '"Taste every shot before you serve it." — An Nguyen'],
    ['says + "No" surname', '"Taste every shot before you serve it," says No Hong-chul.'],
    ['according to "The" org', 'According to The Lancet, "every shot deserves a taste first."'],
    ['em dash "The" org', '"Taste every shot before you serve it." — The Coffee Compass'],
    ['blockquote em dash "An" name', '> Taste every shot before you serve it.\n>\n> — An Nguyen'],
  ])('counts an attributed quote (%s)', (_name, quote) => {
    const result = run(withFiller(quote));
    expect(result.metrics).toMatchObject({ quotes: 1, attributed: 1 });
    expect(result.score).toBe(1);
    expect(result.suggestions).toEqual([]);
  });

  it.each([
    ['a pronoun', '"Taste every shot before you serve it," she said.'],
    ['a speech verb inside the quote', '"Jane Doe says to taste every shot before serving."'],
    ['a pronoun after an opener', 'But He says, "taste every shot before you serve it."'],
    ['"Many said"', '"Taste every shot before you serve it," Many said.'],
    ['"Experts said"', 'Experts said, "taste every shot before you serve it."'],
    ['"Researchers noted"', '"Taste every shot before you serve it," Researchers noted.'],
  ])('does not count %s as an attribution', (_name, quote) => {
    expect(run(withFiller(quote)).metrics).toMatchObject({ quotes: 1, attributed: 0 });
  });

  // A comma, a few lowercase words and "at/of/from Capital" name nobody: a role only counts
  // after a full name or next to a speech verb.
  it.each([
    ['a blockquote clause with "from"', '> Use fresh beans, ideally beans from Ethiopia.'],
    [
      'a blockquote clause with "of"',
      '> Pull the shot slowly, then taste the result of Monday roast.',
    ],
    [
      'an inline quote followed by a clause',
      '"Rest the beans for a full week first," a tip that sounds odd, but beans from Kenya need it.',
    ],
    [
      'a sentence opener before a comma',
      '> In New York, most beans from Kenya taste bright and sweet.',
    ],
    [
      'a single word before a comma',
      '"Rest the beans for a full week first," Ideally, beans from Kenya.',
    ],
    [
      'an inline sentence opener before a comma',
      '"Rest the beans for a full week first," After Hurricane Maria, most farms from Puerto Rico did.',
    ],
  ])('does not count a role clause without a speaker (%s)', (_name, quote) => {
    const md = withFiller(quote);
    const result = run(md);
    expect(result.metrics).toMatchObject({ quotes: 1, attributed: 0 });
    expect(result.score).toBe(0.5);
    const [s] = result.suggestions;
    expect(s?.kind).toBe('advisory');
    expect(slice(md, s?.range ?? { start: 0, end: 0 })).toBe(s?.before);
  });

  it('ignores scare quotes, code and front matter', () => {
    const md = `---\nquote: "Taste every shot," says Jane Doe.\n---\n\n${FILLER} The "best" beans matter.\n\n\`\`\`\n"Taste every shot," says Jane Doe.\n\`\`\`\n\nRun \`echo "taste every shot now"\` first.\n`;
    const result = run(md);
    expect(result.metrics.quotes).toBe(0);
    expect(result.score).toBe(0);
  });

  it('gives the same suggestion ids on every run', () => {
    const md = withFiller('"Taste every shot before you serve it," says one barista.');
    const ids = () =>
      analyze(md)
        .checks.find((c) => c.checkId === 'expert-quotes')
        ?.suggestions.map((s) => s.id);
    expect(ids()).toHaveLength(1);
    expect(ids()).toEqual(ids());
  });
});

describe('expert-quotes advice copy', () => {
  const grade = `Evidence grade: ${EVIDENCE['expert-quotes'].grade}.`;
  const banned = new RegExp(['contra', 'dicted'].join(''), 'i');

  it('asks for real quotes only and states the evidence grade', () => {
    const [s] = run(fail).suggestions;
    expect(s?.rationale).toContain('Only quote what a real person actually said.');
    expect(s?.rationale).toContain(
      'In the larger studies, adding quotations for their own sake did not raise citation rank',
    );
    expect(s?.rationale).toContain(grade);
    expect(s?.rationale).not.toMatch(banned);
  });

  it('asks to name only the real speaker of an unattributed quote', () => {
    const [s] = run(
      withFiller('"Taste every shot before you serve it," says one barista.'),
    ).suggestions;
    expect(s?.rationale).toContain('Name only the person who really said it.');
    expect(s?.rationale).toContain(grade);
  });

  it('anchors the no-quote advice on the first sentence when no heading leads the draft', () => {
    const md = `Espresso is a small strong coffee. ${FILLER}\n`;
    const [s] = run(md).suggestions;
    expect(s?.before).toBe('Espresso is a small strong coffee.');
    expect(run(md.replace('coffee. ', 'coffee. Really. ')).suggestions[0]?.id).toBe(s?.id);
  });
});
