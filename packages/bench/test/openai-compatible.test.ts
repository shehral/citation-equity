import { describe, expect, it } from 'vitest';
import {
  AdapterUnavailableError,
  CAVEAT,
  ModelMissingError,
  OpenAICompatibleAdapter,
  REMOTE_CAVEAT,
} from '../src/index';

const OPTS = { model: 'llama3.2:3b', seed: 7, temperature: 0.5 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const completion = (content: unknown) =>
  json({ choices: [{ message: { role: 'assistant', content } }] });

interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: Record<string, unknown> | undefined;
}

/** A fetch stand-in that records each call and answers with `respond`. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return respond();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('OpenAICompatibleAdapter', () => {
  it('POSTs model, one user message, seed and temperature to {baseUrl}/v1/chat/completions', async () => {
    const { fetchImpl, calls } = fakeFetch(() => completion('Answer [1].'));
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: 'http://localhost:8000',
      fetch: fetchImpl,
    });
    expect(adapter.name).toBe('openai-compatible');
    expect(adapter.sendsNumCtx).toBe(false);
    expect(adapter.caveat).toBe(CAVEAT);
    expect(new OpenAICompatibleAdapter({ baseUrl: 'https://api.openai.com' }).caveat).toBe(
      REMOTE_CAVEAT,
    );
    await expect(adapter.generate('the prompt', { ...OPTS, numCtx: 16384 })).resolves.toBe(
      'Answer [1].',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8000/v1/chat/completions');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.get('content-type')).toBe('application/json');
    expect(calls[0].body).toEqual({
      model: 'llama3.2:3b',
      messages: [{ role: 'user', content: 'the prompt' }],
      seed: 7,
      temperature: 0.5,
      stream: false,
    });
  });

  it('accepts a base URL that already ends in /v1 or a slash', async () => {
    for (const baseUrl of [
      'http://localhost:8000/v1',
      'http://localhost:8000/v1/',
      'http://localhost:8000/',
    ]) {
      const { fetchImpl, calls } = fakeFetch(() => completion('ok'));
      await new OpenAICompatibleAdapter({ baseUrl, fetch: fetchImpl }).generate('Q', OPTS);
      expect(calls[0].url).toBe('http://localhost:8000/v1/chat/completions');
    }
  });

  it('sends the API key as a bearer token only when one is given', async () => {
    const withKey = fakeFetch(() => completion('ok'));
    await new OpenAICompatibleAdapter({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test-123',
      fetch: withKey.fetchImpl,
    }).generate('Q', OPTS);
    expect(withKey.calls[0].headers.get('authorization')).toBe('Bearer sk-test-123');

    const without = fakeFetch(() => completion('ok'));
    await new OpenAICompatibleAdapter({
      baseUrl: 'http://localhost:8000',
      fetch: without.fetchImpl,
    }).generate('Q', OPTS);
    expect(without.calls[0].headers.has('authorization')).toBe(false);
  });

  it('maps a network failure to AdapterUnavailableError naming the base URL', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const err = await new OpenAICompatibleAdapter({
      baseUrl: 'http://localhost:8000',
      fetch: fetchImpl,
    })
      .generate('Q', OPTS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterUnavailableError);
    expect((err as Error).message).toBe(
      'The OpenAI-compatible server is not reachable at http://localhost:8000. Start it or check --base-url.',
    );
  });

  it('maps an unknown model (OpenAI, vLLM and Ollama 404 bodies) to ModelMissingError', async () => {
    const bodies = [
      {
        error: {
          message: 'The model `x` does not exist or you do not have access to it.',
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      },
      {
        object: 'error',
        message: 'The model `x` does not exist.',
        type: 'NotFoundError',
        code: 404,
      },
      { error: { message: 'model "x" not found, try pulling it first', type: 'api_error' } },
    ];
    for (const body of bodies) {
      const { fetchImpl } = fakeFetch(() => json(body, 404));
      const err = await new OpenAICompatibleAdapter({
        baseUrl: 'http://localhost:8000',
        fetch: fetchImpl,
      })
        .generate('Q', { ...OPTS, model: 'x' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ModelMissingError);
      expect((err as Error).message).toBe(
        'Model x is not available on the server at http://localhost:8000. Check --model.',
      );
    }
  });

  it('says the key was refused on 401 without echoing the key', async () => {
    const { fetchImpl } = fakeFetch(() =>
      json(
        { error: { message: 'Incorrect API key provided: sk-test-123.', code: 'invalid_api_key' } },
        401,
      ),
    );
    const err = await new OpenAICompatibleAdapter({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test-123',
      fetch: fetchImpl,
    })
      .generate('Q', OPTS)
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ModelMissingError);
    expect((err as Error).message).toBe(
      'The server at https://api.example.com refused the request (HTTP 401). Check OPENAI_API_KEY.',
    );
    expect((err as Error).message).not.toContain('sk-test-123');
  });

  it('reports other server errors with their status and message', async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: { message: 'out of memory' } }, 500));
    const err = await new OpenAICompatibleAdapter({
      baseUrl: 'http://localhost:8000',
      fetch: fetchImpl,
    })
      .generate('Q', OPTS)
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ModelMissingError);
    expect(err).not.toBeInstanceOf(AdapterUnavailableError);
    expect((err as Error).message).toBe(
      'The server at http://localhost:8000 returned HTTP 500: out of memory',
    );
  });

  it('throws when the reply has no message content', async () => {
    const { fetchImpl } = fakeFetch(() => json({ choices: [] }));
    await expect(
      new OpenAICompatibleAdapter({ baseUrl: 'http://localhost:8000', fetch: fetchImpl }).generate(
        'Q',
        OPTS,
      ),
    ).rejects.toThrow('The server at http://localhost:8000 returned no message content');
  });
});
