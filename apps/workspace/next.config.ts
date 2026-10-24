import type { NextConfig } from 'next';

// Static export: the hosted demo is plain files with no server.
// The engine and the bench are compiled from their TypeScript source, so the
// app never depends on a stale package build. Turbopack ignores the custom
// `@citation-equity/source` export condition, so each package is aliased to its
// source entry here. Only the bench's browser-safe root entry is aliased; its
// `/node` subpath (file system and network) is never imported by the app.
//
// GitHub Pages serves the site under /<repo>/, so the Pages build sets
// NEXT_PUBLIC_BASE_PATH=/citation-equity (.github/workflows/pages.yml). Unset,
// the site is served at /, as in `next dev`, the unit tests and the root e2e
// project; the pages e2e project serves the base-path build.
// With trailingSlash each page is written as <route>/index.html, which every
// static host serves without rewrites.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath,
  trailingSlash: true,
  // `pnpm build:pages` and test/base-path-build.test.ts set this, so their builds never replace out/.
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
