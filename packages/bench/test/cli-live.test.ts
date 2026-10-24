// CLI tests for the engine adapters (`ce bench --adapter`) and `ce live`. Fake fetch only: no key
// exists and no test calls a real API.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  type BenchReport,
  CAVEAT,
  LIVE_CAVEAT,
  type LiveReport,
  REMOTE_CAVEAT,
} from '../src/index';
import { runCli } from '../src/node/cli';
import { GEMINI_ENDPOINT } from '../src/node/gemini';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name: string) => join(PKG, 'test', 'fixtures', name);

const dirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'ce-live-'));
  dirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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

/** Every file under `dir`, concatenated, to check that no key was written anywhere. */
async function allText(dir: string): Promise<string> {
  const names = await readdir(dir, { recursive: true, withFileTypes: true });
  const texts = await Promise.all(
    names.filter((d) => d.isFile()).map((d) => readFile(join(d.parentPath, d.name), 'utf8')),
  );
  return texts.join('\n');
}

/** An OpenAI-compatible chat endpoint that always cites [1] and [2]. */
function openaiFake() {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Bitterness comes from over-extraction [1]. Grind coarser [2].',
          },
        },
      ],
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const benchArgs = async () => [
  'bench',
  '--draft',
  fixture('basic.md'),
  '--pack',
  fixture('tiny-pack.json'),
  '--runs',
  '1',
  '--out',
  await tempDir(),
];

