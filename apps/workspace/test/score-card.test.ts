import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreCard } from '@/components/panel/score-card';
import { EVIDENCE_STANCE } from '@/lib/presets';

afterEach(cleanup);

const nulls = { foundation: null, evidence: null, custom: null };

describe('ScoreCard', () => {
  it('shows "No content yet" for an empty draft (Review Focus 1)', () => {
    render(
      createElement(ScoreCard, {
        scores: nulls,
        wordCount: 0,
        active: 'foundation',
        pending: false,
      }),
    );
    expect(screen.getByText('No content yet')).toBeTruthy();
  });

  it('shows the active score large and the other preset by name', () => {
    render(
      createElement(ScoreCard, {
        scores: { foundation: 62, evidence: 48, custom: null },
        wordCount: 120,
        active: 'evidence',
        pending: false,
      }),
    );
    expect(screen.getByText('48')).toBeTruthy();
    expect(screen.getByText('GEO Score, Evidence-weighted')).toBeTruthy();
    expect(screen.getByText(/Foundation design:/).textContent).toBe('Foundation design: 62');
  });

  it('says the score is a checklist, not a prediction, and links /evidence (R14)', () => {
    render(
      createElement(ScoreCard, {
        scores: nulls,
        wordCount: 3,
        active: 'foundation',
        pending: false,
      }),
    );
    expect(
      screen.getByText(/None of the checks has strong evidence behind it/).textContent,
    ).toContain('the score is a writing checklist, not a prediction of citations.');
    expect(document.body.textContent).toContain(EVIDENCE_STANCE);
    expect(screen.getByRole('link', { name: 'Read the evidence' }).getAttribute('href')).toBe(
      '/evidence',
    );
  });
});
