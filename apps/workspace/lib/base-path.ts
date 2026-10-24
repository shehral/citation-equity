// The GitHub Pages build serves the site under NEXT_PUBLIC_BASE_PATH (next.config.ts). next/link
// and the App Router (router.push / router.replace) add it themselves, so app code passes
// base-path-free routes to them. Only a URL built by hand, such as a full page load, needs
// withBasePath(). Next inlines NEXT_PUBLIC_* values into the client bundle at build time.

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** `path` (starting with "/") under the base path, for URLs that bypass the router. */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** A full page load of `path`, so no component keeps state from before (used by Clear my data). */
export function reloadAt(path: string): void {
  window.location.assign(withBasePath(path));
}
