import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type BenchDraft,
  type BenchReport,
  type Comparison,
  compareReports,
  DEFAULT_SETTINGS,
  type EngineAdapter,
  type GenerateOptions,
  REMOTE_CAVEAT,
  RecordedAdapter,
  recordingKey,
  runBench,
  validatePack,
} from '../src/index';
import { type AnswerLine, collectPrompts, type PromptLine, readAnswers } from '../src/node/batch';
import { runCli } from '../src/node/cli';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const SAMPLE = fileURLToPath(new URL('../../../samples/espresso-bitterness/', import.meta.url));
const fixture = (name: string) => join(PKG, 'test', 'fixtures', name);

const dirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'ce-batch-'));
  dirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** Runs the CLI in-process; any fetch is counted and refused. */
async function ce(args: string[]) {
  let stdout = '';
  let stderr = '';
  let fetches = 0;
  const fetchImpl = (async () => {
    fetches++;
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const code = await runCli(args, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
    fetch: fetchImpl,
  });
  return { code, stdout, stderr, fetches };
}

/** Keeps every call runBench makes and answers each one citing a source picked from the seed. */
function capturingAdapter() {
  const calls: { prompt: string; opts: GenerateOptions }[] = [];
  const adapter: EngineAdapter = {
    name: 'capturing',
    async generate(prompt, opts) {
      calls.push({ prompt, opts });
      return `An answer [${(opts.seed % 3) + 1}].`;
    },
  };
  return { adapter, calls };
}

/** A deterministic stand-in for a cluster answer: cites one source chosen from the line. */
const fakeAnswer = (line: PromptLine) =>
  `Over-extraction makes espresso bitter [${(line.run % 3) + 1}]. Grind coarser [1].`;

const loadSample = async () => {
  const pack = validatePack(JSON.parse(await readFile(join(SAMPLE, 'pack.json'), 'utf8')));
  const draft: BenchDraft = {
    id: 'before',
    title: 'Why espresso tastes bitter',
    markdown: await readFile(join(SAMPLE, 'before.md'), 'utf8'),
  };
  return { pack, draft };
};

const withoutTime = (r: BenchReport) => ({ ...r, createdAt: '' });

describe('collectPrompts', () => {
  it('returns exactly the prompts and options runBench sends, in order, on a sample pack', async () => {
    const { pack, draft } = await loadSample();
    const settings = { ...DEFAULT_SETTINGS, runs: 3, baseSeed: 7, model: 'org/Model-9B' };
    const { adapter, calls } = capturingAdapter();
    const report = await runBench(pack, draft, adapter, settings);
    const lines = await collectPrompts(pack, draft, settings);

    expect(lines).toHaveLength(pack.queries.length * 3);
    expect(lines.map((l) => l.prompt)).toEqual(calls.map((c) => c.prompt));
    lines.forEach((line, i) => {
      const { opts } = calls[i];
      expect(line).toEqual({
        key: recordingKey(calls[i].prompt, opts),
        model: 'org/Model-9B',
        seed: opts.seed,
        temperature: opts.temperature,
        numCtx: 16384,
        prompt: calls[i].prompt,
        packId: pack.packId,
        draftId: 'before',
        queryId: report.runs[i].queryId,
        run: report.runs[i].run,
      });
      expect(opts.numCtx).toBe(line.numCtx);
    });
  });

  it('falls back to DEFAULT_SETTINGS for omitted settings, as runBench does', async () => {
    const { pack, draft } = await loadSample();
    const lines = await collectPrompts(pack, draft, { runs: 1, model: undefined });
    expect(lines).toHaveLength(pack.queries.length);
    expect(lines.every((l) => l.model === DEFAULT_SETTINGS.model)).toBe(true);
    expect(lines.map((l) => l.seed)).toEqual([1, 1001, 2001, 3001]);
  });
});

describe('readAnswers', () => {
  it('reads AnswerLine JSONL (blank lines and CRLF allowed); a later duplicate wins', () => {
    const lines: AnswerLine[] = [
      { key: 'aaaa0001', answer: 'first [1].', model: 'org/Model-9B' },
      { key: 'aaaa0002', answer: 'second [2].' },
      { key: 'aaaa0001', answer: 'replaced [3].' },
    ];
    const text = `${lines.map((l) => JSON.stringify(l)).join('\r\n')}\n\n`;
    expect(readAnswers(text)).toEqual({ aaaa0001: 'replaced [3].', aaaa0002: 'second [2].' });
  });

  it('reads a one-line JSONL file as an answer, not as a recording map', () => {
    expect(readAnswers('{"key":"aaaa0001","answer":"only [1]."}\n')).toEqual({
      aaaa0001: 'only [1].',
    });
  });

  it('reads the recording.json map that ce bench --record writes', () => {
    const map = { aaaa0001: 'one [1].', bbbb0002: 'two [2].' };
    expect(readAnswers(`${JSON.stringify(map, null, 2)}\n`)).toEqual(map);
  });

  it('names the line of bad JSON or of a line that is not an answer', () => {
    const good = JSON.stringify({ key: 'aaaa0001', answer: 'ok [1].' });
    expect(() => readAnswers(`${good}\n{"key": "x", "answer": \n`)).toThrow(
      /^Answers line 2 is not valid JSON/,
    );
    expect(() => readAnswers(`${good}\n\n{"key": "x"}\n`)).toThrow(
      'Answers line 3 is not an answer: expected {"key": string, "answer": string}',
    );
    expect(() => readAnswers('{"aaaa0001": 3}')).toThrow(
      'Answers file is a JSON object, but key "aaaa0001" does not map to a string answer',
    );
  });
});

describe('ce bench --export-prompts', () => {
  it('writes queries x runs x drafts prompt lines, contacts no model and writes no results', async () => {
    const dir = await tempDir();
    const file = join(dir, 'prompts', 'p.jsonl');
    const out = join(dir, 'results');
    const { code, stdout, stderr, fetches } = await ce([
      'bench',
      '--draft',
      fixture('basic.md'),
      '--after',
      fixture('after.md'),
      '--pack',
      fixture('tiny-pack.json'),
      '--runs',
      '3',
      '--model',
      'org/Model-9B',
      '--out',
      out,
      '--export-prompts',
      file,
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(fetches).toBe(0);
    expect(stdout).toContain(
      `Wrote 12 prompts (2 drafts x 2 queries x 3 runs, model org/Model-9B) to ${file}`,
    );
    const lines = (await readFile(file, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l) as PromptLine);
    expect(lines).toHaveLength(12);
    expect(lines.map((l) => l.draftId)).toEqual([
      ...Array(6).fill('before'),
      ...Array(6).fill('after'),
    ]);
    expect(new Set(lines.map((l) => l.key)).size).toBe(12);
    for (const l of lines) {
      expect(l.model).toBe('org/Model-9B');
      expect(l.packId).toBe('tiny-espresso');
      expect(l.key).toBe(recordingKey(l.prompt, l));
    }
    await expect(readdir(dir)).resolves.toEqual(['prompts']);
  });

  it('refuses --export-prompts together with --answers', async () => {
    const dir = await tempDir();
    const { code, stderr } = await ce([
      'bench',
      '--draft',
      fixture('basic.md'),
      '--pack',
      fixture('tiny-pack.json'),
      '--export-prompts',
      join(dir, 'p.jsonl'),
      '--answers',
      join(dir, 'a.jsonl'),
    ]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/--export-prompts.*cannot be used with option '--answers/);
  });
});

describe('ce bench --answers', () => {
  const base = (out: string) => [
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
    '--model',
    'org/Model-9B',
    '--out',
    out,
  ];

  it('export, answer, replay: the reports equal a RecordedAdapter run on the same answers', async () => {
    const dir = await tempDir();
    const promptsFile = join(dir, 'p.jsonl');
    const answersFile = join(dir, 'a.jsonl');
    const out = join(dir, 'results');
    expect((await ce([...base(out), '--export-prompts', promptsFile])).code).toBe(0);

    const prompts = (await readFile(promptsFile, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l) as PromptLine);
    const answers: AnswerLine[] = prompts.map((p) => ({
      key: p.key,
      answer: fakeAnswer(p),
      model: p.model,
    }));
    await writeFile(answersFile, `${answers.map((a) => JSON.stringify(a)).join('\n')}\n`);

    const replay = await ce([...base(out), '--answers', answersFile]);
    expect(replay.stderr).toBe('');
    expect(replay.code).toBe(0);
    expect(replay.fetches).toBe(0);
    expect(replay.stdout).toMatch(/^After vs before, paired over 2 queries/m);
    // A replay cannot vouch that the answers came from a local model (Ruling R32).
    const printed = replay.stdout.trimEnd().split('\n');
    expect(printed[0]).toBe(REMOTE_CAVEAT);
    expect(printed.at(-1)).toBe(REMOTE_CAVEAT);

    const read = async <T>(name: string) =>
      JSON.parse(await readFile(join(out, name), 'utf8')) as T;
    const pack = validatePack(JSON.parse(await readFile(fixture('tiny-pack.json'), 'utf8')));
    const recorded = new RecordedAdapter(
      Object.fromEntries(answers.map((a) => [a.key, a.answer])),
      'recorded',
      { caveat: REMOTE_CAVEAT },
    );
    const settings = { k: 3, runs: 2, model: 'org/Model-9B' };
    const drafts: BenchDraft[] = [
      {
        id: 'before',
        title: 'Bitter espresso guide',
        markdown: await readFile(fixture('basic.md'), 'utf8'),
      },
      {
        id: 'after',
        title: 'Bitter espresso guide',
        markdown: await readFile(fixture('after.md'), 'utf8'),
      },
    ];
    const expected = [
      await runBench(pack, drafts[0], recorded, settings),
      await runBench(pack, drafts[1], recorded, settings),
    ];
    const before = await read<BenchReport>('before.json');
    const after = await read<BenchReport>('after.json');
    expect(withoutTime(before)).toEqual(withoutTime(expected[0]));
    expect(withoutTime(after)).toEqual(withoutTime(expected[1]));
    expect(before.runs.some((r) => r.draftCited)).toBe(true);
    expect(before.caveat).toBe(REMOTE_CAVEAT);
    expect(await read<Comparison>('comparison.json')).toEqual(
      compareReports(expected[0], expected[1]),
    );
  });

  it('fails naming how many prompts have no answer, before writing any report', async () => {
    const dir = await tempDir();
    const promptsFile = join(dir, 'p.jsonl');
    const answersFile = join(dir, 'a.jsonl');
    const out = join(dir, 'results');
    await ce([...base(out), '--export-prompts', promptsFile]);
    const prompts = (await readFile(promptsFile, 'utf8')).trimEnd().split('\n');
    const kept = prompts.slice(3).map((l) => {
      const p = JSON.parse(l) as PromptLine;
      return JSON.stringify({ key: p.key, answer: fakeAnswer(p) });
    });
    await writeFile(answersFile, `${kept.join('\n')}\n`);

    const { code, stderr, fetches } = await ce([...base(out), '--answers', answersFile]);
    expect(code).toBe(1);
    expect(fetches).toBe(0);
    expect(stderr).toBe(
      `error: 3 of 8 prompts have no answer in ${answersFile}. Answers are keyed by model, seed, temperature, prompt and any context window other than the default: replay with the --model, --runs, --k, --seed, --temperature and --num-ctx used for --export-prompts.\n`,
    );
    await expect(readdir(dir)).resolves.toEqual(['a.jsonl', 'p.jsonl']);
  });

  it('refuses --adapter, --base-url and --send-key with --answers, which asks no server', async () => {
    const dir = await tempDir();
    for (const extra of [
      ['--adapter', 'openai'],
      ['--base-url', 'http://127.0.0.1:8080'],
      ['--send-key'],
    ]) {
      const { code, stderr, fetches } = await ce([
        ...base(join(dir, 'results')),
        '--answers',
        join(dir, 'a.jsonl'),
        ...extra,
      ]);
      expect(code).toBe(1);
      expect(fetches).toBe(0);
      expect(stderr).toMatch(/option '--answers <file>' cannot be used with option/);
    }
  });

  it('a non-default --num-ctx is part of the key, so answers made at another window do not replay', async () => {
    const dir = await tempDir();
    const promptsFile = join(dir, 'p.jsonl');
    const answersFile = join(dir, 'a.jsonl');
    const out = join(dir, 'results');
    expect((await ce([...base(out), '--export-prompts', promptsFile])).code).toBe(0);
    const prompts = (await readFile(promptsFile, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l) as PromptLine);
    await writeFile(
      answersFile,
      prompts.map((p) => `${JSON.stringify({ key: p.key, answer: fakeAnswer(p) })}\n`).join(''),
    );
    const replay = await ce([...base(out), '--answers', answersFile, '--num-ctx', '8192']);
    expect(replay.code).toBe(1);
    expect(replay.stderr).toMatch(/^error: 8 of 8 prompts have no answer/);
  });

  it('reports a bad answers line with its number', async () => {
    const dir = await tempDir();
    const answersFile = join(dir, 'a.jsonl');
    await writeFile(answersFile, '{"key": "aaaa0001", "answer": "ok"}\nnot json\n');
    const { code, stderr } = await ce([...base(join(dir, 'results')), '--answers', answersFile]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/^error: Answers line 2 is not valid JSON/);
  });
});
