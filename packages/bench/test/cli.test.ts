import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CHECK_DEFINITIONS,
  CHECK_IDS,
  generateQuestions,
  NOTE_CHECKS,
  pageQuestions,
  QUESTION_CHECKS,
  QUESTION_LABELS,
  TEST_LABEL_TEXT,
  TEST_LABELS,
  type TestLabel,
} from '@citation-equity/engine';
import { execa } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';
import { type BenchReport, CAVEAT, type Comparison, validatePack } from '../src/index';
import { isEntryModule, questionLabelWords, runCli } from '../src/node/cli';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name: string) => join(PKG, 'test', 'fixtures', name);

const dirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'ce-cli-'));
  dirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** Runs the CLI in-process with captured output and the given fetch. */
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

/** An Ollama stand-in whose /api/chat always answers citing sources [1] and [2]. */
function ollamaFake() {
  const prompts: string[] = [];
  const options: Record<string, unknown>[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.endsWith('/api/chat')) return new Response('not found', { status: 404 });
    const body = JSON.parse(String(init?.body));
    prompts.push(body.messages[0].content);
    options.push(body.options);
    return Response.json({
      message: {
        role: 'assistant',
        content: 'Bitterness comes from over-extraction [1]. Grind coarser [2].',
      },
      done: true,
    });
  }) as typeof fetch;
  return { fetchImpl, prompts, options };
}

const nonEmptyLines = (s: string) => s.split('\n').filter((l) => l.trim() !== '');