describe('ce bench --adapter', () => {
  it('runs on an OpenAI-compatible server at --base-url without a key when none is set', async () => {
    vi.stubEnv('OPENAI_API_KEY', undefined);
    const { fetchImpl, calls } = openaiFake();
    const args = await benchArgs();
    const { code, stdout } = await ce(
      [...args, '--adapter', 'openai', '--base-url', 'http://localhost:8000', '--model', 'm1'],
      fetchImpl,
    );
    expect(code).toBe(0);
    expect(stdout.startsWith(CAVEAT)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.url === 'http://localhost:8000/v1/chat/completions')).toBe(true);
    expect(calls[0].body.model).toBe('m1');
    expect(calls[0].headers.has('authorization')).toBe(false);
    const report = JSON.parse(await readFile(join(args.at(-1) as string, 'before.json'), 'utf8'));
    expect(report.adapter).toBe('openai-compatible');
  });

  it('sends OPENAI_API_KEY as a bearer token when set, and never writes or prints it', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-secret-cli');
    const { fetchImpl, calls } = openaiFake();
    const args = await benchArgs();
    const out = args.at(-1) as string;
    const { code, stdout, stderr } = await ce(
      [...args, '--adapter', 'openai', '--base-url', 'https://api.example.com/v1', '--record'],
      fetchImpl,
    );
    expect(code).toBe(0);
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions');
    expect(calls[0].headers.get('authorization')).toBe('Bearer sk-secret-cli');
    expect(`${stdout}${stderr}${await allText(out)}`).not.toContain('sk-secret-cli');
  });

  it("uses OpenAI's API when --adapter openai has no --base-url", async () => {
    vi.stubEnv('OPENAI_API_KEY', undefined);
    const { fetchImpl, calls } = openaiFake();
    const { code } = await ce([...(await benchArgs()), '--adapter', 'openai'], fetchImpl);
    expect(code).toBe(0);
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('defaults to Ollama, and passes --base-url to it as the host', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ message: { role: 'assistant', content: 'Yes [1].' }, done: true });
    }) as typeof fetch;
    const def = await ce(await benchArgs(), fetchImpl);
    expect(def.code).toBe(0);
    expect(urls[0]).toBe('http://127.0.0.1:11434/api/chat');
    urls.length = 0;
    const custom = await ce(
      [...(await benchArgs()), '--adapter', 'ollama', '--base-url', 'http://localhost:9999'],
      fetchImpl,
    );
    expect(custom.code).toBe(0);
    expect(urls[0]).toBe('http://localhost:9999/api/chat');
  });

  it("names the model honestly: OpenAI's hosted API gets the caveat without 'local', and numCtx is null", async () => {
    vi.stubEnv('OPENAI_API_KEY', undefined);
    const { fetchImpl, calls } = openaiFake();
    const args = await benchArgs();
    const { code, stdout } = await ce([...args, '--adapter', 'openai'], fetchImpl);
    expect(code).toBe(0);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(REMOTE_CAVEAT);
    expect(lines.at(-1)).toBe(REMOTE_CAVEAT);
    expect(stdout).not.toContain(CAVEAT);
    // The Chat Completions API has no context-window field: nothing is sent, nothing is claimed.
    expect(calls.every((c) => !('num_ctx' in c.body) && !('numCtx' in c.body))).toBe(true);
    expect(stdout).toMatch(/context window set by the server/);
    expect(stdout).not.toMatch(/context 16384 tokens/);
    const report = JSON.parse(
      await readFile(join(args.at(-1) as string, 'before.json'), 'utf8'),
    ) as BenchReport;
    expect(report.caveat).toBe(REMOTE_CAVEAT);
    expect(report.settings.numCtx).toBeNull();
  });

  it('keeps the local-model caveat for an OpenAI-compatible server on localhost', async () => {
    vi.stubEnv('OPENAI_API_KEY', undefined);
    for (const baseUrl of [
      'http://localhost:8000',
      'http://127.0.0.1:8080/v1',
      'http://[::1]:8000',
    ]) {
      const { fetchImpl } = openaiFake();
      const args = await benchArgs();
      const { code, stdout } = await ce(
        [...args, '--adapter', 'openai', '--base-url', baseUrl],
        fetchImpl,
      );
      expect(code).toBe(0);
      expect(stdout.trimEnd().split('\n').at(-1)).toBe(CAVEAT);
      const report = JSON.parse(
        await readFile(join(args.at(-1) as string, 'before.json'), 'utf8'),
      ) as BenchReport;
      expect(report.caveat).toBe(CAVEAT);
    }
  });

  it('does not send OPENAI_API_KEY to a plain-http server unless --send-key is given (R33)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-secret-cli');
    const plain = openaiFake();
    const off = await ce(
      [...(await benchArgs()), '--adapter', 'openai', '--base-url', 'http://192.168.1.20:8000'],
      plain.fetchImpl,
    );
    expect(off.code).toBe(0);
    expect(plain.calls[0].headers.has('authorization')).toBe(false);
    expect(off.stderr).toBe(
      'OPENAI_API_KEY is set but not sent: http://192.168.1.20:8000 is not https. Pass --send-key to send it anyway.\n',
    );
    expect(`${off.stdout}${off.stderr}`).not.toContain('sk-secret-cli');
    // A LAN host is not this machine, so the caveat does not say "local".
    expect(off.stdout.startsWith(REMOTE_CAVEAT)).toBe(true);

    const opted = openaiFake();
    const on = await ce(
      [
        ...(await benchArgs()),
        '--adapter',
        'openai',
        '--base-url',
        'http://192.168.1.20:8000',
        '--send-key',
      ],
      opted.fetchImpl,
    );
    expect(on.code).toBe(0);
    expect(on.stderr).toBe('');
    expect(opted.calls[0].headers.get('authorization')).toBe('Bearer sk-secret-cli');
  });

  it('refuses --send-key without --adapter openai', async () => {
    const { code, stderr } = await ce([...(await benchArgs()), '--send-key']);
    expect(code).toBe(1);
    expect(stderr).toBe('error: --send-key works with --adapter openai.\n');
  });

  it('prints the caveat last also when a run fails part way', async () => {
    let n = 0;
    const flaky = (async () => {
      n++;
      if (n > 1) return Response.json({ error: { message: 'boom' } }, { status: 500 });
      return Response.json({
        choices: [{ message: { role: 'assistant', content: 'Yes [1].' } }],
      });
    }) as typeof fetch;
    vi.stubEnv('OPENAI_API_KEY', undefined);
    const { code, stdout, stderr } = await ce(
      [...(await benchArgs()), '--adapter', 'openai', '--base-url', 'http://localhost:8000'],
      flaky,
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/HTTP 500: boom/);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(CAVEAT);
    expect(lines.at(-1)).toBe(CAVEAT);
  });

  it('rejects an unknown adapter', async () => {
    const { code, stderr } = await ce([...(await benchArgs()), '--adapter', 'bard']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/bard/);
  });
});

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/';

