import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaAdapter, probeOllama } from '../src/adapters/ollama';
import { AdapterUnavailableError, ModelMissingError } from '../src/index';

const OPTS = { model: 'qwen2.5:3b', seed: 7, temperature: 0.5 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

interface Call {
  url: string;
  body: Record<string, unknown> | undefined;
}

/** A fetch stand-in that records each call and answers with `respond`. */
function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return respond(url);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** A fetch that never answers; only the request's abort signal ends it. */
const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  })) as typeof fetch;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OllamaAdapter', () => {
  it('in a browser, names OLLAMA_ORIGINS in the fix, since a CORS refusal looks like no server', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('location', { origin: 'https://ce.example.org' });
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = await new OllamaAdapter({ fetch: fetchImpl })
      .generate('Q', OPTS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterUnavailableError);
    expect((err as Error).message).toBe(
      'Ollama is not reachable at http://127.0.0.1:11434, or it refused this page. Start it with this site allowed: OLLAMA_ORIGINS=https://ce.example.org ollama serve',
    );
  });

  it('gives up on a generation after its timeout with a fix line', async () => {
    const adapter = new OllamaAdapter({ fetch: hanging, timeoutMs: 20 });
    const err = await adapter.generate('Q', OPTS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterUnavailableError);
    expect((err as Error).message).toBe(
      'Ollama at http://127.0.0.1:11434 did not finish within 1 s. Check that the model loads: ollama run qwen2.5:3b',
    );
  });

  it('maps a network failure to AdapterUnavailableError', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const adapter = new OllamaAdapter({ fetch: fetchImpl });
    const err = await adapter.generate('Q', OPTS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterUnavailableError);
    expect((err as Error).message).toBe(
      'Ollama is not reachable at http://127.0.0.1:11434. Start Ollama: ollama serve',
    );
  });

  it('says the server stopped answering when the request times out (model failed to load)', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('Headers Timeout Error'), {
          code: 'UND_ERR_HEADERS_TIMEOUT',
        }),
      });
    });
    const adapter = new OllamaAdapter({ fetch: fetchImpl });
    const err = await adapter.generate('Q', OPTS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterUnavailableError);
    expect((err as Error).message).toBe(
      'Ollama at http://127.0.0.1:11434 took the request but sent no answer before the timeout. Check that the model loads: ollama run qwen2.5:3b',
    );
  });

  it('maps a 404 "model not found" to ModelMissingError naming the model', async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: "model 'x' not found" }, 404));
    const adapter = new OllamaAdapter({ fetch: fetchImpl });
    const err = await adapter.generate('Q', { ...OPTS, model: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelMissingError);
    expect((err as Error).message).toContain('ollama pull x');
  });

  it('passes other server errors through unchanged', async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: 'out of memory' }, 500));
    const adapter = new OllamaAdapter({ fetch: fetchImpl });
    const err = await adapter.generate('Q', OPTS).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ModelMissingError);
    expect(err).not.toBeInstanceOf(AdapterUnavailableError);
    expect((err as Error).message).toBe('out of memory');
  });

  it('returns the message content and sends seed and temperature in options', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({
        model: 'qwen2.5:3b',
        message: { role: 'assistant', content: 'Answer [1].' },
        done: true,
      }),
    );
    const adapter = new OllamaAdapter({ fetch: fetchImpl });
    expect(adapter.name).toBe('ollama');
    await expect(adapter.generate('the prompt', OPTS)).resolves.toBe('Answer [1].');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:11434/api/chat');
    expect(calls[0].body).toMatchObject({
      model: 'qwen2.5:3b',
      stream: false,
      messages: [{ role: 'user', content: 'the prompt' }],
      options: { seed: 7, temperature: 0.5 },
    });
  });

  it('sends numCtx as options.num_ctx', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ message: { role: 'assistant', content: 'ok' }, done: true }),
    );
    await new OllamaAdapter({ fetch: fetchImpl }).generate('Q', { ...OPTS, numCtx: 16384 });
    expect(calls[0].body?.options).toEqual({ seed: 7, temperature: 0.5, num_ctx: 16384 });
  });

  it('leaves num_ctx out when numCtx is not given', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ message: { role: 'assistant', content: 'ok' }, done: true }),
    );
    await new OllamaAdapter({ fetch: fetchImpl }).generate('Q', OPTS);
    expect(calls[0].body?.options).toEqual({ seed: 7, temperature: 0.5 });
  });

  it('talks to the host it is given', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ message: { role: 'assistant', content: 'ok' }, done: true }),
    );
    await new OllamaAdapter({ host: 'http://localhost:9999', fetch: fetchImpl }).generate(
      'Q',
      OPTS,
    );
    expect(calls[0].url).toBe('http://localhost:9999/api/chat');
  });
});

describe('probeOllama', () => {
  it('reports unreachable without throwing when fetch fails', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(probeOllama(undefined, fetchImpl)).resolves.toEqual({
      reachable: false,
      models: [],
    });
  });

  it('reads a host that never answers as unreachable once the timeout passes', async () => {
    const started = Date.now();
    await expect(probeOllama(undefined, hanging, 20)).resolves.toEqual({
      reachable: false,
      models: [],
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('lists the installed model names', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ models: [{ name: 'qwen2.5:3b' }, { name: 'llama3.2:3b' }] }),
    );
    await expect(probeOllama('http://localhost:11434', fetchImpl)).resolves.toEqual({
      reachable: true,
      models: ['qwen2.5:3b', 'llama3.2:3b'],
    });
    expect(calls[0].url).toBe('http://localhost:11434/api/tags');
  });
});
