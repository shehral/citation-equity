import { connectLocalModel, LOCAL_MODEL, type LocalModelState } from './search-helper';

// The connection to the AI on this computer (Ollama on localhost), shared by every view that
// offers a local AI helper, so one Connect unlocks them all. It lives in memory only: whether a
// model answered says nothing about the next visit, and nothing about it is stored.

/** Not asked yet, asking, or the probe's answer. */
export type LocalModelStatus = 'idle' | 'checking' | LocalModelState;

export interface LocalModel {
  status: LocalModelStatus;
  /** The model asked for, or the one connected when it is ready. */
  model: string;
}

const IDLE: LocalModel = { status: 'idle', model: LOCAL_MODEL };

let current: LocalModel = IDLE;
const listeners = new Set<() => void>();
/** Bumped by every change, so a probe's late answer never undoes a newer one. */
let op = 0;

function set(next: LocalModel) {
  current = next;
  for (const listener of [...listeners]) listener();
}

/** The connection as it is now; the same object until it changes (a store snapshot). */
export function getLocalModel(): LocalModel {
  return current;
}

/** Calls `listener` after every change; returns the unsubscribe. */
export function subscribeLocalModel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A connection made elsewhere: a model name is ready, null is no connection. */
export function setLocalModel(model: string | null) {
  op++;
  set(model === null ? IDLE : { status: 'ready', model });
}

/**
 * What another view found out: Test it's own check (a model ready, or how it failed), or a
 * request to the connected model that failed. Every view reads the one state, so none still
 * offers a helper the model cannot answer; a failure lasts until the next Connect. A probe still
 * asking is dropped, since this news is newer.
 */
export function reportLocalModel(status: LocalModelState, model: string = current.model) {
  op++;
  set({ status, model });
}

/**
 * Connect local AI: asks the local Ollama (only on this click) whether it runs and has the
 * default model. Never rejects: a probe that throws reads as unreachable.
 */
export async function connect(): Promise<void> {
  const id = ++op;
  set({ status: 'checking', model: LOCAL_MODEL });
  let status: LocalModelState;
  try {
    status = await connectLocalModel(LOCAL_MODEL);
  } catch {
    status = 'unreachable';
  }
  if (id === op) set({ status, model: LOCAL_MODEL });
}
