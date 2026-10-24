import { describe, expect, it } from 'vitest';
import { LIVE_CAVEAT, type LiveEngine, type LiveSource } from '../src/index';
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_ENDPOINT,
  GEMINI_MAX_RETRIES,
  geminiGroundedEngine,
} from '../src/node/gemini';
import { LiveRunIncompleteError, runLive } from '../src/node/live';

const src = (uri: string, domain: string, title?: string): LiveSource => ({ uri, domain, title });

/** An engine that answers each question with the sources `byQuestion` gives it, seed-aware. */
function fakeEngine(byQuestion: (q: string, seed: number) => LiveSource[]): LiveEngine & {
  calls: { question: string; seed: number }[];
} {
  const calls: { question: string; seed: number }[] = [];
  return {
    name: 'fake',
    model: 'fake-1',
    calls,
    async ask(question, seed) {
      calls.push({ question, seed });
      return { answer: `Answer to ${question}`, sources: byQuestion(question, seed) };
    },
  };
}

describe('runLive', () => {
  it('asks each question once per run with seeds 1..runs and builds the report', async () => {
    const engine = fakeEngine(() => []);
    const report = await runLive(
      ['q a', 'q b'],
      'https://example.com/page',
      engine,
      3,
      () => new Date('2026-10-23T12:00:00.000Z'),
    );
    expect(engine.calls).toEqual([
      { question: 'q a', seed: 1 },
      { question: 'q a', seed: 2 },
      { question: 'q a', seed: 3 },
      { question: 'q b', seed: 1 },
      { question: 'q b', seed: 2 },
      { question: 'q b', seed: 3 },
    ]);
    expect(report).toMatchObject({
      schemaVersion: 1,
      engine: 'fake',
      model: 'fake-1',
      targetUrl: 'https://example.com/page',
      createdAt: '2026-10-23T12:00:00.000Z',
      caveat: 'Measured through an API, which can differ from what people see in the consumer app.',
    });
    expect(report.caveat).toBe(LIVE_CAVEAT);
    expect(report.runs.map((r) => [r.question, r.run])).toEqual([
      ['q a', 1],
      ['q a', 2],
      ['q a', 3],
      ['q b', 1],
      ['q b', 2],
      ['q b', 3],
    ]);
    expect(report.runs[0].answer).toBe('Answer to q a');
    expect(report.summary.nQuestions).toBe(2);
    expect(report.summary.domainCited).toMatchObject({ k: 0, n: 6, p: 0 });
  });

  it('matches the domain and the URL ignoring www, scheme, a trailing slash and the fragment', async () => {
    const engine = fakeEngine((q) => {
      if (q === 'url')
        return [src('http://www.Example.com/guide/espresso/#top', 'www.example.com')];
      if (q === 'domain') return [src('https://example.com/other', 'example.com')];
      if (q === 'sub') return [src('https://blog.example.com/guide/espresso', 'blog.example.com')];
      return [src('https://other.org/guide/espresso', 'other.org')];
    });
    const report = await runLive(
      ['url', 'domain', 'sub', 'none'],
      'https://example.com/guide/espresso',
      engine,
      1,
    );
    const flags = Object.fromEntries(
      report.runs.map((r) => [r.question, [r.draftDomainCited, r.draftUrlCited]]),
    );
    expect(flags).toEqual({
      url: [true, true],
      domain: [true, false],
      sub: [false, false],
      none: [false, false],
    });
    expect(report.summary.domainCited).toMatchObject({ k: 2, n: 4, p: 0.5 });
    expect(report.summary.urlCited).toMatchObject({ k: 1, n: 4, p: 0.25 });
  });

  it('matches a target given with www and a trailing slash against a bare source', async () => {
    const engine = fakeEngine(() => [src('https://example.com/guide', 'example.com')]);
    const report = await runLive(['q'], 'https://www.example.com/guide/', engine, 1);
    expect(report.runs[0].draftDomainCited).toBe(true);
    expect(report.runs[0].draftUrlCited).toBe(true);
  });

  it('matches the domain from the source domain when its URI is a redirect', async () => {
    const engine = fakeEngine(() => [
      src(
        'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
        'example.com',
        'example.com',
      ),
    ]);
    const report = await runLive(['q'], 'https://example.com/guide', engine, 1);
    expect(report.runs[0].draftDomainCited).toBe(true);
    expect(report.runs[0].draftUrlCited).toBe(false);
  });

  it('rejects a target that is not an absolute http(s) URL, and zero runs', async () => {
    const engine = fakeEngine(() => []);
    await expect(runLive(['q'], 'example.com/page', engine, 1)).rejects.toThrow(
      'The target URL must be an absolute http(s) URL, for example https://example.com/page',
    );
    await expect(runLive(['q'], 'https://example.com', engine, 0)).rejects.toThrow(
      'Runs must be 1 or more',
    );
    await expect(runLive([], 'https://example.com', engine, 1)).rejects.toThrow(
      'Give at least one question',
    );
  });

  it('rejects a target whose host has no domain, which would match every unknown source', async () => {
    const engine = fakeEngine(() => [src('https://vertexaisearch.cloud.google.com/x', '')]);
    for (const url of ['http://localhost:3000/page', 'http://intranet/page']) {
      await expect(runLive(['q'], url, engine, 1)).rejects.toThrow(
        /^The target URL's host has no domain \((localhost|intranet)\); give the page's public address/,
      );
    }
    expect(engine.calls).toHaveLength(0);
    // A port is ignored for the domain match.
    const report = await runLive(
      ['q'],
      'https://example.com:8443/page',
      fakeEngine(() => [src('https://example.com/other', 'example.com')]),
      1,
    );
    expect(report.runs[0].draftDomainCited).toBe(true);
  });
});

