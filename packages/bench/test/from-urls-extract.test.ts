// A page Defuddle cannot parse is skipped with its reason; the rest of the pack is still built.
import { describe, expect, it, vi } from 'vitest';

vi.mock('defuddle/node', () => ({
  Defuddle: async (_doc: unknown, url: string) => {
    if (url.endsWith('/bad')) throw new Error('parser gave up');
    return { title: 'Good page', content: 'Readable text about espresso.' };
  },
}));

const { packFromUrls } = await import('../src/node/from-urls');

describe('packFromUrls when text extraction fails', () => {
  it('skips that page with the reason and keeps the others', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) =>
      String(input).endsWith('/robots.txt')
        ? new Response('', { status: 404 })
        : new Response('<html><body><p>x</p></body></html>', {
            headers: { 'content-type': 'text/html' },
          })) as typeof fetch;
    const skipped: [string, string][] = [];
    const pack = await packFromUrls({
      question: 'q',
      urls: ['https://example.com/bad', 'https://example.com/good'],
      packId: 'p',
      fetchImpl,
      onSkip: (url, reason) => skipped.push([url, reason]),
    });
    expect(skipped).toEqual([
      ['https://example.com/bad', 'text extraction failed (parser gave up)'],
    ]);
    expect(pack.queries[0].documents).toHaveLength(1);
    expect(pack.queries[0].documents[0].title).toBe('Good page');
  });
});
