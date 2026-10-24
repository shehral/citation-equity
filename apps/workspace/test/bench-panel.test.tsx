import {
  AdapterUnavailableError,
  type BenchReport,
  CAVEAT,
  DEFAULT_SETTINGS,
  ModelMissingError,
  probeOllama,
  profileDocument,
  runBench,
} from '@citation-equity/bench';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BenchPanel } from '@/components/panel/bench-panel';
import {
  AFTER_MD,
  AFTER_REPORT,
  BEFORE_REPORT,
  COMPARISON,
  PACK,
  RECORDED_SAMPLE,
} from './fixtures/bench';

// Only the two calls that would reach a local server are replaced; the rest of the
// bench (errors, CAVEAT, compareReports, competitorProfile) is the real code.
vi.mock('@citation-equity/bench', async (importOriginal) => {
  const bench = await importOriginal<typeof import('@citation-equity/bench')>();
  return { ...bench, probeOllama: vi.fn(), runBench: vi.fn() };
});

const probeMock = vi.mocked(probeOllama);
const runMock = vi.mocked(runBench);
const panel = () => screen.getByRole('region', { name: 'Citation test bench' });
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(within(panel()).getByRole('button', { name }));
  });
};

/** Fails the test on any unhandled rejection while it runs (Review Focus 5). */
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  probeMock.mockReset();
  runMock.mockReset();
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  // Let any stray rejection surface before the check.
  await new Promise((r) => setTimeout(r, 0));
  process.off('unhandledRejection', onUnhandled);
  cleanup();
  expect(unhandled).toEqual([]);
});

