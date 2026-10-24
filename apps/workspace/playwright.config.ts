import { defineConfig, devices } from '@playwright/test';

// The smoke test runs against the static export (`next build` writes out/),
// served on 127.0.0.1 by scripts/serve-out.mjs, the way the hosted demo is
// served. Run `pnpm build` first. Specs live in e2e/, which Vitest never
// loads (vitest.config.ts includes test/** only, Ruling R10).
// Not Vite preview's 4173: with reuseExistingServer, a run must never test another local app.
const PORT = 47391;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/serve-out.mjs',
    url: BASE_URL,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
