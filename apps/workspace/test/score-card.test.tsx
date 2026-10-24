import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoreCard } from '@/components/draft/score-card';
import { UNSCORED_NOTES } from '@/lib/glossary';

afterEach(cleanup);

const props = {
  scores: { foundation: 62, evidence: 48, custom: null },
  mode: 'foundation' as const,
  hasCustom: false,
  since: null,
  pending: false,
  onModeChange: vi.fn(),
  onAdjustWeights: vi.fn(),
};

describe('ScoreCard', () => {
  it('shows the AI-ready score in a ring, out of 100', () => {
    render(<ScoreCard {...props} />);
    const card = within(screen.getByRole('region', { name: 'AI-ready score' }));
    expect(card.getByRole('img', { name: 'AI-ready score: 62 out of 100' })).toBeTruthy();
    expect(card.queryByText(/GEO/)).toBeNull();
  });

  it('says "+N since you started" only when the score moved', () => {
    const { rerender } = render(<ScoreCard {...props} since={0} />);
    expect(screen.queryByText(/since you started/)).toBeNull();
    rerender(<ScoreCard {...props} since={4} />);
    expect(screen.getByText('+4 since you started')).toBeTruthy();
    rerender(<ScoreCard {...props} since={-2} />);
    expect(screen.getByText('-2 since you started')).toBeTruthy();
  });

  it('says why it is not a forecast, and links the research', async () => {
    render(<ScoreCard {...props} />);
    expect(screen.getByText(/A writing checklist, not a forecast\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
    const pop = within(await screen.findByRole('dialog'));
    expect(pop.getByRole('link', { name: 'See the research' }).getAttribute('href')).toMatch(
      /^\/research\/?$/,
    );
    // The score explanation says plainly which check is not scored, and why.
    expect(pop.getByText(UNSCORED_NOTES.lists ?? 'missing')).toBeTruthy();
  });

  it('switches scoring and opens Adjust weights from the Scoring popover', async () => {
    const onModeChange = vi.fn();
    const onAdjustWeights = vi.fn();
    render(<ScoreCard {...props} onModeChange={onModeChange} onAdjustWeights={onAdjustWeights} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scoring' }));
    const pop = within(await screen.findByRole('dialog'));
    expect(pop.getByRole('button', { name: 'Standard · 62', pressed: true })).toBeTruthy();
    fireEvent.click(pop.getByRole('button', { name: 'By evidence · 48' }));
    expect(onModeChange).toHaveBeenCalledWith('evidence');
    expect(pop.queryByRole('button', { name: /^Custom/ })).toBeNull();
    fireEvent.click(pop.getByRole('button', { name: 'Adjust weights' }));
    expect(onAdjustWeights).toHaveBeenCalled();
  });

  it('says when no check applies yet', () => {
    render(<ScoreCard {...props} scores={{ foundation: null, evidence: null, custom: null }} />);
    expect(screen.getByText('No check applies to this draft yet')).toBeTruthy();
  });
});
