import { caveatFor } from '../caveat';
import type { EngineAdapter, GenerateOptions } from '../types';
import { AdapterUnavailableError, ModelMissingError } from './errors';

/** OpenAI's own API, for `ce bench --adapter openai` without --base-url. */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';

/**
 * Generates with any server that speaks the OpenAI Chat Completions API (`POST /v1/chat/completions`):
 * llama.cpp's server, vLLM, LM Studio, Ollama's compatibility endpoint, or a hosted API. Plain
 * `fetch`, so it runs in the browser and in Node. Sends one user message with the seed and
 * temperature; `numCtx` has no Chat Completions field and is not sent (set it on the server), so
 * `sendsNumCtx` is false and reports record numCtx as null. `caveat` is the local-model caveat only
 * for a server on localhost; any other host, OpenAI's included, gets REMOTE_CAVEAT (Ruling R32).
 * Failures map to the bench's error types as OllamaAdapter's do: the server cannot be reached ->
 * AdapterUnavailableError; HTTP 404 about the model -> ModelMissingError. The API key, when given,
 * goes in the Authorization header only and never into an error message.
 */
export class OpenAICompatibleAdapter implements EngineAdapter {
  readonly name = 'openai-compatible';
  readonly sendsNumCtx = false;
  readonly caveat: string;
  /** The base URL without a trailing slash or `/v1`. */
  readonly baseUrl: string;
  readonly #apiKey: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(opts: { baseUrl: string; apiKey?: string; fetch?: typeof fetch }) {
    // OpenAI's SDKs take the base URL with `/v1`; accept it both ways.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    this.caveat = caveatFor(this.baseUrl);
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  async generate(prompt: string, opts: GenerateOptions): Promise<string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.#apiKey) headers.authorization = `Bearer ${this.#apiKey}`;
    let res: Response;
    try {
      res = await this.#fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: opts.model,
          messages: [{ role: 'user', content: prompt }],
          seed: opts.seed,
          temperature: opts.temperature,
          stream: false,
        }),
      });
    } catch (err) {
      if (err instanceof TypeError) {
        throw new AdapterUnavailableError(
          `The OpenAI-compatible server is not reachable at ${this.baseUrl}. Start it or check --base-url.`,
          { cause: err },
        );
      }
      throw err;
    }
    const body = await res.json().catch(() => undefined);
    if (!res.ok) throw this.#httpError(res.status, body, opts.model);
    const content = (body as ChatCompletion | undefined)?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error(`The server at ${this.baseUrl} returned no message content`);
    }
    return content;
  }

  #httpError(status: number, body: unknown, model: string): Error {
    const message = errorMessage(body);
    const code = errorCode(body);
    if (
      status === 404 &&
      (code === 'model_not_found' || /model\b.*\b(not found|does not exist)/i.test(message))
    ) {
      return new ModelMissingError(
        `Model ${model} is not available on the server at ${this.baseUrl}. Check --model.`,
      );
    }
    // The server's text can echo the key (OpenAI's "Incorrect API key provided: sk-..."): leave it out.
    if (status === 401 || status === 403) {
      return new Error(
        `The server at ${this.baseUrl} refused the request (HTTP ${status}). Check OPENAI_API_KEY.`,
      );
    }
    return new Error(
      `The server at ${this.baseUrl} returned HTTP ${status}${message ? `: ${message}` : ''}`,
    );
  }
}

interface ChatCompletion {
  choices?: { message?: { content?: unknown } }[];
}

/** OpenAI and llama.cpp nest `{ error: { message, code } }`; vLLM puts `message` at the top. */
function errorMessage(body: unknown): string {
  const b = body as { error?: { message?: unknown } | string; message?: unknown } | undefined;
  const nested = typeof b?.error === 'object' ? b.error.message : b?.error;
  const message = nested ?? b?.message;
  return typeof message === 'string' ? message : '';
}

function errorCode(body: unknown): unknown {
  const b = body as { error?: { code?: unknown } } | undefined;
  return typeof b?.error === 'object' ? b.error.code : undefined;
}
