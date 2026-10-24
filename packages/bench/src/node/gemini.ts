// A live engine: the Gemini API's generateContent with the Google Search tool ("Grounding with
// Google Search"). Request and response shapes follow Google's API reference, checked 2026-10-23:
// https://ai.google.dev/api/generate-content (Tool.googleSearch, GroundingMetadata, GroundingChunk.web
// {uri, title}, GroundingSupport) and https://ai.google.dev/gemini-api/docs/migrate-to-interactions
// (generateContent "remains fully supported"; its grounded example gives chunk URIs on
// vertexaisearch.cloud.google.com and the site's domain as the title). Model names from
// https://ai.google.dev/gemini-api/docs/models. Retries follow
// https://ai.google.dev/gemini-api/docs/troubleshooting (exponential backoff with jitter on 408,
// 429 and 5xx, a capped number of retries).
import { AdapterUnavailableError } from '../adapters/errors';
import type { LiveAnswer, LiveEngine, LiveSource } from '../types';
import { domainOf } from './domain';

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Google's current stable Flash model (docs, 2026-10-23); override with `model` / `--model`. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
/** Grounding chunk URIs point here and redirect to the cited page. */
const REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
/** Retries after the first try; the backoff is 1 s, 2 s, 4 s, 8 s (plus up to 25% jitter). */
export const GEMINI_MAX_RETRIES = 4;
/** A server-requested wait longer than this means a daily quota, not a burst: give up instead. */
export const GEMINI_MAX_RETRY_WAIT_MS = 60_000;
/** A redirect GET that takes longer is given up; the source keeps its chunk title's domain. */
export const REDIRECT_TIMEOUT_MS = 10_000;

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: unknown }[] };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: { web?: { uri?: unknown; title?: unknown } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: unknown; details?: { '@type'?: unknown; retryDelay?: unknown }[] };
}

/**
 * Gemini with Google Search grounding. Sources come from `groundingMetadata.groundingChunks` (web
 * chunks only, in the API's order). Their URIs are redirects through vertexaisearch.cloud.google.com;
 * with `resolveRedirects` (default true) each is requested once without following it (no key sent)
 * and the `Location` is recorded as the URI, so the target URL can be matched. A redirect that does
 * not resolve keeps the URI as given, and its domain is the chunk title, which Gemini sets to the
 * site's domain, as does one that has not answered within `redirectTimeoutMs` (default 10 s), so a
 * stalled redirect host cannot hold the run. The seed goes in generationConfig; temperature is left
 * at the model default. A model given as `models/<name>` (the API's resource name) is accepted.
 *
 * HTTP 408, 429 and 5xx are retried up to `maxRetries` times with exponential backoff. A wait the
 * server asks for (a `Retry-After` header, or a google.rpc.RetryInfo `retryDelay` in the error
 * body) is honored instead; one over a minute is treated as a spent daily quota and not waited out.
 */
export function geminiGroundedEngine(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  resolveRedirects?: boolean;
  redirectTimeoutMs?: number;
  maxRetries?: number;
  /** Waits between retries; tests pass their own. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1); tests pass their own. */
  random?: () => number;
}): LiveEngine & { readonly model: string } {
  // The API names models `models/<name>`; the path below adds that prefix itself.
  const model = (opts.model ?? DEFAULT_GEMINI_MODEL).replace(/^models\//, '');
  const fetchImpl: typeof fetch = opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const resolve = opts.resolveRedirects ?? true;
  const redirectTimeoutMs = opts.redirectTimeoutMs ?? REDIRECT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? GEMINI_MAX_RETRIES;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  async function generate(question: string, seed: number): Promise<Response> {
    try {
      return await fetchImpl(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        // The key goes in a header, not the URL, so it cannot end up in a logged URL.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: question }] }],
          tools: [{ google_search: {} }],
          generationConfig: { seed },
        }),
      });
    } catch (err) {
      if (err instanceof TypeError) {
        throw new AdapterUnavailableError(
          'The Gemini API is not reachable. Check your network connection.',
          { cause: err },
        );
      }
      throw err;
    }
  }

  async function ask(question: string, seed: number): Promise<LiveAnswer> {
    let body: GenerateContentResponse | undefined;
    for (let attempt = 0; ; attempt++) {
      const res = await generate(question, seed);
      body = (await res.json().catch(() => undefined)) as GenerateContentResponse | undefined;
      if (res.ok) break;
      const failed = `Gemini API returned HTTP ${res.status}${typeof body?.error?.message === 'string' ? `: ${body.error.message}` : ''}`;
      if (!isRetryable(res.status) || attempt >= maxRetries) {
        throw new Error(attempt > 0 ? `${failed} (after ${attempt + 1} tries)` : failed);
      }
      const asked = retryAfterMs(res.headers.get('retry-after')) ?? retryInfoMs(body);
      if (asked !== undefined && asked > GEMINI_MAX_RETRY_WAIT_MS) {
        throw new Error(
          `${failed} (it asks to wait ${Math.ceil(asked / 1000)} s; try again later)`,
        );
      }
      await sleep(asked ?? 1000 * 2 ** attempt * (1 + 0.25 * random()));
    }
    const candidate = body?.candidates?.[0];
    if (!candidate) {
      const blocked = body?.promptFeedback?.blockReason;
      throw new Error(`Gemini returned no answer${blocked ? ` (prompt blocked: ${blocked})` : ''}`);
    }
    const answer = (candidate.content?.parts ?? [])
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('');
    const chunks = (candidate.groundingMetadata?.groundingChunks ?? []).flatMap((c) =>
      typeof c.web?.uri === 'string'
        ? [{ uri: c.web.uri, title: typeof c.web.title === 'string' ? c.web.title : undefined }]
        : [],
    );
    const sources = await Promise.all(
      chunks.map(async ({ uri, title }): Promise<LiveSource> => {
        const final =
          resolve && isRedirect(uri)
            ? await resolveRedirect(uri, fetchImpl, redirectTimeoutMs)
            : uri;
        const domain = isRedirect(final) ? domainOf(title ?? '') : domainOf(final);
        return title === undefined ? { uri: final, domain } : { uri: final, title, domain };
      }),
    );
    return { answer, sources };
  }

  return { name: 'gemini', model, ask };
}

/** Transient per Google's troubleshooting guide: request timeout, rate limit, server errors. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** A `Retry-After` header in milliseconds: delta-seconds or an HTTP date (RFC 9110). */
function retryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** A google.rpc.RetryInfo `retryDelay` (a Duration such as "17s") in milliseconds. */
function retryInfoMs(body: GenerateContentResponse | undefined): number | undefined {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  for (const d of details) {
    const type = d?.['@type'];
    const delay = d?.retryDelay;
    if (typeof type !== 'string' || !type.endsWith('google.rpc.RetryInfo')) continue;
    const m = typeof delay === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(delay) : null;
    if (m) return Number(m[1]) * 1000;
  }
  return undefined;
}

function isRedirect(uri: string): boolean {
  try {
    return new URL(uri).hostname === REDIRECT_HOST;
  } catch {
    return false;
  }
}

/** The redirect's target, or the URI unchanged when the request fails, times out or does not redirect. */
async function resolveRedirect(
  uri: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  try {
    const res = await fetchImpl(uri, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel();
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) return new URL(location, uri).href;
  } catch {
    // Unresolved: the domain still comes from the chunk title.
  }
  return uri;
}
