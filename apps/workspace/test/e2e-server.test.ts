// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_E2E_PORT, e2eServer, PAGES_BASE_PATH, PAGES_DIST_DIR } from '../e2e-server';

// Parallel worktrees each run their own static server: the port comes from E2E_PORT, and a run
// never reuses a server it did not start unless E2E_REUSE=1 says so.
describe('e2eServer', () => {
  it('defaults to port 47381 and starts its own server', () => {
    expect(DEFAULT_E2E_PORT).toBe(47381);
    expect(e2eServer({})).toEqual({
      port: 47381,
      baseURL: 'http://127.0.0.1:47381',
      pagesPort: 47382,
      pagesBaseURL: 'http://127.0.0.1:47382/citation-equity/',
      reuseExistingServer: false,
    });
  });

  it('serves the GitHub Pages build under /citation-equity/ on the next port', () => {
    expect(PAGES_BASE_PATH).toBe('/citation-equity');
    expect(e2eServer({ E2E_PORT: '47393' })).toMatchObject({
      pagesPort: 47394,
      pagesBaseURL: 'http://127.0.0.1:47394/citation-equity/',
    });
  });

  it('takes the port from E2E_PORT', () => {
    expect(e2eServer({ E2E_PORT: '47392' })).toMatchObject({
      port: 47392,
      baseURL: 'http://127.0.0.1:47392',
    });
  });

  it('keeps the default ports clear of the fixed ports serve-out.test.ts listens on', () => {
    const fixed = [
      ...readFileSync(new URL('./serve-out.test.ts', import.meta.url), 'utf8').matchAll(
        /\b(4\d{4})\b/g,
      ),
    ].map((m) => Number(m[1]));
    expect(fixed.length).toBeGreaterThan(0);
    const { port, pagesPort } = e2eServer({});
    expect(fixed).not.toContain(port);
    expect(fixed).not.toContain(pagesPort);
  });

  it('builds both exports where the servers read them, before every e2e run', () => {
    const { scripts } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(scripts['build:pages']).toContain(`NEXT_PUBLIC_BASE_PATH=${PAGES_BASE_PATH} `);
    expect(scripts['build:pages']).toContain(`NEXT_DIST_DIR=${PAGES_DIST_DIR} `);
    // The root export (out/) and the Pages export, so a local run never tests a stale build.
    expect(scripts.pree2e).toBe('pnpm run build && pnpm run build:pages');
  });

  it('reuses a running server only when E2E_REUSE=1', () => {
    expect(e2eServer({ E2E_REUSE: '1' }).reuseExistingServer).toBe(true);
    expect(e2eServer({ E2E_REUSE: 'true' }).reuseExistingServer).toBe(false);
    expect(e2eServer({ E2E_REUSE: '1', CI: '1' }).reuseExistingServer).toBe(true);
  });

  it('refuses a port that is not a number in range', () => {
    // 65535 leaves no port for the Pages build.
    for (const bad of ['abc', '0', '70000', '65535', '47391x', ' ']) {
      expect(() => e2eServer({ E2E_PORT: bad }), bad).toThrow(/E2E_PORT/);
    }
  });
});
