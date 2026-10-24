import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TargetQuestions } from '@/components/panel/target-questions';
import type { WorkspaceQuestion } from '@/lib/questions';

// The local-model helper is never called here; mocked so nothing could reach Ollama.
vi.mock('@/lib/question-helper', () => ({ suggestWithLocalModel: vi.fn() }));

const SEARCH_CONSOLE = [
  'Top queries,Clicks,Impressions,CTR,Position',
  'why is my espresso bitter,31,1204,2.57%,6.4',
  'espresso grind size,12,2310,0.52%,11.2',
  'best espresso grinder 2026,4,980,0.41%,18.9',
].join('\n');
const BING = [
  'Grounding Query,Intent,Topic,Citations,Citation Share',
  'how long should a shot take,Informational,Coffee,52,4.1%',
].join('\n');

function Harness({ initial = [] as WorkspaceQuestion[] }) {
  const [questions, setQuestions] = useState(initial);
  return (
    <TargetQuestions questions={questions} markdown="" localModel={null} onChange={setQuestions} />
  );
}

const csv = (text: string, name = 'Queries.csv') => new File([text], name, { type: 'text/csv' });
const panel = () => within(screen.getByRole('region', { name: 'Target questions' }));
const imported = () => within(screen.getByRole('region', { name: 'Imported queries' }));
const questions = () =>
  panel()
    .queryAllByRole('textbox', { name: /^Question \d/ })
    .map((el) => (el as HTMLInputElement).value);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Import real queries (CSV)', () => {
  it('reads a Search Console export in the browser and lists the top queries with their numbers', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(panel().getByLabelText('Import real queries (CSV)'), csv(SEARCH_CONSOLE));

    const rows = await imported().findAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('What is espresso grind size?'),
      expect.stringContaining('Why is my espresso bitter?'),
      expect.stringContaining('best espresso grinder 2026'),
    ]);
    expect(rows[0]?.textContent).toContain('2,310 impressions, 12 clicks');
    expect(rows[0]?.textContent).toContain('Query: espresso grind size');
    expect(imported().getByText(/3 queries from Queries\.csv/)).toBeTruthy();
    // Nothing is added until the author clicks, and the file never leaves the page.
    expect(questions()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('adds a query as a target question on a click, labelled with its source', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(panel().getByLabelText('Import real queries (CSV)'), csv(BING, 'bing.csv'));
    const add = await imported().findByRole('button', {
      name: 'Add "How long should a shot take?" as a target question',
    });
    await user.click(add);
    expect(questions()).toEqual(['How long should a shot take?']);
    expect(panel().getAllByRole('listitem')[0]?.textContent).toContain('Bing AI Performance');
    expect(imported().getByRole('button', { name: /How long should a shot take/ })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows the parse error, with the headers found, for a file that is not an export', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(
      panel().getByLabelText('Import real queries (CSV)'),
      csv('Keyword,Volume\nespresso,10\n', 'keywords.csv'),
    );
    const alert = await panel().findByRole('alert');
    expect(alert.textContent).toContain('Headers found: Keyword, Volume.');
    expect(screen.queryByRole('region', { name: 'Imported queries' })).toBeNull();
  });

  it('closes the imported list', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(panel().getByLabelText('Import real queries (CSV)'), csv(BING));
    await user.click(await imported().findByRole('button', { name: 'Close imported queries' }));
    expect(screen.queryByRole('region', { name: 'Imported queries' })).toBeNull();
  });
});
