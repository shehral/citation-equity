/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://shehral.github.io/citation-equity/"}
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OllamaInstructions } from '@/components/panel/ollama-help';

afterEach(cleanup);

describe('OllamaInstructions on the GitHub Pages site', () => {
  it('names the site origin, without the /citation-equity/ path, in OLLAMA_ORIGINS', () => {
    const view = render(<OllamaInstructions model="qwen2.5:3b" />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('OLLAMA_ORIGINS=https://shehral.github.io ollama serve');
    expect(text).not.toContain('citation-equity');
  });
});
