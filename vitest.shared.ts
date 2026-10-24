import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineProject } from 'vitest/config';

/**
 * Export condition that points workspace packages at their TypeScript source
 * (see each package.json `exports`), so tests run without a prior build.
 * tsconfig.base.json lists the same condition in `customConditions`.
 */
export const SOURCE_CONDITION = '@citation-equity/source';

/** Vitest project config for a workspace package whose tests live in `test/`. */
export function packageProject(name: string) {
  return defineProject({
    resolve: { conditions: [SOURCE_CONDITION, ...defaultClientConditions] },
    ssr: { resolve: { conditions: [SOURCE_CONDITION, ...defaultServerConditions] } },
    test: { name, include: ['test/**/*.test.ts'] },
  });
}
