import { defineProject } from 'vitest/config';

// E1 pipeline scripts (experiments/e1/*.ts) import engine and bench source by relative path.
export default defineProject({
  // retrieval.test.ts uses Node's own test runner (see its header), so Vitest skips it.
  test: { name: 'e1', include: ['tests/**/*.test.ts'], exclude: ['tests/retrieval.test.ts'] },
});
