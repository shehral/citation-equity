// Where the e2e run serves the static exports. Each worktree can run its own suite in parallel:
// E2E_PORT picks the port of the root build (default 47381), the GitHub Pages build is served on
// the next port under PAGES_BASE_PATH, and a run starts its own servers unless E2E_REUSE=1, so it
// never tests a server another worktree started on the same port. The default pair stays clear of
// the fixed ports test/serve-out.test.ts uses (47392 to 47396), so Vitest and Playwright can run
// at the same time.

export const DEFAULT_E2E_PORT = 47381;

/** The base path of the GitHub Pages build (.github/workflows/pages.yml). */
export const PAGES_BASE_PATH = '/citation-equity';

/** Where `pnpm build:pages` writes the Pages build for the e2e run (inside .next/, never out/). */
export const PAGES_DIST_DIR = '.next/pages-e2e';

export interface E2eServer {
  port: number;
  baseURL: string;
  /** The Pages build's port and its URL, which ends in the base path and a slash. */
  pagesPort: number;
  pagesBaseURL: string;
  reuseExistingServer: boolean;
}

export function e2eServer(env: Record<string, string | undefined>): E2eServer {
  const raw = env.E2E_PORT;
  const port = raw === undefined ? DEFAULT_E2E_PORT : Number(raw);
  if (raw !== undefined && (!/^\d+$/.test(raw) || port < 1 || port > 65534)) {
    throw new Error(`E2E_PORT must be a port number from 1 to 65534, not "${raw}"`);
  }
  return {
    port,
    baseURL: `http://127.0.0.1:${port}`,
    pagesPort: port + 1,
    pagesBaseURL: `http://127.0.0.1:${port + 1}${PAGES_BASE_PATH}/`,
    reuseExistingServer: env.E2E_REUSE === '1',
  };
}