describe('BenchPanel, recorded results', () => {
  it('shows valid answers and format failures, cited among valid, the share next to the chance level, then the caveat', () => {
    render(<BenchPanel sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    const p = within(panel());
    const valid = p.getByRole('row', { name: /^Valid answers/ });
    expect(valid.textContent).toContain('3 of 4');
    expect(valid.textContent).toContain('1 format failure');
    expect(valid.textContent).toContain('4 of 4');
    expect(valid.textContent).toContain('0 format failures');
    expect(valid.textContent).toContain('-25 points');
    const cited = p.getByRole('row', { name: /^Cited among valid answers/ });
    expect(cited.textContent).toContain('33%');
    expect(cited.textContent).toContain('75%');
    expect(cited.textContent).toContain('+42 points');
    expect(cited.textContent).toContain('p = 0.50');
    // Wilson interval of 1 of 3.
    expect(cited.textContent).toMatch(/6% to 79%/);
    const share = p.getByRole('row', { name: /^Draft share among valid answers/ });
    expect(share.textContent).toContain('0.125');
    expect(share.textContent).toContain('0.000 to 0.370');
    expect(share.textContent).toContain('0.375');
    expect(share.textContent).toContain('chance level: 1 in 2.6 sources');
    expect(share.textContent).toContain('chance level: 1 in 2.4 sources');
    expect(share.textContent).toContain('+0.250');
    expect(p.getByRole('row', { name: /^Retrieved/ }).textContent).toContain('100%');
    // In this order, and the caveat after the numbers.
    const rows = p.getAllByRole('row').map((r) => r.textContent ?? '');
    const index = (prefix: string) => rows.findIndex((t) => t.startsWith(prefix));
    expect(index('Valid answers')).toBeLessThan(index('Cited among valid answers'));
    expect(index('Cited among valid answers')).toBeLessThan(
      index('Draft share among valid answers'),
    );
    const recorded = p.getByRole('region', { name: /Recorded run/ });
    const caveat = within(recorded).getByText(CAVEAT);
    expect(share.compareDocumentPosition(caveat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel().textContent).toContain('qwen2.5:3b');
    expect(panel().textContent).toContain('2026-10-23 (UTC)');
  });

  it('says the chance level holds only for runs where the draft was retrieved', () => {
    render(<BenchPanel sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    const text = panel().textContent ?? '';
    expect(text).not.toContain('over the sources it was given');
    expect(text).toMatch(
      /chance level is the share the draft would get, when it is among the sources/,
    );
    expect(text).toMatch(/not retrieved count as 0/);
  });

  it('leaves out recorded results from before schemaVersion 2', () => {
    const old = { ...BEFORE_REPORT, schemaVersion: 1 };
    render(
      <BenchPanel
        sample={{ ...RECORDED_SAMPLE, results: { ...RECORDED_SAMPLE.results, before: old } }}
        markdown={RECORDED_SAMPLE.before}
      />,
    );
    expect(panel().textContent).toContain('No recorded run for this sample yet.');
    expect(within(panel()).getByText(CAVEAT)).toBeTruthy();
  });

  it('shows the competitor profile: medians of the cited pages next to the drafts', () => {
    render(<BenchPanel sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    const table = within(panel()).getByRole('table', { name: /Pages the model cited/ });
    // d1 (3-item list) and d3 (a table) were cited in the before run.
    const lists = within(table).getByRole('row', { name: /^Lists/ });
    expect(lists.textContent).toMatch(/0\.5\s*0\s*0/);
    const tables = within(table).getByRole('row', { name: /^Tables/ });
    expect(tables.textContent).toMatch(/0\.5\s*0\s*0/);
  });

  it('says missed retrievals pull the share down, not that they alone put it below chance', () => {
    render(<BenchPanel sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    const text = panel().textContent ?? '';
    expect(text).toContain('the share is pulled down by those runs');
    expect(text).not.toContain('for that reason alone');
  });

  it('says no paired test was possible when no question is valid on both sides', () => {
    const none = { ...COMPARISON, nQueries: 0, excludedQueries: ['q1', 'q2'] };
    render(
      <BenchPanel
        sample={{ ...RECORDED_SAMPLE, results: { ...RECORDED_SAMPLE.results, comparison: none } }}
        markdown={RECORDED_SAMPLE.before}
      />,
    );
    const text = panel().textContent ?? '';
    expect(text).not.toMatch(/p = \d/);
    expect(text).not.toContain('over the 0 questions');
    expect(text).toContain('no paired test possible');
    expect(text).toContain('No question has a valid answer on both sides');
  });

  it.each([
    ['pawcAmongValid', { summary: { ...BEFORE_REPORT.summary, pawcAmongValid: undefined } }],
    ['createdAt', { createdAt: undefined }],
    ['citedAmongValid', { summary: { ...BEFORE_REPORT.summary, citedAmongValid: { k: 1 } } }],
  ])('leaves out a v2 report missing %s instead of crashing the page', (_, patch) => {
    const broken = { ...BEFORE_REPORT, ...patch };
    render(
      <BenchPanel
        sample={{ ...RECORDED_SAMPLE, results: { ...RECORDED_SAMPLE.results, before: broken } }}
        markdown={RECORDED_SAMPLE.before}
      />,
    );
    expect(panel().textContent).toContain('No recorded run for this sample yet.');
  });

  it('leaves out a comparison missing excludedQueries or pValue', () => {
    for (const comparison of [
      { ...COMPARISON, excludedQueries: undefined },
      { ...COMPARISON, pValue: undefined },
    ]) {
      const view = render(
        <BenchPanel
          sample={{ ...RECORDED_SAMPLE, results: { ...RECORDED_SAMPLE.results, comparison } }}
          markdown={RECORDED_SAMPLE.before}
        />,
      );
      expect(panel().textContent).toContain('No recorded run for this sample yet.');
      view.unmount();
    }
  });

  it('makes no request to a local model until the author clicks', () => {
    render(<BenchPanel sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    expect(probeMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('BenchPanel, local model', () => {
  it('shows the install instructions when no local model answers, without throwing', async () => {
    probeMock.mockResolvedValue({ reachable: false, models: [] });
    render(<BenchPanel sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    await click('Check for a local model');
    expect(probeMock).toHaveBeenCalledTimes(1);
    const text = panel().textContent ?? '';
    expect(text).toContain('No local model answered');
    expect(text).toContain('CORS');
    expect(text).toContain(`OLLAMA_ORIGINS=${window.location.origin} ollama serve`);
    expect(text).toContain('ollama pull qwen2.5:3b');
    expect(within(panel()).getByRole('link', { name: /Install Ollama/ })).toBeTruthy();
    // The recorded results and the caveat stay.
    expect(within(panel()).getByText(CAVEAT)).toBeTruthy();
    expect(within(panel()).getByRole('row', { name: /^Cited among valid answers/ })).toBeTruthy();
  });

  it('says to pull the model when Ollama runs without it', async () => {
    probeMock.mockResolvedValue({ reachable: true, models: ['llama3.2:3b'] });
    render(<BenchPanel sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    await click('Check for a local model');
    expect(panel().textContent).toContain('ollama pull qwen2.5:3b');
    expect(within(panel()).queryByRole('button', { name: 'Run on my machine' })).toBeNull();
  });

  it('tells the workspace which local model the check found, or that none is ready', async () => {
    const onLocalModel = vi.fn();
    probeMock.mockResolvedValue({ reachable: true, models: ['qwen2.5:3b'] });
    render(
      <BenchPanel
        sample={RECORDED_SAMPLE}
        markdown={RECORDED_SAMPLE.before}
        onLocalModel={onLocalModel}
      />,
    );
    expect(onLocalModel).not.toHaveBeenCalled();
    await click('Check for a local model');
    expect(onLocalModel).toHaveBeenLastCalledWith('qwen2.5:3b');

    probeMock.mockResolvedValue({ reachable: false, models: [] });
    cleanup();
    render(
      <BenchPanel
        sample={RECORDED_SAMPLE}
        markdown={RECORDED_SAMPLE.before}
        onLocalModel={onLocalModel}
      />,
    );
    await click('Check for a local model');
    expect(onLocalModel).toHaveBeenLastCalledWith(null);
  });

  it('shows the ollama pull message when the run rejects with ModelMissingError', async () => {
    probeMock.mockResolvedValue({ reachable: true, models: ['qwen2.5:3b'] });
    runMock.mockRejectedValue(
      new ModelMissingError('Model qwen2.5:3b is not installed. Run: ollama pull qwen2.5:3b'),
    );
    render(<BenchPanel sample={RECORDED_SAMPLE} markdown={AFTER_MD} />);
    await click('Check for a local model');
    await click('Run on my machine');
    const text = panel().textContent ?? '';
    expect(text).toContain('is not installed');
    expect(text).toContain('ollama pull qwen2.5:3b');
    expect(text).not.toContain('No local model answered');
  });

  it('shows the connection instructions when the run rejects with AdapterUnavailableError', async () => {
    probeMock.mockResolvedValue({ reachable: true, models: ['qwen2.5:3b'] });
    runMock.mockRejectedValue(new AdapterUnavailableError('Ollama is not reachable'));
    render(<BenchPanel sample={RECORDED_SAMPLE} markdown={AFTER_MD} />);
    await click('Check for a local model');
    await click('Run on my machine');
    const text = panel().textContent ?? '';
    expect(text).toContain('Ollama stopped answering');
    expect(text).toContain(`OLLAMA_ORIGINS=${window.location.origin} ollama serve`);
  });

  it('runs the sample before draft and the editor text, then shows the comparison', async () => {
    probeMock.mockResolvedValue({ reachable: true, models: ['qwen2.5:3b'] });
    runMock.mockImplementation(async (_pack, draft, _adapter, _settings, onProgress) => {
      onProgress?.(4, 4);
      return draft.id === 'before'
        ? BEFORE_REPORT
        : ({ ...AFTER_REPORT, draftId: draft.id } as BenchReport);
    });
    const view = render(<BenchPanel sample={RECORDED_SAMPLE} markdown={AFTER_MD} />);
    await click('Check for a local model');
    await click('Run on my machine');
    expect(runMock).toHaveBeenCalledTimes(2);
    // The author keeps typing; the results still describe the text that was run.
    view.rerender(
      <BenchPanel
        sample={RECORDED_SAMPLE}
        markdown={`${AFTER_MD}\nMany more words added after the run.\n`}
      />,
    );
    const words = within(
      within(panel()).getByRole('region', { name: /Your run on this machine/ }),
    ).getByRole('row', { name: /^Words/ });
    const wordCells = within(words)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(wordCells.at(-1)).toBe(String(profileDocument('run', AFTER_MD).words));
    const [beforeCall, currentCall] = runMock.mock.calls;
    expect(beforeCall[1].markdown).toBe(RECORDED_SAMPLE.before);
    expect(currentCall[1].markdown).toBe(AFTER_MD);
    expect(beforeCall[3]).toEqual(BEFORE_REPORT.settings);
    const local = within(panel()).getByRole('region', { name: /Your run on this machine/ });
    expect(
      within(local).getByRole('row', { name: /^Cited among valid answers/ }).textContent,
    ).toContain('+42 points');
    expect(within(local).getByText(CAVEAT)).toBeTruthy();
  });

  it('shows progress and cancels a run without an unhandled rejection', async () => {
    probeMock.mockResolvedValue({ reachable: true, models: ['qwen2.5:3b'] });
    let fail: (e: unknown) => void = () => {};
    runMock.mockImplementation((_pack, _draft, _adapter, _settings, onProgress) => {
      onProgress?.(1, 4);
      return new Promise<BenchReport>((_, reject) => {
        fail = reject;
      });
    });
    render(<BenchPanel sample={RECORDED_SAMPLE} markdown={AFTER_MD} />);
    await click('Check for a local model');
    await click('Run on my machine');
    const bar = within(panel()).getByRole('progressbar', { name: 'Bench progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('8');
    await click('Cancel');
    expect(panel().textContent).toContain('Run cancelled');
    expect(within(panel()).queryByRole('progressbar')).toBeNull();
    // The abandoned run settling later must not surface anywhere.
    await act(async () => fail(new AdapterUnavailableError('gone')));
    expect(panel().textContent).toContain('Run cancelled');
    expect(panel().textContent).not.toContain('Ollama stopped answering');
  });
});

describe('BenchPanel, custom draft', () => {
  it('explains that a bench run needs a pack and shows the ce commands', () => {
    render(<BenchPanel sample={null} markdown="# My draft" />);
    const text = panel().textContent ?? '';
    expect(text).toContain('needs a pack');
    expect(text).toContain('ce pack from-urls');
    expect(text).toContain('ce bench --draft');
    expect(within(panel()).getByText(CAVEAT)).toBeTruthy();
    // A local-model check is offered (it powers question suggestions too), but no run without a pack.
    expect(within(panel()).getByRole('button', { name: 'Check for a local model' })).toBeTruthy();
    expect(within(panel()).queryByRole('button', { name: 'Run on my machine' })).toBeNull();
    expect(within(panel()).getByLabelText('Load a pack (JSON)')).toBeTruthy();
  });

  const packFile = (content: string, name = 'my-pack.json') =>
    new File([content], name, { type: 'application/json' });
  const loadPack = async (file: File) => {
    await act(async () => {
      fireEvent.change(within(panel()).getByLabelText('Load a pack (JSON)'), {
        target: { files: [file] },
      });
    });
  };

  it('loads a pack file, then runs the text as loaded against the current text', async () => {
    // A custom draft runs with the bench defaults.
    probeMock.mockResolvedValue({ reachable: true, models: [DEFAULT_SETTINGS.model] });
    runMock.mockImplementation(async (_pack, draft) =>
      draft.id === 'before'
        ? BEFORE_REPORT
        : ({ ...AFTER_REPORT, draftId: draft.id } as BenchReport),
    );
    const view = render(<BenchPanel sample={null} markdown={RECORDED_SAMPLE.before} />);
    await loadPack(packFile(JSON.stringify(PACK)));
    expect(panel().textContent).toContain('Loaded my-pack.json.');
    expect(panel().textContent).toContain('Fixture pack');
    view.rerender(<BenchPanel sample={null} markdown={AFTER_MD} />);
    await click('Check for a local model');
    await click('Run on my machine');
    const [beforeCall, currentCall] = runMock.mock.calls;
    expect(beforeCall[0].packId).toBe(PACK.packId);
    expect(beforeCall[1].markdown).toBe(RECORDED_SAMPLE.before);
    expect(currentCall[1].markdown).toBe(AFTER_MD);
    const local = within(panel()).getByRole('region', { name: /Your run on this machine/ });
    expect(local.textContent).toContain('text at pack load vs your text');
    expect(within(local).getByText(CAVEAT)).toBeTruthy();
  });

  it('says why a file is not a pack, and sends nothing', async () => {
    render(<BenchPanel sample={null} markdown="# My draft" />);
    await loadPack(packFile('not json'));
    expect(within(panel()).getByRole('alert').textContent).toContain('not JSON');
    await loadPack(packFile(JSON.stringify({ hello: 'world' })));
    expect(within(panel()).getByRole('alert').textContent).not.toBe('');
    expect(within(panel()).queryByRole('button', { name: 'Run on my machine' })).toBeNull();
    expect(probeMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('checks for a local model without a pack, for question suggestions', async () => {
    const onLocalModel = vi.fn();
    probeMock.mockResolvedValue({ reachable: true, models: [DEFAULT_SETTINGS.model] });
    render(<BenchPanel sample={null} markdown="# My draft" onLocalModel={onLocalModel} />);
    await click('Check for a local model');
    expect(onLocalModel).toHaveBeenLastCalledWith(DEFAULT_SETTINGS.model);
    expect(panel().textContent).toContain('Load a pack above to run the bench');
    expect(within(panel()).queryByRole('button', { name: 'Run on my machine' })).toBeNull();
  });

  it('treats a sample without a pack as a custom draft', () => {
    const { pack: _, results: __, ...bare } = RECORDED_SAMPLE;
    render(<BenchPanel sample={bare} markdown={bare.before} />);
    expect(panel().textContent).toContain('needs a pack');
  });
});
