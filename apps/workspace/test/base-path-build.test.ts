// @vitest-environment node
// Builds the static export the way the GitHub Pages workflow does
// (NEXT_PUBLIC_BASE_PATH=/citation-equity) and checks that every asset and
// page link in the HTML sits under the base path. The build goes to its own
// folder (NEXT_DIST_DIR, inside .next/) so it never replaces out/, which the
// root Playwright project serves at /.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
  'draft/index.html',
  'site/index.html',
  'cited/index.html',
  'questions/index.html',
  'research/index.html',
  // Redirects from the old routes.
  'evidence/index.html',
  'off-page/index.html',
  'about/index.html',
];

/** Every file under `dir`, as paths relative to it. */
function files(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

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

  it('links the header tabs and footer to the base-path pages, with trailing slashes', () => {
    const html = readFileSync(join(OUT, 'research/index.html'), 'utf8');
    const links = sameSite(urls(html));
    for (const route of ['/', '/draft/', '/site/', '/cited/', '/questions/', '/research/']) {
      expect(links).toContain(`${BASE}${route}`);
    }
  });

  it('links each old route to its new one under the base path (the redirect fallback)', () => {
    const fallback = (page: string) =>
      readFileSync(join(OUT, page), 'utf8').match(
        /This page moved\.\s*(?:<!-- -->)?\s*<a[^>]*href="([^"]*)"/,
      )?.[1];
    expect(fallback('off-page/index.html')).toBe(`${BASE}/cited/`);
    expect(fallback('evidence/index.html')).toBe(`${BASE}/research/`);
    expect(fallback('about/index.html')).toBe(`${BASE}/#about`);
  });
});

// next/font downloads the fonts at build time; the export must serve them itself.
describe('fonts', () => {
  it('ships Newsreader and Instrument Sans as files in the export, by relative URL', () => {
    const css = files(join(OUT, '_next/static'))
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(OUT, '_next/static', f), 'utf8'))
      .join('\n');
    for (const family of ['Newsreader', 'Instrument Sans']) expect(css).toContain(family);
    const sources = [...css.matchAll(/@font-face\{[^}]*?src:url\(([^)]+)\)/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src, src).toMatch(/^\.\.\/media\/[\w.-]+\.woff2$/);
      expect(existsSync(join(OUT, '_next/static', src.slice(3))), src).toBe(true);
    }
  });

  it('makes no reference to a font host anywhere in the export', () => {
    for (const f of files(OUT).filter((p) => /\.(html|css|js|txt)$/.test(p))) {
      expect(readFileSync(join(OUT, f), 'utf8'), f).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
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

  it('prerenders /site with its input first', () => {
    const html = readFileSync(join(OUT, 'site/index.html'), 'utf8');
    expect(html).toContain('Can AI read your page?');
    expect(html).toContain('Page HTML');
  });

  it('inlines the theme script itself in <head>', () => {
    const html = readFileSync(join(OUT, 'index.html'), 'utf8');
    expect(html).toContain("<script>(function(){try{var t=localStorage.getItem('ce:v1:theme')");
  });
});
