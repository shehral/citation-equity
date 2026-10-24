// `ce sources`: who gets cited for the author's questions, from a `ce live` report or pasted
// answers. It reads local files only; the fake fetch checks that no request is made.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostOf, OFFPAGE_ADVICE, OFFPAGE_NOTE } from '@citation-equity/engine';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LIVE_CAVEAT, type LiveReport, wilson } from '../src/index';
import { runCli } from '../src/node/cli';
import { domainOf } from '../src/node/domain';
import { parsePastedAnswers } from '../src/node/sources';

const EM_DASH = '—';
const dirs: string[] = [];
async function file(name: string, text: string) {
  const dir = await mkdtemp(join(tmpdir(), 'ce-sources-'));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, text);
  return path;
}
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function ce(args: string[]) {
  let stdout = '';
  let stderr = '';
  const fetchImpl = vi.fn(async () => {
    throw new Error('no request expected');
  });
  const code = await runCli(args, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
    fetch: fetchImpl as unknown as typeof fetch,
  });
  expect(fetchImpl).not.toHaveBeenCalled();
  return { code, stdout, stderr };
}

const PASTED = `# Answers copied from Perplexity, 2026-10-23

Q: Why does espresso taste bitter?
Espresso tastes bitter when it over-extracts [1][2].
1. https://www.reddit.com/r/espresso/comments/abc/bitter/
2. https://en.wikipedia.org/wiki/Espresso

Q: How fine should I grind for espresso?
Grind finer until a shot takes 25 to 30 seconds ([guide](https://www.example.com/grind)).
See also https://reddit.com/r/espresso/comments/def and https://youtube.com/watch?v=x.
`;

describe('parsePastedAnswers', () => {
  it('splits a file into one block per "Q:" line, comments before the first ignored', () => {
    expect(parsePastedAnswers(PASTED).map((b) => b.question)).toEqual([
      'Why does espresso taste bitter?',
      'How fine should I grind for espresso?',
    ]);
    expect(parsePastedAnswers(PASTED)[0].text).toContain('reddit.com/r/espresso/comments/abc');
  });

  it('keeps an FAQ-style "Q:" and "A:" pair inside an answer as part of that answer', () => {
    const pasted = `Q: Is espresso bitter?
Often, yes [1].
FAQ from the cited page:
Q: Does a darker roast help?
A: Sometimes.
q: lower case is not a marker either
  Q: nor is an indented one
1. https://www.example.com/faq

Q: What grind?
Fine [1].
`;
    const blocks = parsePastedAnswers(pasted);
    expect(blocks.map((b) => b.question)).toEqual(['Is espresso bitter?', 'What grind?']);
    expect(blocks[0].text).toContain('Q: Does a darker roast help?');
    expect(blocks[0].text).toContain('https://www.example.com/faq');
    // The residual probe: an FAQ pair after a blank line inside an answer is not a new answer.
    const probe = parsePastedAnswers(
      'Q: one\nanswer\n\nQ: is it good?\nA: yes\n\nQ: two\nanswer two',
    );
    expect(probe.map((b) => b.question)).toEqual(['one', 'two']);
    expect(probe[0].text).toContain('A: yes');
  });

  it('starts a new answer at every column-0 "Q:" line, with or without a blank line before it', () => {
    const blocks = parsePastedAnswers('Q: one\nanswer one\nQ: two\nanswer two');
    expect(blocks).toEqual([
      { question: 'one', text: 'answer one' },
      { question: 'two', text: 'answer two' },
    ]);
  });

  it('reads a file written as Q: and A: pairs as one answer per pair', () => {
    const blocks = parsePastedAnswers(
      'Q: one\nA: answer one https://a.example\n\nQ: two\nA: answer two https://b.example\n',
    );
    expect(blocks.map((b) => b.question)).toEqual(['one', 'two']);
  });

  it('rejects text before the first question and a file with no question', () => {
    expect(() => parsePastedAnswers('https://example.com\nQ: a?\n')).toThrow(/Q: /);
    expect(() => parsePastedAnswers('# only a comment\n\n')).toThrow(/Q: /);
    expect(() => parsePastedAnswers('Q:   \nhttps://example.com\n')).toThrow(/empty question/i);
  });
});