describe('ce analyze', () => {
  const ROOT = join(PKG, '..', '..');
  const ESPRESSO = join(ROOT, 'samples', 'espresso-bitterness');
  /** The espresso sample's four pack questions, one per line, in a file named q.txt. */
  async function packQuestions() {
    const pack = validatePack(JSON.parse(await readFile(join(ESPRESSO, 'pack.json'), 'utf8')));
    const file = join(await tempDir(), 'q.txt');
    await writeFile(file, `${pack.queries.map((q) => q.query).join('\n')}\n`);
    return file;
  }
  /** The label line as the engine's labels for one question input word it. */
  const labelLine = (input: 'reader' | 'page', note: string) => {
    const { words, answer } = QUESTION_LABELS[input];
    const text = (l: TestLabel) => TEST_LABEL_TEXT[l].toLowerCase();
    return words === answer
      ? `Label: ${text(words)} (${note})`
      : `Label: words up top ${text(words)}; answered ${text(answer)} (${note})`;
  };

  it('prints the analysis as JSON with the question report when run as a process (tsx, source condition)', async () => {
    const result = await execa(
      'tsx',
      [
        '--conditions=@citation-equity/source',
        'src/node/cli.ts',
        'analyze',
        join(ESPRESSO, 'before.md'),
        '--json',
      ],
      { cwd: PKG, preferLocal: true, reject: false },
    );
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.schemaVersion).toBe(2);
    expect(json).not.toHaveProperty('scores');
    // Without --questions the report measures the page's own questions.
    const page = pageQuestions(await readFile(join(ESPRESSO, 'before.md'), 'utf8'));
    expect(page.length).toBeGreaterThan(0);
    expect(json.questions.from).toBe('page');
    expect(json.questions.rows.map((r: { question: string }) => r.question)).toEqual(
      page.map((q) => q.text),
    );
    expect(json.checks.map((c: { checkId: string }) => c.checkId)).toEqual([...CHECK_IDS]);
  });

  it('leads with the questions covered, then suggested questions, the writing notes, the suggestions and the closing line', async () => {
    const { code, stdout } = await ce([
      'analyze',
      join(ESPRESSO, 'before.md'),
      '--questions',
      await packQuestions(),
    ]);
    expect(code).toBe(0);
    const lines = stdout.split('\n');
    expect(lines.slice(0, 14)).toEqual([
      'Questions covered: 0 of 4 (from q.txt)',
      labelLine('reader', "your readers' own questions"),
      '- Why does my espresso taste bitter?',
      '    words up top: yes',
      "    answered: no. The first sentence of the matching section uses 1 of the question's 3 key words.",
      '- How do I fix bitter espresso?',
      '    words up top: missing "fix"',
      "    answered: no. The first sentence of the matching section uses 1 of the question's 3 key words.",
      '- What water temperature should I use for espresso?',
      '    words up top: missing "water", "temperature"',
      '    answered: no. The first sentence of the matching section has 4 words; a direct answer runs 8 to 40.',
      '- How long should an espresso shot take?',
      '    words up top: missing "long"',
      "    answered: no. The first sentence of the matching paragraph uses 1 of the question's 4 key words.",
    ]);
    expect(lines[14]).toBe('');
    expect(lines[15]).toBe(
      "Suggested from the draft's title and headings (add the ones you want to a --questions file):",
    );

    const notes = lines.indexOf('Writing notes (each label says what our own tests found)');
    expect(notes).toBeGreaterThan(15);
    expect(lines.slice(notes + 1, notes + 4)).toEqual([
      'Check                  Label                  Grade     Title',
      'standalone-paragraphs  unclear                untested  Standalone paragraphs',
      'question-headings      no effect in our test  mixed     Question headings',
    ]);
    // One row per note check, in registry order, with its label and grade; then a blank line.
    const rows = lines.slice(notes + 2, notes + 2 + NOTE_CHECKS.length);
    expect(lines[notes + 2 + NOTE_CHECKS.length]).toBe('');
    NOTE_CHECKS.forEach((id, i) => {
      const def = CHECK_DEFINITIONS.find((d) => d.id === id);
      const label = TEST_LABEL_TEXT[TEST_LABELS[id]].toLowerCase();
      expect(rows[i]).toMatch(
        new RegExp(
          `^${id} +${label} +${def?.evidence.grade} +${def?.title.replace(/[()]/g, '\\$&')}$`,
        ),
      );
    });
    // The two question checks show only in the questions block.
    for (const id of QUESTION_CHECKS) expect(stdout).not.toMatch(new RegExp(`^${id} `, 'm'));

    const suggestions = lines.indexOf('Suggestions (29)');
    expect(suggestions).toBeGreaterThan(notes);
    expect(lines.slice(suggestions + 1, suggestions + 2)).toEqual([
      '  [advisory] standalone-paragraphs: Make this paragraph stand on its own',
    ]);
    expect(lines).toContain(
      '  [edit] question-headings: End this heading with "?", or reword it as a question',
    );
    expect(nonEmptyLines(stdout).at(-1)).toBe(
      'Grades say how well published studies support each check; labels say what our own tests found. See docs/evidence.md.',
    );
    expect(lines.filter((l) => /score/i.test(l))).toEqual([]);
  });

  it('prints under a suggestion only its own finding, also when findings share a range', async () => {
    const { stdout } = await ce([
      'analyze',
      join(ESPRESSO, 'before.md'),
      '--questions',
      await packQuestions(),
    ]);
    const lines = stdout.split('\n');
    // Every reader-words finding sits at the top of the draft; each suggestion's rationale already
    // quotes its own, so none is printed on a line of its own.
    const water = lines.indexOf(
      '  [advisory] reader-words: Use the words of "What water temperature should I use for espresso?" up top',
    );
    expect(water).toBeGreaterThan(0);
    expect(lines[water + 2]).toMatch(
      /^ {6}The top of the page holds 1 of the 3 key words of "What water/,
    );
    expect(stdout).not.toContain(
      '\n      The top of the page holds 2 of the 3 key words of "How do I fix bitter espresso?".\n',
    );
  });

  it("measures the page's own questions without --questions, and lists every other generated question as a suggestion", async () => {
    const draft = join(ROOT, 'samples', 'rag-explained', 'before.md');
    const md = await readFile(draft, 'utf8');
    const page = pageQuestions(md).map((q) => q.text);
    const others = generateQuestions(md)
      .map((q) => q.text)
      .filter((q) => !page.includes(q));
    expect(page.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    const { code, stdout } = await ce(['analyze', draft]);
    expect(code).toBe(0);
    const lines = stdout.split('\n');
    expect(lines[0]).toMatch(
      new RegExp(
        `^Questions covered: \\d+ of ${page.length} \\(from the page's title and topic; pass --questions to use your readers'\\)$`,
      ),
    );
    expect(lines[1]).toBe(labelLine('page', 'questions made from the page'));
    expect(lines.filter((l) => l.startsWith('- ')).slice(0, page.length)).toEqual(
      page.map((q) => `- ${q}`),
    );
    const block = lines.slice(
      lines.indexOf(
        "Suggested from the draft's title and headings (add the ones you want to a --questions file):",
      ) + 1,
    );
    expect(block.slice(0, others.length)).toEqual(others.map((q) => `- ${q}`));
    expect(block[others.length]).toBe('');
    const json = JSON.parse((await ce(['analyze', draft, '--json'])).stdout);
    expect(json.questions.from).toBe('page');
    expect(json.questions.rows.map((r: { question: string }) => r.question)).toEqual(page);
    // The answer check measures the same page questions, so its advice matches the block above.
    const coverage = json.checks.find(
      (c: { checkId: string }) => c.checkId === 'question-coverage',
    );
    const answered = json.questions.rows.filter(
      (r: { answer: { covered: boolean } }) => r.answer.covered,
    ).length;
    expect(coverage).toMatchObject({
      applicable: true,
      metrics: { questions: page.length, covered: answered },
    });
  });

  it('names at most three missing words, and gives a question with no key words only its answer line', async () => {
    const dir = await tempDir();
    const questions = join(dir, 'q.txt');
    await writeFile(
      questions,
      'How do grinders, tampers, scales and kettles differ?\nHow does it work?\n',
    );
    const { code, stdout } = await ce(['analyze', fixture('basic.md'), '--questions', questions]);
    expect(code).toBe(0);
    const lines = stdout.split('\n');
    const first = lines.indexOf('- How do grinders, tampers, scales and kettles differ?');
    expect(lines[first + 1]).toBe(
      '    words up top: missing "grinders", "tampers", "scales" and 2 more',
    );
    const second = lines.indexOf('- How does it work?');
    expect(lines[second + 1]).toMatch(/^ {4}answered: /);
    expect(lines[second + 2]).not.toMatch(/words up top/);
  });

  it('locates each suggestion: its line, the text it is about, and the finding behind it', async () => {
    const dir = await tempDir();
    const file = join(dir, 'draft.md');
    await writeFile(
      file,
      '# Espresso guide\n\nIntro text about espresso.\n\n## Grind size\n\nGrind finer for a slower shot.\n\n## Water temperature\n\nUse water near 93 degrees.\n',
    );
    // A question list is what gives this draft a question-coverage advisory.
    const questions = join(dir, 'q.txt');
    await writeFile(questions, 'How long should a shot of espresso take?\n');
    const { code, stdout } = await ce(['analyze', file, '--questions', questions]);
    expect(code).toBe(0);
    const lines = stdout.split('\n');
    const at = lines.indexOf('      line 5: "Grind size"');
    expect(lines[at - 1]).toBe('  [advisory] question-headings: Phrase this heading as a question');
    const [where, finding] = lines.slice(at, at + 2);
    expect(where).toBe('      line 5: "Grind size"');
    expect(finding).toBe('      "Grind size" is a statement, not a question.');
    expect(lines).toContain('      line 9: "Water temperature"');
    // A finding the rationale already quotes is not printed twice.
    const coverage = lines.findIndex((l) => l.includes('[advisory] question-coverage'));
    expect(coverage).toBeGreaterThan(0);
    expect(lines[coverage + 2]).toMatch(/Evidence grade: mixed\.$/);
  });

  it('says "No content yet" for an empty draft, with no questions block', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'empty.md'), '   \n');
    const { code, stdout } = await ce(['analyze', join(dir, 'empty.md')]);
    expect(code).toBe(0);
    expect(stdout.split('\n')[0]).toBe('No content yet');
    expect(stdout).not.toContain('Questions covered');
    expect(stdout).not.toMatch(/^Label:/m);
    expect(stdout).toContain('Suggestions: none');
  });

  it('reads HTML when asked', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'page.txt'), '<h2>Why?</h2><p>Because it is.</p>');
    const { code, stdout } = await ce([
      'analyze',
      join(dir, 'page.txt'),
      '--format',
      'html',
      '--json',
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).markdown).toContain('## Why?');
  });

  it('checks the questions in --questions (one per line, # comments and blanks skipped)', async () => {
    const dir = await tempDir();
    const file = join(dir, 'q.txt');
    await writeFile(
      file,
      '# reader questions\nWhy does espresso taste bitter?\n\nWhich bank has the lowest rate?\n',
    );
    const { code, stdout } = await ce(['analyze', fixture('basic.md'), '--questions', file]);
    expect(code).toBe(0);
    expect(stdout.split('\n')[0]).toBe('Questions covered: 0 of 2 (from q.txt)');
    expect(stdout).toContain('\n- Why does espresso taste bitter?\n');
    expect(stdout).toContain('\n- Which bank has the lowest rate?\n');
    expect(stdout).toContain('Answer "Which bank has the lowest rate?" directly');
    const json = JSON.parse(
      (await ce(['analyze', fixture('basic.md'), '--questions', file, '--json'])).stdout,
    );
    expect(json.schemaVersion).toBe(2);
    expect(json).not.toHaveProperty('scores');
    expect(json.questions.from).toBe('yours');
    expect(json.questions.rows.map((r: { question: string }) => r.question)).toEqual([
      'Why does espresso taste bitter?',
      'Which bank has the lowest rate?',
    ]);
    // Both question checks measure the file's questions.
    for (const id of QUESTION_CHECKS) {
      const check = json.checks.find((c: { checkId: string }) => c.checkId === id);
      expect(check, id).toMatchObject({ applicable: true, metrics: { questions: 2 } });
    }
    const coverage = json.checks.find(
      (c: { checkId: string }) => c.checkId === 'question-coverage',
    );
    expect(coverage).toMatchObject({ applicable: true, metrics: { questions: 2, covered: 0 } });
  });

  it('exits 1 with a message for a missing questions file', async () => {
    const { code, stderr } = await ce([
      'analyze',
      fixture('basic.md'),
      '--questions',
      '/nonexistent/q.txt',
    ]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Cannot read \/nonexistent\/q\.txt/);
  });

  it('exits 1 with a message for a missing file', async () => {
    const { code, stderr } = await ce(['analyze', '/nonexistent/draft.md']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Cannot read \/nonexistent\/draft\.md/);
  });
});

