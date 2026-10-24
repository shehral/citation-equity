import type { NextConfig } from 'next';

// Static export: the hosted demo is plain files with no server (spec 6.2).
// The engine and the bench are compiled from their TypeScript source (Ruling
// R10). Turbopack ignores the custom `@citation-equity/source` export
// condition, so each package is aliased to its source entry here. Only the
// bench's browser-safe root entry is aliased; its `/node` subpath is never
// imported by the app (Ruling R5).
//
// GitHub Pages serves the site under /<repo>/, so the Pages build sets
// NEXT_PUBLIC_BASE_PATH=/citation-equity (.github/workflows/pages.yml). Unset,
// the site is served at /, as in `next dev`, the tests and the smoke test.
// With trailingSlash each page is written as <route>/index.html, which every
// static host serves without rewrites.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath,
  trailingSlash: true,
  // Only test/base-path-build.test.ts sets this, so its build never replaces out/.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: { unoptimized: true },
  // Do not let `next dev` write an AGENTS.md into the app.
  agentRules: false,
  transpilePackages: ['@citation-equity/engine', '@citation-equity/bench'],
  turbopack: {
    resolveAlias: {
      '@citation-equity/engine': '../../packages/engine/src/index.ts',
      '@citation-equity/bench': '../../packages/bench/src/index.ts',
    },
  },
};

export default nextConfig;
