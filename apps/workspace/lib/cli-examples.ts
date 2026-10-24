// Plain module (no 'use client'), so a Server Component may import it too. A
// Server Component that imports a value from a 'use client' file gets a client
// reference instead of the value, and renders it as the source of a function
// that throws.

/** The `ce site` command /site shows for the checks that need the live page. */
export const CE_SITE_EXAMPLE = 'ce site https://example.com/your-page';
