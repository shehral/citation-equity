// Plain module (no 'use client'): the /site page, a Server Component, and the
// client-side readiness report both show this command. A Server Component that
// imports a value from a 'use client' file gets a client reference instead of
// the value, and renders it as the source of a function that throws.

/** The `ce site` command shown wherever readiness needs a fetch of the live site. */
export const CE_SITE_EXAMPLE = 'ce site https://example.com/your-page';
