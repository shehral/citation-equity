import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TestIt } from '@/components/draft/test-it';
import { WhereItLoses } from '@/components/draft/where-it-loses';
import type { ReportView } from '@/lib/bench';
import { AFTER_REPORT, BEFORE_REPORT, RECORDED_SAMPLE } from './fixtures/bench';
import { expectQuiet } from './quiet';

afterEach(cleanup);

/** The fixture report with the draft missing from the sources of the q2 runs. */
const MISSED_Q2: ReportView = {
  ...AFTER_REPORT,
  runs: AFTER_REPORT.runs.map((r) =>
    r.queryId === 'q2' ? { ...r, draftRetrieved: false, draftCited: false } : r,
  ),
};

const box = () => document.querySelector<HTMLElement>('[data-where-it-loses]');

describe('WhereItLoses', () => {
  it('says the draft loses at the answer when it is always found but not always cited', () => {
    // After: found for all 4 answers, cited in 3 of them.
    render(<WhereItLoses report={AFTER_REPORT} who="your text" />);
    const text = box()?.textContent ?? '';
    expect(text).toContain('Where your text loses');
    expect(text).toContain('Mostly at the answer: the model sees your draft but cites others.');
    expect(text).toContain('Found for 4 of 4 answers. Cited in 3 of those 4.');
  });

  it('says the draft loses at search when it is often not among the sources', () => {
    // Found for 2 of 4 answers (q1), cited in both when found.
    render(<WhereItLoses report={MISSED_Q2} who="your text" />);
    const text = box()?.textContent ?? '';
    expect(text).toContain('Mostly at the search step: the model often never sees your draft.');
    expect(text).toContain('Found for 2 of 4 answers. Cited in 2 of those 2.');
  });

  it('counts only answers with a valid citation', () => {
    // Before: run 3 is a format failure.
    render(<WhereItLoses report={BEFORE_REPORT} who="the draft" />);
    expect(box()?.textContent).toContain('Found for 3 of 3 answers. Cited in 1 of those 3.');
  });

  it('shows nothing when no answer had a valid citation', () => {
    const none: ReportView = {
      ...AFTER_REPORT,
      runs: AFTER_REPORT.runs.map((r) => ({ ...r, formatFailure: true })),
    };
    render(<WhereItLoses report={none} who="your text" />);
    expect(box()).toBeNull();
  });
});

describe('Test it shows where the example loses', () => {
  it('under the two headline numbers, before the chance note, and stays quiet', () => {
    render(<TestIt sample={RECORDED_SAMPLE} markdown={RECORDED_SAMPLE.before} />);
    const recorded = screen.getByRole('region', { name: 'Sample result' });
    const where = box();
    expect(where && recorded.contains(where)).toBe(true);
    expect(where?.textContent).toContain('Where the example after its edits loses');
    const chance = within(recorded).getByText(
      'Small local AI and sample pages, so this could be chance.',
    );
    expect(where?.compareDocumentPosition(chance) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expectQuiet('where it loses', recorded);
  });
});