describe('questionLabelWords (the label line of ce analyze)', () => {
  it('names one label when both lines agree, and each line when they differ', () => {
    expect(questionLabelWords({ words: 'helped', answer: 'helped' })).toBe('helped in our test');
    expect(questionLabelWords({ words: 'not-tested', answer: 'not-tested' })).toBe('not tested');
    expect(questionLabelWords({ words: 'not-tested', answer: 'helped' })).toBe(
      'words up top not tested; answered helped in our test',
    );
    expect(questionLabelWords({ words: 'no-effect', answer: 'may-help-less' })).toBe(
      'words up top no effect in our test; answered may help less',
    );
  });
});

describe('ce bench', () => {
  it('writes before, after, comparison and recording files and prints the caveat first and last', async () => {
    const out = await tempDir();
    const { fetchImpl, prompts } = ollamaFake();
    const { code, stdout, stderr } = await ce(
      [
        'bench',
        '--draft',
        fixture('basic.md'),
        '--after',
        fixture('after.md'),
        '--pack',
        fixture('tiny-pack.json'),
        '--runs',
        '2',
        '--k',
        '3',
        '--seed',
        '5',
        '--out',
        out,
        '--record',
      ],
      fetchImpl,
    );
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const lines = nonEmptyLines(stdout);
    expect(lines[0]).toBe(CAVEAT);
    expect(lines.at(-1)).toBe(CAVEAT);
    expect(stdout).toMatch(/^Draft "Bitter espresso guide" \(before\): 4 runs over 2 queries/m);
    // Per draft, in this order: valid runs and format failures, cited among valid answers,
    // the draft's share next to the chance level; the caveat closes the output.
    const block = stdout.slice(stdout.indexOf('Draft "Bitter espresso guide" (before)'));
    const at = (re: RegExp) => block.search(re);
    expect(at(/^ {2}Valid answers +4 of 4 \(0 format failures\)$/m)).toBeGreaterThan(0);
    expect(at(/^ {2}Cited among valid +\d+%/m)).toBeGreaterThan(at(/Valid answers/));
    expect(
      at(/^ {2}Draft share among valid +\d\.\d{3} .*chance level: 1 in [\d.]+ sources/m),
    ).toBeGreaterThan(at(/Cited among valid/));
    expect(stdout).toMatch(/^After vs before, paired over 2 queries/m);
    expect(stdout).toMatch(/^ {2}Format failures +\+0 points$/m);
    expect(stdout).toMatch(/^Pages cited in the after runs: median of \d+ competitor pages/m);

    const read = async <T>(name: string) =>
      JSON.parse(await readFile(join(out, name), 'utf8')) as T;
    const before = await read<BenchReport>('before.json');
    const after = await read<BenchReport>('after.json');
    const comparison = await read<Comparison>('comparison.json');
    const recording = await read<Record<string, string>>('recording.json');

    expect(before.draftId).toBe('before');
    expect(after.draftId).toBe('after');
    expect(before.settings).toEqual({
      k: 3,
      runs: 2,
      model: 'llama3.2:3b',
      temperature: 0.5,
      baseSeed: 5,
      numCtx: 16384,
    });
    expect(before.schemaVersion).toBe(2);
    expect(before.adapter).toBe('ollama');
    expect(before.runs).toHaveLength(4);
    expect(before.caveat).toBe(CAVEAT);
    expect(comparison).toMatchObject({
      beforeId: 'before',
      afterId: 'after',
      nQueries: 2,
      caveat: CAVEAT,
    });
    // 2 drafts x 2 queries x 2 runs; each key is distinct because it includes the seed.
    expect(prompts).toHaveLength(8);
    expect(Object.keys(recording)).toHaveLength(8);
    expect(Object.values(recording).every((a) => a.endsWith('Grind coarser [2].'))).toBe(true);
  });

  it('says when there is no interval or paired test, and the smallest p a few questions allow', async () => {
    const dir = await tempDir();
    const tiny = validatePack(JSON.parse(await readFile(fixture('tiny-pack.json'), 'utf8')));
    const one = { ...tiny, queries: tiny.queries.slice(0, 1) };
    await writeFile(join(dir, 'one.json'), JSON.stringify(one));
    const run = async (pack: string) => {
      const { fetchImpl } = ollamaFake();
      const args = ['bench', '--draft', fixture('basic.md'), '--after', fixture('after.md')];
      const r = await ce(
        [...args, '--pack', pack, '--runs', '2', '--out', join(dir, 'out')],
        fetchImpl,
      );
      expect(r.code).toBe(0);
      return r.stdout;
    };
    const single = await run(join(dir, 'one.json'));
    expect(single).toMatch(
      /^ {2}Draft share among valid +\d\.\d{3} \(no interval: one question\);/m,
    );
    expect(single).toMatch(/^After vs before, paired over 1 query$/m);
    expect(single).toContain(
      '  No paired test possible with one question; add questions to the pack to test the change.',
    );
    expect(single).not.toContain('sign-flip p');
    expect(single).not.toMatch(/interval (\d\.\d{3}) to \1/);

    const two = await run(fixture('tiny-pack.json'));
    expect(two).toMatch(/\(95% interval \d\.\d{3} to \d\.\d{3} over 2 questions\)/);
    expect(two).toMatch(/sign-flip p = /);
    expect(two).toContain('  With 2 questions the smallest p this test can give is 0.500.');
    expect(two).toMatch(/chance level: 1 in [\d.]+ sources when retrieved/);
  });

  it('sends the context window from --num-ctx (16384 by default) to Ollama', async () => {
    const run = async (extra: string[]) => {
      const { fetchImpl, options } = ollamaFake();
      const args = ['bench', '--draft', fixture('basic.md'), '--pack', fixture('tiny-pack.json')];
      const { code } = await ce(
        [...args, '--runs', '1', '--out', await tempDir(), ...extra],
        fetchImpl,
      );
      expect(code).toBe(0);
      return options.map((o) => o.num_ctx);
    };
    expect(await run([])).toEqual([16384, 16384]);
    expect(await run(['--num-ctx', '8192'])).toEqual([8192, 8192]);
  });

  it('writes only before.json without --after or --record', async () => {
    const out = await tempDir();
    const { fetchImpl } = ollamaFake();
    const { code } = await ce(
      [
        'bench',
        '--draft',
        fixture('basic.md'),
        '--pack',
        fixture('tiny-pack.json'),
        '--runs',
        '1',
        '--out',
        out,
      ],
      fetchImpl,
    );
    expect(code).toBe(0);
    await expect(readFile(join(out, 'before.json'), 'utf8')).resolves.toContain(
      '"draftId": "before"',
    );
    await expect(readFile(join(out, 'comparison.json'), 'utf8')).rejects.toThrow(/ENOENT/);
    await expect(readFile(join(out, 'recording.json'), 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('exits 2 with one fix line when Ollama is unreachable', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const { code, stderr } = await ce(
      [
        'bench',
        '--draft',
        fixture('basic.md'),
        '--pack',
        fixture('tiny-pack.json'),
        '--out',
        await tempDir(),
      ],
      down,
    );
    expect(code).toBe(2);
    expect(nonEmptyLines(stderr)).toEqual([
      'Ollama is not reachable at http://127.0.0.1:11434. Start Ollama: ollama serve',
    ]);
  });

  it('exits 2 with one fix line when the model is not pulled', async () => {
    const missing = (async () =>
      Response.json({ error: "model 'tiny:1b' not found" }, { status: 404 })) as typeof fetch;
    const { code, stderr } = await ce(
      [
        'bench',
        '--draft',
        fixture('basic.md'),
        '--pack',
        fixture('tiny-pack.json'),
        '--model',
        'tiny:1b',
        '--out',
        await tempDir(),
      ],
      missing,
    );
    expect(code).toBe(2);
    expect(nonEmptyLines(stderr)).toEqual([
      'Model tiny:1b is not installed. Run: ollama pull tiny:1b',
    ]);
  });

  it('exits 1 naming the problem for an invalid pack or a bad number', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'bad.json'), JSON.stringify({ schemaVersion: 2 }));
    const bad = await ce([
      'bench',
      '--draft',
      fixture('basic.md'),
      '--pack',
      join(dir, 'bad.json'),
    ]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/Invalid pack: schemaVersion must be 1/);

    const runs = await ce([
      'bench',
      '--draft',
      fixture('basic.md'),
      '--pack',
      fixture('tiny-pack.json'),
      '--runs',
      'many',
    ]);
    expect(runs.code).toBe(1);
    expect(runs.stderr).toMatch(/--runs/);
  });
});

