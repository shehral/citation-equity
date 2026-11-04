import { analyze } from '@citation-equity/engine';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnalysis } from '@/lib/use-analysis';

vi.mock('@citation-equity/engine', async (importOriginal) => {
  const engine = await importOriginal<typeof import('@citation-equity/engine')>();
  return { ...engine, analyze: vi.fn(engine.analyze) };
});

const analyzeMock = vi.mocked(analyze);

beforeEach(() => {
  vi.useFakeTimers();
  analyzeMock.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('useAnalysis', () => {
  it('runs one analysis for changes made within 250 ms', () => {
    const { result, rerender } = renderHook(({ md }) => useAnalysis(md), {
      initialProps: { md: 'One' },
    });
    expect(result.current.result?.markdown).toBe('One');
    analyzeMock.mockClear();

    rerender({ md: 'One t' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ md: 'One two' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ md: 'One two three' });
    expect(result.current.pending).toBe(true);
    act(() => vi.advanceTimersByTime(249));
    expect(analyzeMock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(analyzeMock.mock.calls[0]?.[0]).toBe('One two three');
    expect(result.current.result?.markdown).toBe('One two three');
    expect(result.current.pending).toBe(false);
  });

  it('refresh() analyzes the latest text at once', () => {
    const { result, rerender } = renderHook(({ md }) => useAnalysis(md), {
      initialProps: { md: 'One' },
    });
    rerender({ md: 'One two' });
    analyzeMock.mockClear();
    act(() => result.current.refresh());
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(result.current.result?.markdown).toBe('One two');
    act(() => vi.advanceTimersByTime(500));
    expect(analyzeMock).toHaveBeenCalledTimes(1);
  });
});

describe('useAnalysis, target questions', () => {
  it('passes the questions to analyze and re-analyzes when they change', () => {
    const md =
      '# Espresso\n\n## How long should a shot take?\n\nA shot should take 25 to 30 seconds from the first drip.\n';
    const { result, rerender } = renderHook(({ qs }) => useAnalysis(md, qs), {
      initialProps: { qs: ['How long should a shot take?'] },
    });
    // Both question checks and the question report measure the same listed questions.
    expect(analyzeMock.mock.calls.at(-1)?.[1]).toEqual({
      questions: ['How long should a shot take?'],
    });
    expect(result.current.result?.questions.rows.map((r) => r.question)).toEqual([
      'How long should a shot take?',
    ]);
    const coverage = () =>
      result.current.result?.checks.find((c) => c.checkId === 'question-coverage');
    expect(coverage()?.metrics).toEqual({ questions: 1, covered: 1 });
    analyzeMock.mockClear();

    // The same questions in a new array do not re-run the analysis.
    rerender({ qs: ['How long should a shot take?'] });
    act(() => vi.advanceTimersByTime(500));
    expect(analyzeMock).not.toHaveBeenCalled();

    rerender({ qs: ['How long should a shot take?', 'Which bank has the lowest rate?'] });
    expect(result.current.pending).toBe(true);
    act(() => vi.advanceTimersByTime(250));
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(coverage()?.metrics).toEqual({ questions: 2, covered: 1 });
    expect(result.current.result?.questions.covered).toBe(1);
    expect(result.current.pending).toBe(false);
  });

  it('analyzes without questions when none are given, and with no weights', () => {
    renderHook(() => useAnalysis('Draft'));
    expect(analyzeMock.mock.calls.at(-1)?.[1]).toEqual({ questions: [] });
  });
});
