import {
  CHECK_IDS,
  type CheckResult,
  EVIDENCE,
  PRESET_WEIGHTS,
  UNSCORED_CHECKS,
  type Weights,
} from '@citation-equity/engine';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllChecks } from '@/components/draft/all-checks';
import { CHECK_NAMES, CHIP_TEXT, GRADE_WORDS } from '@/lib/glossary';

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

describe('All checks', () => {
  it.each(['foundation', 'evidence'] as const)(
    'in the %s preset, marks each unscored check "Not scored", with its tooltip and no numbers',
    (preset) => {
      renderWith(PRESET_WEIGHTS[preset]);
      expect(UNSCORED_CHECKS).toEqual([
        'question-headings',
        'lists',
        'cited-sources',
        'direct-answer-lead',
      ]);
      for (const id of UNSCORED_CHECKS) {
        const r = row(CHECK_NAMES[id]);
        const chip = within(r).getByText('Not scored');
        expect(chip.title, id).toBe(CHIP_TEXT['not-scored'].title);
        // Still reported: its bar and percent stay.
        expect(within(r).getByText('50%')).toBeTruthy();
      }
      expect(
        screen.getByText('Not scored checks count only if you give them a weight.'),
      ).toBeTruthy();
      for (const id of CHECK_IDS.filter((c) => !UNSCORED_CHECKS.includes(c))) {
        expect(row(CHECK_NAMES[id]).textContent, id).not.toContain('Not scored');
      }
    },
  );

  it('shows no grade, no test result and no numbers; "Helps" only on the checks found to help', () => {
    renderWith(PRESET_WEIGHTS.foundation);
    const text = document.body.textContent ?? '';
    for (const word of Object.values(GRADE_WORDS)) expect(text).not.toContain(word);
    expect(text).not.toMatch(/Tested:|\bE[123]\b|\bCI\b|Holm/);
    for (const id of CHECK_IDS) {
      const helps = within(row(CHECK_NAMES[id])).queryByText('Helps') !== null;
      expect(helps, id).toBe(EVIDENCE[id].e1.label === 'helps');
    }
  });

  it('scores an unscored check like any check once a custom weight includes it', () => {
    renderWith({ ...PRESET_WEIGHTS.foundation, lists: 1, 'question-headings': 0.5 });
    for (const id of ['lists', 'question-headings'] as const) {
      expect(row(CHECK_NAMES[id]).textContent, id).not.toContain('Not scored');
    }
    expect(row(CHECK_NAMES['cited-sources']).textContent).toContain('Not scored');
  });
});
