import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestIt } from '@/components/draft/test-it';
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
const panel = () => document.body;
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(within(panel()).getByRole('button', { name }));
  });
};

/** Fails the test on any unhandled rejection while it runs. */
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

describe('Test it, recorded results', () => {
  it('leads with two numbers in plain words and the chance caveat, details folded away', () => {
    render(<TestIt sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    const p = within(panel());
    expect(p.getByText('Cited: 33% before, 75% after')).toBeTruthy();
    expect(p.getByText('Found: 100% before, 100% after')).toBeTruthy();
    expect(p.getByText('Small local AI and sample pages, so this could be chance.')).toBeTruthy();
    expect(p.getByText('Details').closest('details')?.open).toBe(false);
    expect(p.getByText('Sends your text only to the AI on this computer.')).toBeTruthy();
  });

  it('shows valid answers and format failures, cited among valid, the share next to the chance level, then the caveat', () => {
    render(<TestIt sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
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
    expect(cited.textContent).toContain('1 of 3');
    const share = p.getByRole('row', { name: /^Draft share among valid answers/ });
    expect(share.textContent).toContain('0.125');
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
    const recorded = p.getByRole('region', { name: 'Sample result' });
    const caveat = within(recorded).getByText(CAVEAT);
    expect(share.compareDocumentPosition(caveat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel().textContent).toContain('qwen2.5:3b');
    expect(panel().textContent).toContain('2026-10-23 (UTC)');
  });

  it('says the chance level holds only for runs where the draft was retrieved', () => {
    render(<TestIt sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
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
      <TestIt
        sample={{ ...RECORDED_SAMPLE, results: { ...RECORDED_SAMPLE.results, before: old } }}
        markdown={RECORDED_SAMPLE.before}
      />,
    );
    expect(panel().textContent).toContain('No recorded run for this sample yet.');
  });

  it('shows the competitor profile: medians of the cited pages next to the drafts', () => {
    render(<TestIt sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    const table = within(panel()).getByRole('table', { name: /Pages the model cited/ });
    // d1 (3-item list) and d3 (a table) were cited in the before run.
    const lists = within(table).getByRole('row', { name: /^Lists/ });
    expect(lists.textContent).toMatch(/0\.5\s*0\s*0/);
    const tables = within(table).getByRole('row', { name: /^Tables/ });
    expect(tables.textContent).toMatch(/0\.5\s*0\s*0/);
  });

  it('says missed retrievals pull the share down, not that they alone put it below chance', () => {
    render(<TestIt sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    const text = panel().textContent ?? '';
    expect(text).toContain('the share is pulled down by those runs');
    expect(text).not.toContain('for that reason alone');
  });

  it('shows plain counts only: no intervals, p-values or study names, even with no paired test', () => {
    for (const comparison of [
      COMPARISON,
      { ...COMPARISON, nQueries: 0, excludedQueries: ['q1', 'q2'] },
    ]) {
      const { unmount } = render(
        <TestIt
          sample={{ ...RECORDED_SAMPLE, results: { ...RECORDED_SAMPLE.results, comparison } }}
          markdown={RECORDED_SAMPLE.before}
        />,
      );
      const text = panel().textContent ?? '';
      expect(text).not.toMatch(/p = \d|\bCI\b|95%|sign-flip|paired test/);
      expect(text).not.toMatch(/\bGEO\b|Aggarwal/);
      if (comparison.nQueries === 0) expect(text).toContain('Left out: q1, q2.');
      unmount();
    }
  });

  it.each([
    ['pawcAmongValid', { summary: { ...BEFORE_REPORT.summary, pawcAmongValid: undefined } }],
    ['createdAt', { createdAt: undefined }],
    ['citedAmongValid', { summary: { ...BEFORE_REPORT.summary, citedAmongValid: { k: 1 } } }],
  ])('leaves out a v2 report missing %s instead of crashing the page', (_, patch) => {
    const broken = { ...BEFORE_REPORT, ...patch };
    render(
      <TestIt
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
        <TestIt
          sample={{ ...RECORDED_SAMPLE, results: { ...RECORDED_SAMPLE.results, comparison } }}
          markdown={RECORDED_SAMPLE.before}
        />,
      );
      expect(panel().textContent).toContain('No recorded run for this sample yet.');
      view.unmount();
    }
  });

  it('makes no request to a local model until the author clicks', () => {
    render(<TestIt sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    expect(probeMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('Test it, local model', () => {
  it('shows the install instructions when no local model answers, without throwing', async () => {
    probeMock.mockResolvedValue({ reachable: false, models: [] });
    render(<TestIt sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    await click('Connect local AI');
    expect(probeMock).toHaveBeenCalledTimes(1);
    const text = panel().textContent ?? '';
    expect(text).toContain("Can't reach Ollama");
    expect(text).toContain(`OLLAMA_ORIGINS=${window.location.origin} ollama serve`);
    expect(text).toContain('ollama pull qwen2.5:3b');
    expect(within(panel()).getByRole('link', { name: /Install Ollama/ })).toBeTruthy();
    // The recorded results and the caveat stay.
    expect(within(panel()).getByText(CAVEAT)).toBeTruthy();
    expect(within(panel()).getByRole('row', { name: /^Cited among valid answers/ })).toBeTruthy();
  });

  it('says to pull the model when Ollama runs without it', async () => {
    probeMock.mockResolvedValue({ reachable: true, models: ['llama3.2:3b'] });
    render(<TestIt sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    await click('Connect local AI');
    expect(panel().textContent).toContain('ollama pull qwen2.5:3b');
    expect(within(panel()).queryByRole('button', { name: 'Run test' })).toBeNull();
  });

  it('tells the workspace which local model the check found, or that none is ready', async () => {
    const onLocalModel = vi.fn();
    probeMock.mockResolvedValue({ reachable: true, models: ['qwen2.5:3b'] });
    render(
      <TestIt
        sample={RECORDED_SAMPLE}
        markdown={RECORDED_SAMPLE.before}
        onLocalModel={onLocalModel}
      />,
    );
    expect(onLocalModel).not.toHaveBeenCalled();
    await click('Connect local AI');
    expect(onLocalModel).toHaveBeenLastCalledWith('qwen2.5:3b');

    probeMock.mockResolvedValue({ reachable: false, models: [] });
    cleanup();
    render(
      <TestIt
        sample={RECORDED_SAMPLE}
        markdown={RECORDED_SAMPLE.before}
        onLocalModel={onLocalModel}
      />,
    );
    await click('Connect local AI');
    expect(onLocalModel).toHaveBeenLastCalledWith(null);
  });

  it('shows the ollama pull message when the run rejects with ModelMissingError', async () => {
    probeMock.mockResolvedValue({ reachable: true, models: ['qwen2.5:3b'] });
    runMock.mockRejectedValue(
      new ModelMissingError('Model qwen2.5:3b is not installed. Run: ollama pull qwen2.5:3b'),
    );
    render(<TestIt sample={RECORDED_SAMPLE} markdown={AFTER_MD} />);
    await click('Connect local AI');
    await click('Run test');
    const text = panel().textContent ?? '';
    expect(text).toContain('ollama pull qwen2.5:3b');
    expect(text).not.toContain("Can't reach Ollama");
  });

  it('shows the connection instructions when the run rejects with AdapterUnavailableError', async () => {
    probeMock.mockResolvedValue({ reachable: true, models: ['qwen2.5:3b'] });
    runMock.mockRejectedValue(new AdapterUnavailableError('Ollama is not reachable'));
    render(<TestIt sample={RECORDED_SAMPLE} markdown={AFTER_MD} />);
    await click('Connect local AI');
    await click('Run test');
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
    const view = render(<TestIt sample={RECORDED_SAMPLE} markdown={AFTER_MD} />);
    await click('Connect local AI');
    await click('Run test');
    expect(runMock).toHaveBeenCalledTimes(2);
    // The author keeps typing; the results still describe the text that was run.
    view.rerender(
      <TestIt
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
    render(<TestIt sample={RECORDED_SAMPLE} markdown={AFTER_MD} />);
    await click('Connect local AI');
    await click('Run test');
    const bar = within(panel()).getByRole('progressbar', { name: 'Test progress' });
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

describe('Test it, own post', () => {
  it('offers a test pack with a link on how to make one, and no command-line block', () => {
    render(<TestIt sample={null} markdown="# My draft" />);
    const text = panel().textContent ?? '';
    expect(within(panel()).getByLabelText('Load a test pack')).toBeTruthy();
    const href =
      within(panel()).getByRole('link', { name: 'How to make one' }).getAttribute('href') ?? '';
    expect(href).toMatch(/docs\/cli\.md#make-a-test-pack$/);
    // GitHub's anchor for the docs heading "## Make a test pack".
    const cli = readFileSync(join(__dirname, '../../../docs/cli.md'), 'utf8');
    expect(cli).toMatch(/^## Make a test pack$/m);
    expect(text).not.toContain('ce pack');
    expect(text).not.toContain('pnpm');
    // Connect is offered (it powers question suggestions and wording too), but no run without a pack.
    expect(within(panel()).getByRole('button', { name: 'Connect local AI' })).toBeTruthy();
    expect(within(panel()).queryByRole('button', { name: 'Run test' })).toBeNull();
  });

  const packFile = (content: string, name = 'my-pack.json') =>
    new File([content], name, { type: 'application/json' });
  const loadPack = async (file: File) => {
    await act(async () => {
      fireEvent.change(within(panel()).getByLabelText('Load a test pack'), {
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
    const view = render(<TestIt sample={null} markdown={RECORDED_SAMPLE.before} />);
    await loadPack(packFile(JSON.stringify(PACK)));
    expect(panel().textContent).toContain('Loaded my-pack.json');
    view.rerender(<TestIt sample={null} markdown={AFTER_MD} />);
    await click('Connect local AI');
    await click('Run test');
    const [beforeCall, currentCall] = runMock.mock.calls;
    expect(beforeCall[0].packId).toBe(PACK.packId);
    expect(beforeCall[1].markdown).toBe(RECORDED_SAMPLE.before);
    expect(currentCall[1].markdown).toBe(AFTER_MD);
    const local = within(panel()).getByRole('region', { name: /Your run on this machine/ });
    expect(local.textContent).toContain(
      'Small local AI and sample pages, so this could be chance.',
    );
    expect(within(local).getByText(CAVEAT)).toBeTruthy();
  });

  it('says why a file is not a pack, and sends nothing', async () => {
    render(<TestIt sample={null} markdown="# My draft" />);
    await loadPack(packFile('not json'));
    expect(within(panel()).getByRole('alert').textContent).toContain('not JSON');
    await loadPack(packFile(JSON.stringify({ hello: 'world' })));
    expect(within(panel()).getByRole('alert').textContent).not.toBe('');
    expect(within(panel()).queryByRole('button', { name: 'Run test' })).toBeNull();
    expect(probeMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('connects without a pack, for question suggestions and wording', async () => {
    const onLocalModel = vi.fn();
    probeMock.mockResolvedValue({ reachable: true, models: [DEFAULT_SETTINGS.model] });
    render(<TestIt sample={null} markdown="# My draft" onLocalModel={onLocalModel} />);
    await click('Connect local AI');
    expect(onLocalModel).toHaveBeenLastCalledWith(DEFAULT_SETTINGS.model);
    expect(panel().textContent).toContain('Load a test pack to run the test.');
    expect(within(panel()).queryByRole('button', { name: 'Run test' })).toBeNull();
  });

  it('treats a sample without a pack as an own post', () => {
    const { pack: _, results: __, ...bare } = RECORDED_SAMPLE;
    render(<TestIt sample={bare} markdown={bare.before} />);
    expect(within(panel()).getByLabelText('Load a test pack')).toBeTruthy();
  });
});
