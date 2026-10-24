import { Ollama } from 'ollama/browser';
import { caveatFor } from '../caveat';
import type { EngineAdapter, GenerateOptions } from '../types';
import { AdapterUnavailableError, ModelMissingError } from './errors';

/** Where `ollama serve` listens by default. */
export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
/** probeOllama gives up after this long, so a host that never answers reads as unreachable. */
export const OLLAMA_PROBE_TIMEOUT_MS = 5_000;
/** A generation that has not finished after this long is abandoned (a model stuck loading). */
export const OLLAMA_GENERATE_TIMEOUT_MS = 10 * 60_000;

/** `fetchImpl` with a timeout added to every request, alongside any signal the caller passes. */
function withTimeout(fetchImpl: typeof fetch | undefined, ms: number): typeof fetch {
  const base: typeof fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  return (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return base(input, { ...init, signal });
  };
}

/**
 * Generates with a local Ollama server through its chat endpoint (one user message, no stream).
 * Uses `ollama/browser`, so the same adapter runs in the workspace page and in Node.
 * Failures are mapped to the bench's error types: the server cannot be reached (not running,
 * wrong host, or a browser CORS refusal) -> AdapterUnavailableError; the model is not pulled ->
 * ModelMissingError. Any other server error is rethrown as it came.
 */
export class OllamaAdapter implements EngineAdapter {
  readonly name = 'ollama';
  readonly host: string;
  /** The local-model caveat for a server on this machine; REMOTE_CAVEAT for any other host. */
  readonly caveat: string;
  readonly #client: Ollama;
  readonly #timeoutMs: number;

  constructor(opts: { host?: string; fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.host = opts.host ?? DEFAULT_OLLAMA_HOST;
    this.caveat = caveatFor(this.host);
    this.#timeoutMs = opts.timeoutMs ?? OLLAMA_GENERATE_TIMEOUT_MS;
    this.#client = new Ollama({ host: this.host, fetch: withTimeout(opts.fetch, this.#timeoutMs) });
  }

  async generate(prompt: string, opts: GenerateOptions): Promise<string> {
    let res: Awaited<ReturnType<Ollama['chat']>>;
    try {
      res = await this.#client.chat({
        model: opts.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: {
          seed: opts.seed,
          temperature: opts.temperature,
          ...(opts.numCtx === undefined ? {} : { num_ctx: opts.numCtx }),
        },
      });
    } catch (err) {
      throw mapError(err, this.host, opts.model, this.#timeoutMs);
    }
    const content = res.message?.content;
    if (typeof content !== 'string') throw new Error('Ollama returned no message content');
    return content;
  }
}

/**
 * Asks the server which models it has. Never throws: any failure (including a browser CORS
 * refusal, or no answer within `timeoutMs`) reads as `{ reachable: false, models: [] }`.
 */
export async function probeOllama(
  host: string = DEFAULT_OLLAMA_HOST,
  fetchImpl?: typeof fetch,
  timeoutMs: number = OLLAMA_PROBE_TIMEOUT_MS,
): Promise<{ reachable: boolean; models: string[] }> {
  try {
    const { models } = await new Ollama({ host, fetch: withTimeout(fetchImpl, timeoutMs) }).list();
    return { reachable: true, models: models.map((m) => m.name) };
  } catch {
    return { reachable: false, models: [] };
  }
}

/** ollama-js throws a `ResponseError` (not exported) carrying the HTTP status for server errors. */
function statusOf(err: unknown): number | undefined {
  const status = (err as { status_code?: unknown } | null)?.status_code;
  return typeof status === 'number' ? status : undefined;
}

/** The page's origin when running in a browser, which OLLAMA_ORIGINS must allow. */
function browserOrigin(): string | undefined {
  const origin = (globalThis as { location?: { origin?: unknown } }).location?.origin;
  return typeof window !== 'undefined' && typeof origin === 'string' && origin !== 'null'
    ? origin
    : undefined;
}

/** Each message ends with the one-line fix the CLI prints as is. */
function mapError(err: unknown, host: string, model: string, timeoutMs: number): unknown {
  // Our own timeout (AbortSignal.timeout) rejects with a TimeoutError DOMException.
  if ((err as { name?: unknown } | null)?.name === 'TimeoutError') {
    return new AdapterUnavailableError(
      `Ollama at ${host} did not finish within ${Math.ceil(timeoutMs / 1000)} s. Check that the model loads: ollama run ${model}`,
      { cause: err },
    );
  }
  // fetch rejects with a TypeError when nothing answers (connection refused, DNS, CORS), and in
  // Node also when the server accepts the request but sends no headers in time (undici's
  // headers timeout), which is what a model that fails to load looks like. In a browser the same
  // TypeError is also what a CORS refusal looks like, so the fix names OLLAMA_ORIGINS there.
  if (err instanceof TypeError) {
    const code = (err.cause as { code?: unknown } | undefined)?.code;
    const origin = browserOrigin();
    const message =
      code === 'UND_ERR_HEADERS_TIMEOUT'
        ? `Ollama at ${host} took the request but sent no answer before the timeout. Check that the model loads: ollama run ${model}`
        : origin
          ? `Ollama is not reachable at ${host}, or it refused this page. Start it with this site allowed: OLLAMA_ORIGINS=${origin} ollama serve`
          : `Ollama is not reachable at ${host}. Start Ollama: ollama serve`;
    return new AdapterUnavailableError(message, { cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (
    (statusOf(err) === 404 && /not found/i.test(message)) ||
    /model .* not found/i.test(message)
  ) {
    return new ModelMissingError(`Model ${model} is not installed. Run: ollama pull ${model}`, {
      cause: err,
    });
  }
  return err;
}
