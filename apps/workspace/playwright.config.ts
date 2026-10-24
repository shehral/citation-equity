import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { e2eServer, PAGES_BASE_PATH, PAGES_DIST_DIR } from './e2e-server';

// The e2e suite runs twice, once per static export, each served on 127.0.0.1 by
// scripts/serve-out.mjs the way the hosted demo is served:
// - root: the plain build in out/, served at /;
// - pages: the GitHub Pages build (NEXT_PUBLIC_BASE_PATH=/citation-equity), served under
//   /citation-equity/.
// `pnpm e2e` writes both first (the pree2e script runs `pnpm build` and `pnpm build:pages`), so
// a run never tests a stale build. Specs navigate with relative URLs ('draft/', './'), so both
// projects run the same specs. Specs live in e2e/, which Vitest never loads (vitest.config.ts
// includes test/** only, so its jsdom setup never meets Playwright's test runner).
// The ports come from E2E_PORT (default 47381, and the next port for pages), and the run starts its
// own servers unless E2E_REUSE=1, so parallel worktrees never test each other's builds.
const { port, baseURL, pagesPort, pagesBaseURL, reuseExistingServer } = e2eServer(process.env);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'root', use: { ...devices['Desktop Chrome'], baseURL: `${baseURL}/` } },
    { name: 'pages', use: { ...devices['Desktop Chrome'], baseURL: pagesBaseURL } },
  ],
  webServer: [
    {
      name: 'root',
      command: 'node scripts/serve-out.mjs',
      url: `${baseURL}/`,
      env: { PORT: String(port) },
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      name: 'pages',
      command: 'node scripts/serve-out.mjs',
      url: pagesBaseURL,
      env: {
        PORT: String(pagesPort),
        OUT_DIR: fileURLToPath(new URL(`${PAGES_DIST_DIR}/`, import.meta.url)),
        BASE_PATH: PAGES_BASE_PATH,
      },
      reuseExistingServer,
      timeout: 30_000,
    },
  ],
});