describe('isEntryModule (import.meta.main before Node 24.2)', () => {
  it('is true only for the script Node was started with, symlinks resolved', async () => {
    const dir = await tempDir();
    const script = join(dir, 'cli.js');
    await writeFile(script, '');
    const link = join(dir, 'ce');
    await symlink(script, link);
    const url = pathToFileURL(script).href;
    expect(isEntryModule(url, script)).toBe(true);
    expect(isEntryModule(url, link)).toBe(true);
    expect(isEntryModule(url, join(dir, 'other.js'))).toBe(false);
    expect(isEntryModule(url, undefined)).toBe(false);
  });
});

describe('ce pack', () => {
  it('from-urls writes a validated pack and reports skipped URLs', async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, 'urls.txt'),
      '# my pages\nhttps://example.com/a\n\nhttps://example.com/private/b\n',
    );
    const html =
      '<html><head><title>Page A</title></head><body><article><h1>Page A</h1><p>Espresso tastes bitter when the shot runs long, and a coarser grind fixes most of it.</p></article></body></html>';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /private\n');
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const out = join(dir, 'pack.json');
    const { code, stdout, stderr } = await ce(
      [
        'pack',
        'from-urls',
        '--question',
        'why is espresso bitter',
        '--urls',
        join(dir, 'urls.txt'),
        '--id',
        'mine',
        '--out',
        out,
      ],
      fetchImpl,
    );
    expect(code).toBe(0);
    expect(stderr).toContain('Skipped https://example.com/private/b: disallowed by robots.txt');
    expect(stdout).toContain(out);
    const pack = validatePack(JSON.parse(await readFile(out, 'utf8')));
    expect(pack.packId).toBe('mine');
    expect(pack.queries[0].documents.map((d) => d.url)).toEqual(['https://example.com/a']);
  });

  it('cseo rejects an unknown domain', async () => {
    const { code, stderr } = await ce([
      'pack',
      'cseo',
      '--domains',
      'web,retail',
      '--out',
      join(await tempDir(), 'p.json'),
    ]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/retail/);
  });
});
