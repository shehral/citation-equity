import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineProject, mergeConfig } from 'vitest/config';
import { packageProject } from '../../vitest.shared.ts';

// Only test/** runs here, so Playwright specs under e2e/ never load in Vitest.
export default mergeConfig(
  packageProject('workspace'),
  defineProject({
    plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.{ts,tsx}'],
      globalSetup: ['./test/global-setup.ts'],
    },
  }),
);
