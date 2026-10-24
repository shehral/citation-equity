import { describe, expect, it } from 'vitest';
import { rendersWithoutJs } from '../src/index';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const ARTICLE = (n: number, around = '') =>
  `<!doctype html><html><head><title>T</title></head><body>${around}<article><p>${words(n)}</p></article>${around}</body></html>`;

describe('rendersWithoutJs', () => {
  it('uses the ce site thresholds: 200 or more pass, 50 to 199 warn, under 50 fail', () => {
    for (const [n, status] of [
      [250, 'pass'],
      [200, 'pass'],
      [199, 'warn'],
      [50, 'warn'],
      [49, 'fail'],
      [0, 'fail'],
    ] as const) {
      expect(rendersWithoutJs(ARTICLE(n)), String(n)).toEqual({ status, words: n });
    }
  });

  it('fails an empty app shell, ignoring script, style, noscript and template text', () => {
    const html = `<html><head><title>App</title><style>body { color: red }</style></head><body>
      <noscript>You need to enable JavaScript to run this app.</noscript>
      <div id="root"></div><template><p>${words(300)}</p></template>
      <script>window.data = "${words(300)}"</script></body></html>`;
    expect(rendersWithoutJs(html)).toEqual({ status: 'fail', words: 0 });
  });

  it('counts the article, not the navigation, header, footer or sidebar around it', () => {
    const chrome = `<nav>${words(100)}</nav><footer>${words(100)}</footer><aside>${words(100)}</aside>`;
    expect(rendersWithoutJs(ARTICLE(120, chrome))).toEqual({ status: 'warn', words: 120 });
  });

  it('reads <main> when there is no <article>, and the body when there is neither', () => {
    const main = `<html><body><header>${words(80)}</header><main><p>${words(210)}</p></main></body></html>`;
    expect(rendersWithoutJs(main)).toEqual({ status: 'pass', words: 210 });
    const body = `<html><body><div><p>${words(60)}</p></div></body></html>`;
    expect(rendersWithoutJs(body)).toEqual({ status: 'warn', words: 60 });
  });

  it('reads the longest article when there are several, as related-post cards often are', () => {
    const html = `<html><body><article><p>${words(30)}</p></article><article><p>${words(120)}</p><article><p>${words(40)}</p></article></article><article><p>${words(90)}</p></article></body></html>`;
    expect(rendersWithoutJs(html)).toEqual({ status: 'warn', words: 160 });
  });

  it('keeps words apart across element boundaries', () => {
    const html =
      '<html><body><main><h2>One</h2><p>two</p><ul><li>three</li><li>four</li></ul></main></body></html>';
    expect(rendersWithoutJs(html).words).toBe(4);
  });

  it('fails empty or whitespace-only input without throwing', () => {
    expect(rendersWithoutJs('')).toEqual({ status: 'fail', words: 0 });
    expect(rendersWithoutJs('   \n')).toEqual({ status: 'fail', words: 0 });
  });
});
