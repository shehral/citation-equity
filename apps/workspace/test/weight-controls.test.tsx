import { CHECK_DEFINITIONS, PRESET_WEIGHTS } from '@citation-equity/engine';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WeightSlider } from '@/components/panel/weight-controls';

afterEach(cleanup);

describe('WeightSlider', () => {
  it('keeps every preset weight on the slider step, so the thumb sits where the number says', () => {
    const definition = CHECK_DEFINITIONS[0];
    if (!definition) throw new Error('no checks');
    const values = new Set([
      ...Object.values(PRESET_WEIGHTS.foundation),
      ...Object.values(PRESET_WEIGHTS.evidence),
      0.15,
    ]);
    for (const value of values) {
      const { unmount } = render(
        <WeightSlider definition={definition} value={value} onChange={() => {}} />,
      );
      const input = screen.getByRole('slider') as HTMLInputElement;
      const step = Number(input.step);
      // A multiple of the step (to float precision), so the native range input does not snap it.
      expect(Math.abs(value / step - Math.round(value / step))).toBeLessThan(1e-9);
      expect(Number(input.value)).toBeCloseTo(value, 9);
      unmount();
    }
  });
});
