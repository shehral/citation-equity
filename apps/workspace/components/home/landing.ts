// Returning users land on their last view, but only when the visit starts on the home.
// A later trip to the home in the same visit (the wordmark, a Home link) must stay there, and
// getLastView() cannot tell the two apart, so this module remembers the first home mount.
import { BASE_PATH } from '@/lib/base-path';
import { viewForPathname } from '@/lib/views';

let homeMounted = false;

/** The pathname this document was loaded at, without the base path; null when unknown. */
function loadedPathname(): string | null {
  try {
    const [entry] = performance.getEntriesByType('navigation');
    if (!entry) return null;
    const path = new URL(entry.name).pathname;
    return BASE_PATH !== '' && path.startsWith(BASE_PATH) ? path.slice(BASE_PATH.length) : path;
  } catch {
    return null;
  }
}

/**
 * True the first time the home mounts in this document, when the document was loaded at the
 * home: the visit started here. Each later call returns false.
 */
export function takeLanding(): boolean {
  if (homeMounted) return false;
  homeMounted = true;
  const loaded = loadedPathname();
  return loaded === null || viewForPathname(loaded) === 'home';
}

/** Forgets the first mount (tests only). */
export function resetLanding(): void {
  homeMounted = false;
}
