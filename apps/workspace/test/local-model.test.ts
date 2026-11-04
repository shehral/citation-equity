import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connect,
  getLocalModel,
  type LocalModel,
  reportLocalModel,
  setLocalModel,
  subscribeLocalModel,
} from '@/lib/local-model';
import { connectLocalModel, type LocalModelState } from '@/lib/search-helper';

// connectLocalModel would ask Ollama on localhost; the tests decide what it answers.
vi.mock('@/lib/search-helper', () => ({
  LOCAL_MODEL: 'llama3.2:3b',
  connectLocalModel: vi.fn(),
}));
const connectMock = vi.mocked(connectLocalModel);

/** A probe that answers only when the test says so. */
function deferred() {
  let resolve: (state: LocalModelState) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const promise = new Promise<LocalModelState>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const setItem = vi.spyOn(Storage.prototype, 'setItem');

beforeEach(() => {
  // Back to no connection, so each case starts from idle.
  setLocalModel(null);
  connectMock.mockReset();
  setItem.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  // Nothing about the connection is ever written to storage.
  expect(setItem).not.toHaveBeenCalled();
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
});

describe('the local-model store', () => {
  it('starts idle, on the default model, when the page loads', async () => {
    vi.resetModules();
    const fresh = await import('@/lib/local-model');
    expect(fresh.getLocalModel()).toEqual({ status: 'idle', model: 'llama3.2:3b' });
  });

  it('reads checking while it asks, then ready, notifying subscribers of each change', async () => {
    const probe = deferred();
    connectMock.mockReturnValue(probe.promise);
    const seen: LocalModel[] = [];
    const stop = subscribeLocalModel(() => seen.push(getLocalModel()));

    const done = connect();
    expect(connectMock).toHaveBeenCalledWith('llama3.2:3b');
    expect(getLocalModel()).toEqual({ status: 'checking', model: 'llama3.2:3b' });
    probe.resolve('ready');
    await done;

    expect(getLocalModel()).toEqual({ status: 'ready', model: 'llama3.2:3b' });
    expect(seen.map((s) => s.status)).toEqual(['checking', 'ready']);
    stop();
  });

  it.each(['unreachable', 'model-missing'] as const)(
    'reads %s when the probe says so',
    async (state) => {
      connectMock.mockResolvedValue(state);
      await connect();
      expect(getLocalModel()).toEqual({ status: state, model: 'llama3.2:3b' });
    },
  );

  it('reads unreachable, and does not reject, when the probe itself throws', async () => {
    connectMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(connect()).resolves.toBeUndefined();
    expect(getLocalModel().status).toBe('unreachable');
  });

  it('returns the same snapshot until something changes', async () => {
    const before = getLocalModel();
    expect(getLocalModel()).toBe(before);
    connectMock.mockResolvedValue('ready');
    await connect();
    const after = getLocalModel();
    expect(after).not.toBe(before);
    expect(getLocalModel()).toBe(after);
  });

  it('takes a connection made elsewhere: a model name is ready, null is no connection', () => {
    const seen: string[] = [];
    const stop = subscribeLocalModel(() => seen.push(getLocalModel().status));
    setLocalModel('qwen2.5:7b');
    expect(getLocalModel()).toEqual({ status: 'ready', model: 'qwen2.5:7b' });
    setLocalModel(null);
    expect(getLocalModel()).toEqual({ status: 'idle', model: 'llama3.2:3b' });
    expect(seen).toEqual(['ready', 'idle']);
    stop();
  });

  it('takes what another view found: a failed request or check reads as such until Connect', async () => {
    setLocalModel('llama3.2:3b');
    reportLocalModel('unreachable');
    // The model asked for stays named, for the instructions to pull or start it.
    expect(getLocalModel()).toEqual({ status: 'unreachable', model: 'llama3.2:3b' });
    reportLocalModel('model-missing', 'qwen2.5:7b');
    expect(getLocalModel()).toEqual({ status: 'model-missing', model: 'qwen2.5:7b' });
    reportLocalModel('ready', 'qwen2.5:7b');
    expect(getLocalModel()).toEqual({ status: 'ready', model: 'qwen2.5:7b' });

    // A probe that was asking when the failure came in does not undo it.
    const late = deferred();
    connectMock.mockReturnValueOnce(late.promise);
    const asking = connect();
    reportLocalModel('unreachable');
    late.resolve('ready');
    await asking;
    expect(getLocalModel().status).toBe('unreachable');
    // Connect asks afresh.
    connectMock.mockResolvedValueOnce('ready');
    await connect();
    expect(getLocalModel()).toEqual({ status: 'ready', model: 'llama3.2:3b' });
  });

  it('drops a late answer: the last call wins', async () => {
    const first = deferred();
    const second = deferred();
    connectMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const one = connect();
    const two = connect();
    second.resolve('model-missing');
    await two;
    first.resolve('ready');
    await one;
    expect(getLocalModel().status).toBe('model-missing');

    // A connection set elsewhere while a probe runs is not undone by its answer.
    const third = deferred();
    connectMock.mockReturnValueOnce(third.promise);
    const three = connect();
    setLocalModel('qwen2.5:7b');
    third.reject(new Error('gone'));
    await three;
    expect(getLocalModel()).toEqual({ status: 'ready', model: 'qwen2.5:7b' });
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const stop = subscribeLocalModel(listener);
    stop();
    setLocalModel('qwen2.5:7b');
    expect(listener).not.toHaveBeenCalled();
  });
});