describe('runLive on an engine error', () => {
  it('keeps the finished calls, marked incomplete, and carries the cause', async () => {
    const quota = new Error('Gemini API returned HTTP 429: Resource exhausted');
    let n = 0;
    const engine: LiveEngine = {
      name: 'fake',
      async ask(question) {
        n++;
        if (n === 4) throw quota;
        return {
          answer: question,
          sources: n === 1 ? [src('https://example.com/page', 'example.com')] : [],
        };
      },
    };
    const err = await runLive(['q a', 'q b'], 'https://example.com/page', engine, 3).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LiveRunIncompleteError);
    const { report, cause, message } = err as LiveRunIncompleteError;
    expect(cause).toBe(quota);
    expect(message).toBe(quota.message);
    expect(report.runs.map((r) => [r.question, r.run])).toEqual([
      ['q a', 1],
      ['q a', 2],
      ['q a', 3],
    ]);
    expect(report.incomplete).toEqual({ planned: 6, error: quota.message });
    expect(report.summary).toMatchObject({
      nQuestions: 1,
      domainCited: { k: 1, n: 3 },
      urlCited: { k: 1, n: 3 },
    });
    expect(report.caveat).toBe(LIVE_CAVEAT);
  });

  it('reports no runs when the first call fails, and a complete run has no incomplete field', async () => {
    const failing: LiveEngine = {
      name: 'fake',
      async ask() {
        throw new Error('down');
      },
    };
    const err = (await runLive(['q'], 'https://example.com', failing, 2).catch(
      (e: unknown) => e,
    )) as LiveRunIncompleteError;
    expect(err.report.runs).toEqual([]);
    expect(err.report.summary.nQuestions).toBe(0);
    expect(err.report.incomplete).toEqual({ planned: 2, error: 'down' });

    const ok = await runLive(
      ['q'],
      'https://example.com',
      fakeEngine(() => []),
      1,
    );
    expect(ok).not.toHaveProperty('incomplete');
  });
});

// ---------- Gemini ----------

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/';

