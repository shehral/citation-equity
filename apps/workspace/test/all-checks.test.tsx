import {
  CHECK_IDS,
  type CheckResult,
  EVIDENCE,
  PRESET_WEIGHTS,
  type Weights,
} from '@citation-equity/engine';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllChecks } from '@/components/draft/all-checks';
import { CHECK_NAMES, E1_WORDS, GRADE_WORDS, UNSCORED_NOTES } from '@/lib/glossary';

afterEach(cleanup);

const checks: CheckResult[] = CHECK_IDS.map((checkId) => ({
  checkId,
  applicable: true,
  score: 0.5,
  findings: [],
  suggestions: [],
  metrics: {},
}));

const renderWith = (weights: Weights) =>
  render(
    <AllChecks
      checks={checks}
      weights={weights}
      showWeights={false}
      onShowWeights={vi.fn()}
      onWeightChange={vi.fn()}
    />,
  );

const row = (name: string) =>
  screen.getAllByRole('listitem').find((li) => li.textContent?.startsWith(name)) as HTMLElement;

describe('All 10 checks', () => {
  it.each(['foundation', 'evidence'] as const)(
    'in the %s preset, marks lists as a note that is not scored, and says why',
    (preset) => {
      renderWith(PRESET_WEIGHTS[preset]);
      const lists = row(CHECK_NAMES.lists);
      expect(lists.textContent).toContain('Tested: no clear effect · Not scored');
      // Still reported: its bar and percent stay.
      expect(within(lists).getByText('50%')).toBeTruthy();
      expect(screen.getByText(UNSCORED_NOTES.lists ?? 'missing')).toBeTruthy();
      for (const id of CHECK_IDS.filter((c) => c !== 'lists')) {
        expect(row(CHECK_NAMES[id]).textContent, id).not.toContain('Not scored');
      }
    },
  );

  it("shows each check's grade and its own-test result in plain words", () => {
    renderWith(PRESET_WEIGHTS.foundation);
    for (const id of CHECK_IDS) {
      expect(row(CHECK_NAMES[id]).textContent, id).toContain(
        `${GRADE_WORDS[EVIDENCE[id].grade]} · ${E1_WORDS[EVIDENCE[id].e1.label]}`,
      );
    }
  });

  it('scores lists like any check once a custom weight includes it', () => {
    renderWith({ ...PRESET_WEIGHTS.foundation, lists: 1 });
    expect(row(CHECK_NAMES.lists).textContent).not.toContain('Not scored');
    expect(screen.queryByText(UNSCORED_NOTES.lists ?? 'missing')).toBeNull();
  });
});
