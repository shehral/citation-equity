// ce site must not throw when Defuddle fails on a page (site.ts promises a report, not an error).
import { describe, expect, it, vi } from 'vitest';

vi.mock('defuddle/node', () => ({
  Defuddle: async () => {
    throw new Error('parser gave up');
  },
}));

const { checkSite } = await import('../src/node/site');

describe('checkSite when text extraction fails', () => {
  it('reports renders-without-js as not checked, with the reason, and 0 words', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) =>
      String(input).endsWith('/robots.txt')
        ? new Response('', { status: 404 })
        : new Response('<html><body><p>Hello</p></body></html>', {
            headers: { 'content-type': 'text/html' },
          })) as typeof fetch;
    const report = await checkSite('https://example.com/a', { fetchImpl });
    expect(report.extractedWords).toBe(0);
    const item = report.readiness.items.find((i) => i.id === 'renders-without-js');
    expect(item).toMatchObject({
      status: 'unknown',
      detail: "Not checked: the page's text could not be extracted (parser gave up).",
    });
  });
});