describe('ce sources --pasted', () => {
  it('groups the cited domains by kind, finds the own site and prints the advice cards', async () => {
    const path = await file('answers.txt', PASTED);
    const { code, stdout, stderr } = await ce([
      'sources',
      '--pasted',
      path,
      '--own',
      'example.com',
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout.startsWith(`${OFFPAGE_NOTE}\n`)).toBe(true);
    expect(stdout.trimEnd().endsWith(OFFPAGE_NOTE)).toBe(true);
    expect(stdout).toContain('2 answers to 2 questions');
    expect(stdout).toContain('Your site (example.com): cited in 1 of 2 answers.');
    expect(stdout).toMatch(/Forums and Q&A sites \(forum\)\n {2}reddit\.com +2 of 2 answers/);
    expect(stdout).toContain('wikipedia.org');
    expect(stdout).toContain('youtube.com');
    expect(stdout).not.toMatch(/^ {2}example\.com/m);
    for (const kind of ['forum', 'wiki', 'video'] as const) {
      const card = OFFPAGE_ADVICE[kind];
      expect(stdout).toContain(`${card.title} (evidence: ${card.evidence.grade})`);
      expect(stdout).toContain(card.advice);
      expect(stdout).toContain(card.avoid);
    }
    expect(stdout).not.toContain(OFFPAGE_ADVICE.commerce.title);
    expect(stdout).toContain('docs/evidence.md');
    expect(stdout).not.toContain(EM_DASH);
  });

  it('says when the own site is not cited, and how to check it when --own is missing', async () => {
    const path = await file('answers.txt', PASTED);
    const other = await ce(['sources', '--pasted', path, '--own', 'mysite.example']);
    expect(other.stdout).toContain('Your site (mysite.example): not cited in any of 2 answers.');
    const none = await ce(['sources', '--pasted', path]);
    expect(none.stdout).toContain('--own');
    expect(none.stdout).toMatch(/^ {2}example\.com +1 of 2 answers/m);
  });

  it('exits 1 with a plain message for a malformed file', async () => {
    const path = await file('answers.txt', 'just some text, no question\n');
    const { code, stderr } = await ce(['sources', '--pasted', path]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Q: /);
  });
});

describe('ce sources --live', () => {
  const source = (uri: string, domain: string) => ({ uri, domain });
  const report: LiveReport = {
    schemaVersion: 1,
    engine: 'gemini',
    model: 'gemini-test',
    targetUrl: 'https://www.example.com/espresso',
    createdAt: '2026-10-23T00:00:00.000Z',
    runs: [
      {
        question: 'Why does espresso taste bitter?',
        run: 1,
        answer: 'a',
        // An unresolved grounding redirect: the domain comes from the source's title.
        sources: [
          source('https://vertexaisearch.cloud.google.com/grounding-api-redirect/x', 'reddit.com'),
          source('https://example.com/espresso', 'example.com'),
        ],
        draftDomainCited: true,
        draftUrlCited: true,
      },
      {
        question: 'Why does espresso taste bitter?',
        run: 2,
        answer: 'b',
        sources: [
          source('https://www.reddit.com/r/espresso', 'reddit.com'),
          // A redirect whose title was not a domain: the site is unknown, so it is not counted.
          source('https://vertexaisearch.cloud.google.com/grounding-api-redirect/y', ''),
        ],
        draftDomainCited: false,
        draftUrlCited: false,
      },
    ],
    summary: { domainCited: wilson(1, 2), urlCited: wilson(1, 2), nQuestions: 1 },
    caveat: LIVE_CAVEAT,
  };

  it('tallies each run as an answer, using the source domain, and the target as the own site', async () => {
    const path = await file('live-gemini.json', JSON.stringify(report));
    const { code, stdout } = await ce(['sources', '--live', path]);
    expect(code).toBe(0);
    expect(stdout.startsWith(`${LIVE_CAVEAT}\n`)).toBe(true);
    expect(stdout.trimEnd().endsWith(LIVE_CAVEAT)).toBe(true);
    expect(stdout).toContain(OFFPAGE_NOTE);
    expect(stdout).toContain('2 answers to 1 question from ce live (gemini, gemini-test)');
    expect(stdout).toContain('Your site (example.com): cited in 1 of 2 answers.');
    expect(stdout).toMatch(/reddit\.com +2 of 2 answers/);
    expect(stdout).not.toContain('vertexaisearch');
    expect(stdout).toContain('1 source with no known site was left out.');
  });

  it('lets --own override the target and says when the report is incomplete', async () => {
    const partial = { ...report, incomplete: { planned: 8, error: 'HTTP 429' } };
    const path = await file('live-gemini.partial.json', JSON.stringify(partial));
    const { stdout } = await ce(['sources', '--live', path, '--own', 'reddit.com']);
    expect(stdout).toContain('Your site (reddit.com): cited in 2 of 2 answers.');
    expect(stdout).toContain('incomplete: 2 of 8 planned calls finished');
  });

  it('rejects a file that is not a ce live report', async () => {
    const path = await file('other.json', JSON.stringify({ schemaVersion: 1, queries: [] }));
    const { code, stderr } = await ce(['sources', '--live', path]);
    expect(code).toBe(1);
    expect(stderr).toContain('is not a ce live report');
  });
});

describe('ce sources options', () => {
  it('needs exactly one of --live and --pasted', async () => {
    const neither = await ce(['sources']);
    expect(neither.code).toBe(1);
    expect(neither.stderr).toMatch(/--live .* or --pasted/);
    const path = await file('answers.txt', PASTED);
    const both = await ce(['sources', '--live', path, '--pasted', path]);
    expect(both.code).toBe(1);
    expect(both.stderr).toMatch(/cannot be used with/);
  });
});

describe('domainOf', () => {
  it('is the engine hostOf, so ce live and ce sources normalise hosts the same way', () => {
    expect(domainOf).toBe(hostOf);
  });
});
