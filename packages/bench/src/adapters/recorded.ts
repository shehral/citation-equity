import type { EngineAdapter, GenerateOptions } from '../types';
import { DEFAULT_SETTINGS } from '../types';

/**
 * Key of one generation in a recording: 32-bit FNV-1a (hex) of `model|seed|temperature|prompt` as
 * UTF-8. A context window other than the default (DEFAULT_SETTINGS.numCtx) is part of the key too,
 * as `model|seed|temperature|num_ctx=N|prompt`, so a replay under another --num-ctx cannot reuse
 * answers made with a different window. Keys made at the default are unchanged by that rule.
 */
export function recordingKey(prompt: string, opts: GenerateOptions): string {
  const ctx =
    opts.numCtx === undefined || opts.numCtx === DEFAULT_SETTINGS.numCtx
      ? ''
      : `num_ctx=${opts.numCtx}|`;
  const bytes = new TextEncoder().encode(
    `${opts.model}|${opts.seed}|${opts.temperature}|${ctx}${prompt}`,
  );
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Replays saved answers (tests, the demo and `ce bench --answers`); a prompt that was never
 * recorded is an error. `caveat` is the caveat its reports carry (CAVEAT when omitted).
 */
export class RecordedAdapter implements EngineAdapter {
  readonly name: string;
  readonly caveat: string | undefined;
  readonly #recording: Record<string, string>;

  constructor(
    recording: Record<string, string>,
    name = 'recorded',
    opts: { caveat?: string } = {},
  ) {
    this.#recording = recording;
    this.name = name;
    this.caveat = opts.caveat;
  }

  async generate(prompt: string, opts: GenerateOptions): Promise<string> {
    const key = recordingKey(prompt, opts);
    if (!Object.hasOwn(this.#recording, key)) {
      throw new Error(
        `No recorded answer for key ${key} (model ${opts.model}, seed ${opts.seed}, temperature ${opts.temperature})`,
      );
    }
    return this.#recording[key];
  }
}

/** Passes calls through to `inner` and keeps every answer under its recording key. */
export class RecordingAdapter implements EngineAdapter {
  readonly name: string;
  readonly caveat: string | undefined;
  readonly sendsNumCtx: boolean | undefined;
  readonly recording: Record<string, string> = {};
  readonly #inner: EngineAdapter;

  constructor(inner: EngineAdapter) {
    this.#inner = inner;
    this.name = inner.name;
    this.caveat = inner.caveat;
    this.sendsNumCtx = inner.sendsNumCtx;
  }

  async generate(prompt: string, opts: GenerateOptions): Promise<string> {
    const answer = await this.#inner.generate(prompt, opts);
    this.recording[recordingKey(prompt, opts)] = answer;
    return answer;
  }
}
