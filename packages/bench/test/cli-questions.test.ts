import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateQuestions } from '@citation-equity/engine';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/node/cli';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const fixture = (...name: string[]) => join(PKG, 'test', 'fixtures', ...name);
const SC = fixture('questions', 'Queries.csv');
const BING = fixture('signals', 'bing-queries.csv');

async function ce(args: string[], fetchImpl?: typeof fetch) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(args, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
    fetch: fetchImpl,
  });
  return { code, stdout, stderr };
}

/** The question lines of the output, which `ce analyze --questions` reads (# lines skipped). */
const questionLines = (s: string) =>
  s.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));

describe('ce questions', () => {
  it('--from-search-console prints the ranked questions with their sources and numbers', async () => {
    const { code, stdout, stderr } = await ce(['questions', '--from-search-console', SC]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(questionLines(stdout)).toEqual([
      'What is espresso grind size?',
      'What are espresso beans?',
      'Why is my espresso bitter?',
      'How to descale an espresso machine?',
      'best espresso grinder 2026',
    ]);
    expect(stdout).toContain(
      '# 1. Search Console: 2,310 impressions, 12 clicks. Query: "espresso grind size"',
    );
    expect(stdout).toContain('# 3. Search Console: 1,204 impressions, 31 clicks.\n');
    expect(stdout).toContain('Read locally; nothing is sent anywhere.');
  });

  it('--from-bing ranks by citations; both files together rank citations first', async () => {
    const bing = await ce(['questions', '--from-bing', BING]);
    expect(bing.code).toBe(0);
    expect(questionLines(bing.stdout)).toEqual([
      'Why is my espresso bitter?',
      'What is espresso grind size?',
    ]);
    expect(bing.stdout).toContain('# 1. Bing AI Performance: 52 citations.\n');

    const both = await ce(['questions', '--from-search-console', SC, '--from-bing', BING]);
    expect(both.code).toBe(0);
    expect(questionLines(both.stdout).slice(0, 3)).toEqual([
      'Why is my espresso bitter?',
      'What is espresso grind size?',
      'What are espresso beans?',
    ]);
  });

  it('its output works as a --questions file for ce analyze', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ce-questions-'));
    try {
      const { stdout } = await ce(['questions', '--from-bing', BING]);
      const file = join(dir, 'q.txt');
      await writeFile(file, stdout);
      const analyzed = await ce(['analyze', fixture('basic.md'), '--questions', file]);
      expect(analyzed.code).toBe(0);
      expect(analyzed.stdout).toContain(
        'Target questions (from q.txt):\n- Why is my espresso bitter?\n- What is espresso grind size?\n',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 with the headers found when the CSV is not the export', async () => {
    const { code, stderr } = await ce([
      'questions',
      '--from-search-console',
      fixture('signals', 'not-bing.csv'),
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain(
      'Not a Search Console Queries export: no query column (Google names it "Top queries"). Headers found: Keyword, Clicks, Impressions.',
    );
    const bing = await ce(['questions', '--from-bing', fixture('signals', 'bing-pages.csv')]);
    expect(bing.code).toBe(1);
    expect(bing.stderr).toContain('no query column');
  });

  it('--generate prints the questions generated from the draft with their sources', async () => {
    const draft = await readFile(fixture('basic.md'), 'utf8');
    const { code, stdout } = await ce(['questions', '--generate', fixture('basic.md')]);
    expect(code).toBe(0);
    expect(questionLines(stdout)).toEqual(generateQuestions(draft).map((q) => q.text));
    expect(stdout).toContain('Questions generated from your own draft tend to look covered');
  });

  it('--generate --local-model adds the local model questions, asking only for the title and intro', async () => {
    const prompts: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith('/api/chat')) return new Response('not found', { status: 404 });
      const body = JSON.parse(String(init?.body));
      prompts.push(body.messages[0].content);
      return Response.json({
        message: {
          role: 'assistant',
          content: '1. Is a darker roast more bitter?\nNot a question',
        },
        done: true,
      });
    }) as typeof fetch;
    const draft = await readFile(fixture('basic.md'), 'utf8');
    const { code, stdout } = await ce(
      ['questions', '--generate', fixture('basic.md'), '--local-model', '--model', 'tiny:1b'],
      fetchImpl,
    );
    expect(code).toBe(0);
    expect(prompts).toHaveLength(1);
    expect(questionLines(stdout)).toEqual([
      ...generateQuestions(draft).map((q) => q.text),
      'Is a darker roast more bitter?',
    ]);
    expect(stdout).toContain('Local model (tiny:1b)');
  });

  it('--local-model asks nothing when the draft already gives the most questions listed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ce-q-'));
    const headings = Array.from(
      { length: 10 },
      (_, i) => `## How do I fix problem ${i + 1}?\n\nText ${i}.`,
    );
    const file = join(dir, 'full.md');
    await writeFile(file, `# Espresso fixes\n\nA guide.\n\n${headings.join('\n\n')}\n`);
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('unexpected', { status: 500 });
    }) as typeof fetch;
    const { code, stdout } = await ce(
      ['questions', '--generate', file, '--local-model', '--model', 'tiny:1b'],
      fetchImpl,
    );
    await rm(dir, { recursive: true, force: true });
    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(questionLines(stdout)).toHaveLength(8);
    expect(stdout).toContain(
      '# Did not ask tiny:1b: the draft already gave 8 questions, the most this lists.',
    );
    expect(stdout).not.toContain('Also asked');
  });

  it('exits 2 with the fix line when the local model server is not running', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const { code, stderr } = await ce(
      ['questions', '--generate', fixture('basic.md'), '--local-model'],
      down,
    );
    expect(code).toBe(2);
    expect(stderr).toContain('ollama serve');
  });

  it('rejects a missing source, --generate mixed with a CSV, and --local-model alone', async () => {
    const none = await ce(['questions']);
    expect(none.code).toBe(1);
    expect(none.stderr).toContain('Pass --from-search-console, --from-bing or --generate.');
    const mixed = await ce(['questions', '--generate', fixture('basic.md'), '--from-bing', BING]);
    expect(mixed.code).toBe(1);
    expect(mixed.stderr).toContain('--generate cannot be combined with the CSV options.');
    const alone = await ce(['questions', '--from-bing', BING, '--local-model']);
    expect(alone.code).toBe(1);
    expect(alone.stderr).toContain('--local-model works with --generate.');
  });
});
