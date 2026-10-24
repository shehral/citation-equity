// How `ce live` matches a source against the author's page.

import { hostOf } from '@citation-equity/engine';

/**
 * Lowercased host without a leading `www.`; '' for a value that is not a URL or host name. The
 * engine's `hostOf`, so `ce live` and `ce sources` normalise hosts the same way.
 */
export const domainOf = hostOf;

/** host (no www) + path (no trailing slash) + query; scheme and fragment dropped. */
export function urlKey(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const path = u.pathname.replace(/\/+$/, '');
  return `${domainOf(u.hostname)}${path}${u.search}`;
}