/** A generateContent response in the documented shape (ai.google.dev, Grounding with Google Search). */
function groundedResponse() {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            { text: 'Espresso turns bitter when it over-extracts.' },
            { text: ' Grind coarser.' },
          ],
        },
        finishReason: 'STOP',
        groundingMetadata: {
          webSearchQueries: ['why is espresso bitter'],
          searchEntryPoint: { renderedContent: '<div></div>' },
          groundingChunks: [
            { web: { uri: `${REDIRECT}AAA`, title: 'example.com' } },
            { web: { uri: `${REDIRECT}BBB`, title: 'www.coffee.org' } },
            { web: { uri: 'https://direct.net/page', title: 'Direct page' } },
          ],
          groundingSupports: [
            {
              segment: {
                startIndex: 0,
                endIndex: 44,
                text: 'Espresso turns bitter when it over-extracts.',
              },
              groundingChunkIndices: [0, 1],
            },
          ],
        },
      },
    ],
  };
}

interface Call {
  url: string;
  method: string | undefined;
  redirect: RequestRedirect | undefined;
  headers: Headers;
  body: Record<string, unknown> | undefined;
}

/** Answers generateContent with `answer` and the redirect service with a 302 per `locations`. */
function geminiFetch(answer: () => Response, locations: Record<string, string | null> = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method,
      redirect: init?.redirect,
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.startsWith(GEMINI_ENDPOINT)) return answer();
    if (url.startsWith(REDIRECT)) {
      const location = locations[url];
      if (location === undefined) throw new TypeError('fetch failed');
      if (location === null) return new Response('gone', { status: 404 });
      return new Response(null, { status: 302, headers: { location } });
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** Replies in order, then repeats the last one. */
function sequence(...replies: (() => Response)[]): () => Response {
  let i = 0;
  return () => replies[Math.min(i++, replies.length - 1)]();
}
const apiError = (status: number, init: { headers?: HeadersInit; details?: unknown[] } = {}) =>
  Response.json(
    { error: { code: status, message: 'Resource exhausted', details: init.details } },
    { status, headers: init.headers },
  );

describe('geminiGroundedEngine retries', () => {
  const setup = (answer: () => Response) => {
    const { fetchImpl, calls } = geminiFetch(answer);
    const waits: number[] = [];
    const engine = geminiGroundedEngine({
      apiKey: 'AIza-retry-key',
      fetchImpl,
      resolveRedirects: false,
      sleep: async (ms) => {
        waits.push(ms);
      },
      random: () => 0,
    });
    const api = () => calls.filter((c) => c.url.startsWith(GEMINI_ENDPOINT));
    return { engine, waits, api };
  };

  it('retries 429 and 5xx with exponential backoff, then answers', async () => {
    const { engine, waits, api } = setup(
      sequence(
        () => apiError(429),
        () => apiError(503),
        () => apiError(500),
        () => Response.json(groundedResponse()),
      ),
    );
    const result = await engine.ask('q', 2);
    expect(result.answer).toContain('Espresso');
    expect(waits).toEqual([1000, 2000, 4000]);
    // Every try sends the same request, seed included.
    expect(api().map((c) => c.body?.generationConfig)).toEqual([
      { seed: 2 },
      { seed: 2 },
      { seed: 2 },
      { seed: 2 },
    ]);
  });

  it('adds up to 25% jitter to the backoff', async () => {
    const { fetchImpl } = geminiFetch(
      sequence(
        () => apiError(429),
        () => Response.json(groundedResponse()),
      ),
    );
    const waits: number[] = [];
    await geminiGroundedEngine({
      apiKey: 'k',
      fetchImpl,
      resolveRedirects: false,
      sleep: async (ms) => {
        waits.push(ms);
      },
      random: () => 0.5,
    }).ask('q', 1);
    expect(waits).toEqual([1125]);
  });

  it('honors Retry-After in seconds and a RetryInfo retryDelay', async () => {
    const a = setup(
      sequence(
        () => apiError(429, { headers: { 'retry-after': '7' } }),
        () =>
          apiError(429, {
            details: [
              { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [] },
              { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' },
            ],
          }),
        () => Response.json(groundedResponse()),
      ),
    );
    await a.engine.ask('q', 1);
    expect(a.waits).toEqual([7000, 17000]);
  });

  it('gives up without waiting when the server asks for more than a minute', async () => {
    const { engine, waits, api } = setup(
      sequence(() => apiError(429, { headers: { 'retry-after': '3600' } })),
    );
    await expect(engine.ask('q', 1)).rejects.toThrow(
      'Gemini API returned HTTP 429: Resource exhausted (it asks to wait 3600 s; try again later)',
    );
    expect(waits).toEqual([]);
    expect(api()).toHaveLength(1);

    const date = setup(
      sequence(() =>
        apiError(429, {
          headers: { 'retry-after': new Date(Date.now() + 7_200_000).toUTCString() },
        }),
      ),
    );
    await expect(date.engine.ask('q', 1)).rejects.toThrow(/asks to wait \d+ s/);
    expect(date.waits).toEqual([]);
  });

  it(`stops after ${GEMINI_MAX_RETRIES} retries and says how many tries, without the key`, async () => {
    const { engine, waits, api } = setup(sequence(() => apiError(429)));
    const err = (await engine.ask('q', 1).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe(
      `Gemini API returned HTTP 429: Resource exhausted (after ${GEMINI_MAX_RETRIES + 1} tries)`,
    );
    expect(err.message).not.toContain('AIza-retry-key');
    expect(api()).toHaveLength(GEMINI_MAX_RETRIES + 1);
    expect(waits).toEqual([1000, 2000, 4000, 8000]);
  });

  it('does not retry a client error such as HTTP 400', async () => {
    const { engine, waits, api } = setup(sequence(() => apiError(400)));
    await expect(engine.ask('q', 1)).rejects.toThrow(
      'Gemini API returned HTTP 400: Resource exhausted',
    );
    expect(api()).toHaveLength(1);
    expect(waits).toEqual([]);
  });
});

describe('geminiGroundedEngine', () => {
  it('POSTs generateContent with the google_search tool, the seed, and the key in a header', async () => {
    const { fetchImpl, calls } = geminiFetch(() => Response.json(groundedResponse()));
    const engine = geminiGroundedEngine({ apiKey: 'AIza-test-key', fetchImpl });
    expect(engine.name).toBe('gemini');
    expect(engine.model).toBe(DEFAULT_GEMINI_MODEL);
    await engine.ask('why is espresso bitter', 3);
    const call = calls[0];
    expect(call.url).toBe(`${GEMINI_ENDPOINT}/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(call.method).toBe('POST');
    expect(call.headers.get('x-goog-api-key')).toBe('AIza-test-key');
    expect(call.url).not.toContain('AIza-test-key');
    expect(call.body).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'why is espresso bitter' }] }],
      tools: [{ google_search: {} }],
      generationConfig: { seed: 3 },
    });
  });

  it('uses the model it is given', async () => {
    const { fetchImpl, calls } = geminiFetch(() => Response.json(groundedResponse()));
    const engine = geminiGroundedEngine({ apiKey: 'k', model: 'gemini-x', fetchImpl });
    expect(engine.model).toBe('gemini-x');
    await engine.ask('q', 1);
    expect(calls[0].url).toBe(`${GEMINI_ENDPOINT}/gemini-x:generateContent`);
  });

  it("accepts the API's resource name models/<name> without doubling the prefix", async () => {
    const { fetchImpl, calls } = geminiFetch(() => Response.json(groundedResponse()));
    const engine = geminiGroundedEngine({ apiKey: 'k', model: 'models/gemini-x', fetchImpl });
    expect(engine.model).toBe('gemini-x');
    await engine.ask('q', 1);
    expect(calls[0].url).toBe(`${GEMINI_ENDPOINT}/gemini-x:generateContent`);
  });

  it('gives up on a stalled redirect after the timeout and keeps the title as domain', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(GEMINI_ENDPOINT)) return Response.json(groundedResponse());
      signals.push(init?.signal ?? undefined);
      // A host that never answers: only the abort signal ends the request.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }) as typeof fetch;
    const started = Date.now();
    const result = await geminiGroundedEngine({
      apiKey: 'k',
      fetchImpl,
      redirectTimeoutMs: 30,
    }).ask('q', 1);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((sig) => sig instanceof AbortSignal)).toBe(true);
    expect(result.sources[0]).toEqual({
      uri: `${REDIRECT}AAA`,
      title: 'example.com',
      domain: 'example.com',
    });
  });

  it('joins the answer parts and takes sources from groundingChunks, resolving redirects', async () => {
    const { fetchImpl, calls } = geminiFetch(() => Response.json(groundedResponse()), {
      [`${REDIRECT}AAA`]: 'https://www.example.com/guide/',
      [`${REDIRECT}BBB`]: null, // the redirect service answers 404: keep the URI as given
    });
    const result = await geminiGroundedEngine({ apiKey: 'k', fetchImpl }).ask('q', 1);
    expect(result.answer).toBe('Espresso turns bitter when it over-extracts. Grind coarser.');
    expect(result.sources).toEqual([
      { uri: 'https://www.example.com/guide/', title: 'example.com', domain: 'example.com' },
      { uri: `${REDIRECT}BBB`, title: 'www.coffee.org', domain: 'coffee.org' },
      { uri: 'https://direct.net/page', title: 'Direct page', domain: 'direct.net' },
    ]);
    const redirects = calls.filter((c) => c.url.startsWith(REDIRECT));
    expect(redirects.map((c) => [c.method, c.redirect])).toEqual([
      ['GET', 'manual'],
      ['GET', 'manual'],
    ]);
    // The key goes to the Gemini API only, never to the redirect service.
    for (const c of redirects) expect(c.headers.has('x-goog-api-key')).toBe(false);
  });

  it('keeps the redirect URI and the title as domain when resolving fails or is turned off', async () => {
    const failing = geminiFetch(() => Response.json(groundedResponse()));
    const a = await geminiGroundedEngine({ apiKey: 'k', fetchImpl: failing.fetchImpl }).ask('q', 1);
    expect(a.sources[0]).toEqual({
      uri: `${REDIRECT}AAA`,
      title: 'example.com',
      domain: 'example.com',
    });

    const off = geminiFetch(() => Response.json(groundedResponse()));
    const b = await geminiGroundedEngine({
      apiKey: 'k',
      fetchImpl: off.fetchImpl,
      resolveRedirects: false,
    }).ask('q', 1);
    expect(b.sources[0].uri).toBe(`${REDIRECT}AAA`);
    expect(off.calls.filter((c) => c.url.startsWith(REDIRECT))).toHaveLength(0);
  });

  it('returns no sources when the model answered without searching', async () => {
    const { fetchImpl } = geminiFetch(() =>
      Response.json({
        candidates: [{ content: { parts: [{ text: 'Hello.' }] }, finishReason: 'STOP' }],
      }),
    );
    await expect(geminiGroundedEngine({ apiKey: 'k', fetchImpl }).ask('q', 1)).resolves.toEqual({
      answer: 'Hello.',
      sources: [],
    });
  });

  it('reports API errors by status and message without the key', async () => {
    const { fetchImpl } = geminiFetch(() =>
      Response.json(
        {
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
          },
        },
        { status: 400 },
      ),
    );
    const err = await geminiGroundedEngine({ apiKey: 'AIza-test-key', fetchImpl })
      .ask('q', 1)
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe(
      'Gemini API returned HTTP 400: API key not valid. Please pass a valid API key.',
    );
    expect((err as Error).message).not.toContain('AIza-test-key');
  });

  it('says why when the prompt was blocked', async () => {
    const { fetchImpl } = geminiFetch(() =>
      Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
    );
    await expect(geminiGroundedEngine({ apiKey: 'k', fetchImpl }).ask('q', 1)).rejects.toThrow(
      'Gemini returned no answer (prompt blocked: SAFETY)',
    );
  });
});
