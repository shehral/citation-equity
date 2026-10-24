// @vitest-environment node
// Builds the static export the way the GitHub Pages workflow does
// (NEXT_PUBLIC_BASE_PATH=/citation-equity) and checks that every asset and
// page link in the HTML sits under the base path. The build goes to its own
// folder (NEXT_DIST_DIR, inside .next/) so it never replaces out/, which the
// Playwright smoke test serves at /.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const APP = fileURLToPath(new URL('..', import.meta.url));
const DIST = '.next/base-path-check';
const OUT = join(APP, DIST);
const BASE = '/citation-equity';
const PAGES = [
  'index.html',
  'evidence/index.html',
  'site/index.html',
  'off-page/index.html',
  'about/index.html',
];

/** Every href and src value in an HTML file. */
function urls(html: string): string[] {
  return [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
}

/** Same-site URLs: absolute paths, not external links, anchors or protocol-relative URLs. */
function sameSite(list: string[]): string[] {
  return list.filter((u) => u.startsWith('/') && !u.startsWith('//'));
}

beforeAll(async () => {
  await promisify(execFile)(
    process.execPath,
    [join(APP, 'node_modules/next/dist/bin/next'), 'build'],
    {
      cwd: APP,
      env: {
        ...process.env,
        NEXT_PUBLIC_BASE_PATH: BASE,
        NEXT_DIST_DIR: DIST,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}, 180_000);

describe(`static export with NEXT_PUBLIC_BASE_PATH=${BASE}`, () => {
  it('writes each page as <route>/index.html (trailingSlash)', () => {
    for (const page of PAGES) expect(existsSync(join(OUT, page)), page).toBe(true);
  });

  it('serves scripts and styles from /citation-equity/_next/', () => {
    const html = readFileSync(join(OUT, 'index.html'), 'utf8');
    const assets = sameSite(urls(html)).filter((u) => u.includes('/_next/'));
    expect(assets.length).toBeGreaterThan(0);
    for (const u of assets) expect(u).toMatch(/^\/citation-equity\/_next\//);
  });

  it('puts every same-site URL on every page, and on 404.html, under /citation-equity/', () => {
    // GitHub Pages answers a missing path with the site's 404.html, so it needs the prefix too.
    for (const page of [...PAGES, '404.html']) {
      const local = sameSite(urls(readFileSync(join(OUT, page), 'utf8')));
      expect(local.length, page).toBeGreaterThan(0);
      for (const u of local) expect(u, `${page}: ${u}`).toMatch(/^\/citation-equity\//);
    }
  });

  it('links the nav to the base-path pages, with trailing slashes', () => {
    const html = readFileSync(join(OUT, 'evidence/index.html'), 'utf8');
    const links = sameSite(urls(html));
    for (const route of ['/', '/evidence/', '/site/', '/off-page/', '/about/']) {
      expect(links).toContain(`${BASE}${route}`);
    }
  });
});

// A Server Component that imports a plain value from a 'use client' module gets
// a client reference, not the value, and renders it as the source of a function
// that throws "Attempted to call ... from the server". Such values live in lib/.
describe('values shared between server and client components', () => {
  it('renders no client reference as text on any page', () => {
    for (const page of [...PAGES, '404.html']) {
      expect(readFileSync(join(OUT, page), 'utf8'), page).not.toContain('Attempted to call');
    }
  });

  it('shows the real ce site command on /site', () => {
    const html = readFileSync(join(OUT, 'site/index.html'), 'utf8');
    expect(html).toContain('ce site https://example.com/your-page --json');
  });

  it('inlines the theme script itself in <head>', () => {
    const html = readFileSync(join(OUT, 'index.html'), 'utf8');
    expect(html).toContain("<script>(function(){try{var t=localStorage.getItem('ce:v1:theme')");
  });
});