/** generateContent answers citing the target via a redirect for "cited" questions only. */
function geminiFake() {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.startsWith(REDIRECT)) {
      const target = url.endsWith('TARGET')
        ? 'https://www.example.com/espresso/'
        : 'https://other.org/x';
      return new Response(null, { status: 302, headers: { location: target } });
    }
    const body = JSON.parse(String(init?.body));
    const question: string = body.contents[0].parts[0].text;
    const chunk = question.includes('bitter') ? 'TARGET' : 'OTHER';
    return Response.json({
      candidates: [
        {
          content: { parts: [{ text: `About ${question}.` }] },
          finishReason: 'STOP',
          groundingMetadata: {
            groundingChunks: [
              {
                web: {
                  uri: `${REDIRECT}${chunk}`,
                  title: chunk === 'TARGET' ? 'example.com' : 'other.org',
                },
              },
            ],
          },
        },
      ],
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function questionsFile() {
  const dir = await tempDir();
  const path = join(dir, 'q.txt');
  await writeFile(
    path,
    '# my questions\nwhy is espresso bitter\n\nhow long should a shot take\nwhy is espresso bitter\n',
  );
  return path;
}

describe('ce live', () => {
  it('exits 2 with one line when GEMINI_API_KEY is not set, before any request', async () => {
    vi.stubEnv('GEMINI_API_KEY', undefined);
    const { fetchImpl, calls } = geminiFake();
    const { code, stdout, stderr } = await ce(
      [
        'live',
        '--engine',
        'gemini',
        '--questions',
        await questionsFile(),
        '--url',
        'https://example.com/espresso',
      ],
      fetchImpl,
    );
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe(
      'GEMINI_API_KEY is not set. Create a key in Google AI Studio, then: export GEMINI_API_KEY=<your key>\n',
    );
    expect(calls).toHaveLength(0);
  });

  it('treats an empty GEMINI_API_KEY as missing', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const { code, stderr } = await ce([
      'live',
      '--engine',
      'gemini',
      '--questions',
      await questionsFile(),
      '--url',
      'https://example.com/espresso',
    ]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^GEMINI_API_KEY is not set\./);
  });

  it('writes a LiveReport, prints the summary and the API caveat, and never the key', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-secret-cli');
    const out = await tempDir();
    const { fetchImpl, calls } = geminiFake();
    const { code, stdout, stderr } = await ce(
      [
        'live',
        '--engine',
        'gemini',
        '--questions',
        await questionsFile(),
        '--url',
        'https://example.com/espresso',
        '--runs',
        '2',
        '--model',
        'gemini-test',
        '--out',
        out,
      ],
      fetchImpl,
    );
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const api = calls.filter((c) => c.url.startsWith(GEMINI_ENDPOINT));
    expect(api).toHaveLength(4);
    expect(api[0].url).toBe(`${GEMINI_ENDPOINT}/gemini-test:generateContent`);
    expect(api[0].headers.get('x-goog-api-key')).toBe('AIza-secret-cli');

    const report: LiveReport = JSON.parse(await readFile(join(out, 'live-gemini.json'), 'utf8'));
    expect(report).toMatchObject({
      schemaVersion: 1,
      engine: 'gemini',
      model: 'gemini-test',
      targetUrl: 'https://example.com/espresso',
      caveat: LIVE_CAVEAT,
      summary: { nQuestions: 2, domainCited: { k: 2, n: 4 }, urlCited: { k: 2, n: 4 } },
    });
    expect(report.runs[0].sources[0]).toEqual({
      uri: 'https://www.example.com/espresso/',
      title: 'example.com',
      domain: 'example.com',
    });

    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(LIVE_CAVEAT);
    expect(lines.at(-1)).toBe(LIVE_CAVEAT);
    expect(stdout).toContain('gemini (gemini-test), 2 questions x 2 runs');
    expect(stdout).toMatch(/Domain cited\s+50%\s+\(2 of 4/);
    expect(stdout).toMatch(/why is espresso bitter\s+domain 2 of 2, URL 2 of 2/);
    expect(stdout).toContain(join(out, 'live-gemini.json'));
    expect(`${stdout}${stderr}${await allText(out)}`).not.toContain('AIza-secret-cli');
  });

  it('saves the finished calls to live-gemini.partial.json when a call fails mid-run', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-secret-partial');
    const out = await tempDir();
    const { fetchImpl: answering } = geminiFake();
    let apiCalls = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(GEMINI_ENDPOINT) && ++apiCalls === 3) {
        // A client error, so the engine does not retry and the test does not wait.
        return Response.json(
          { error: { code: 400, message: 'User location is not supported' } },
          { status: 400 },
        );
      }
      return answering(input, init);
    }) as typeof fetch;
    const { code, stdout, stderr } = await ce(
      [
        'live',
        '--engine',
        'gemini',
        '--questions',
        await questionsFile(),
        '--url',
        'https://example.com/espresso',
        '--runs',
        '2',
        '--out',
        out,
      ],
      fetchImpl,
    );
    expect(code).toBe(1);
    expect(stdout).toBe('');
    const path = join(out, 'live-gemini.partial.json');
    expect(stderr).toBe(
      `Stopped after 2 of 4 calls. Wrote the finished calls to ${path} (marked incomplete).\n` +
        'error: Gemini API returned HTTP 400: User location is not supported\n',
    );
    const report: LiveReport = JSON.parse(await readFile(path, 'utf8'));
    expect(report.incomplete).toEqual({
      planned: 4,
      error: 'Gemini API returned HTTP 400: User location is not supported',
    });
    expect(report.runs.map((r) => [r.question, r.run])).toEqual([
      ['why is espresso bitter', 1],
      ['why is espresso bitter', 2],
    ]);
    expect(report.summary).toMatchObject({ nQuestions: 1, domainCited: { k: 2, n: 2 } });
    // A complete earlier result is never overwritten by a partial one.
    expect(await readdir(out)).toEqual(['live-gemini.partial.json']);
    expect(`${stdout}${stderr}${await allText(out)}`).not.toContain('AIza-secret-partial');
  });

  it('keeps the engine error as the exit reason when the partial file cannot be written', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const dir = await tempDir();
    const out = join(dir, 'not-a-dir');
    await writeFile(out, 'a file where the output folder should go');
    const { fetchImpl: answering } = geminiFake();
    let apiCalls = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(GEMINI_ENDPOINT) && ++apiCalls === 2) {
        return Response.json({ error: { code: 400, message: 'Bad request' } }, { status: 400 });
      }
      return answering(input, init);
    }) as typeof fetch;
    const { code, stderr } = await ce(
      [
        'live',
        '--engine',
        'gemini',
        '--questions',
        await questionsFile(),
        '--url',
        'https://example.com/espresso',
        '--runs',
        '2',
        '--out',
        out,
      ],
      fetchImpl,
    );
    expect(code).toBe(1);
    const lines = stderr.trimEnd().split('\n');
    expect(lines[0]).toMatch(
      /^Stopped after 1 of 4 calls\. Could not save them to .*live-gemini\.partial\.json: /,
    );
    expect(lines.at(-1)).toBe('error: Gemini API returned HTTP 400: Bad request');
  });

  it('writes nothing and exits 2 when the API is unreachable on the first call', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const out = await tempDir();
    const unreachable = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const { code, stderr } = await ce(
      [
        'live',
        '--engine',
        'gemini',
        '--questions',
        await questionsFile(),
        '--url',
        'https://example.com/espresso',
        '--out',
        out,
      ],
      unreachable,
    );
    expect(code).toBe(2);
    expect(stderr).toBe('The Gemini API is not reachable. Check your network connection.\n');
    expect(await readdir(out)).toEqual([]);
  });

  it('exits 1 for a bad URL or an empty questions file', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const { fetchImpl } = geminiFake();
    const badUrl = await ce(
      ['live', '--engine', 'gemini', '--questions', await questionsFile(), '--url', 'example.com'],
      fetchImpl,
    );
    expect(badUrl.code).toBe(1);
    expect(badUrl.stderr).toContain('absolute http(s) URL');

    const dir = await tempDir();
    await writeFile(join(dir, 'empty.txt'), '# nothing\n\n');
    const empty = await ce(
      [
        'live',
        '--engine',
        'gemini',
        '--questions',
        join(dir, 'empty.txt'),
        '--url',
        'https://example.com',
      ],
      fetchImpl,
    );
    expect(empty.code).toBe(1);
    expect(empty.stderr).toContain('Give at least one question');
  });
});
