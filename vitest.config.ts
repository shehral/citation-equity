import { defineConfig } from 'vitest/config';

// Each workspace package is a Vitest project with its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'experiments/e1'],
  },
});
