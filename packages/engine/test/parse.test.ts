import type { Paragraph } from 'mdast';
import { describe, expect, it } from 'vitest';
import { parseDraft } from '../src/index';

describe('parseDraft', () => {
  it('keeps Markdown source offsets on mdast nodes', () => {
    const source = '# T\n\nHello world.';
    const { markdown, tree } = parseDraft(source);
    expect(markdown).toBe(source);
    const paragraph = tree.children.find((n): n is Paragraph => n.type === 'paragraph');
    expect(paragraph).toBeDefined();
    const start = paragraph?.position?.start.offset ?? -1;
    const end = paragraph?.position?.end.offset ?? -1;
    expect(markdown.slice(start, end)).toBe('Hello world.');
  });

  it('converts HTML input to Markdown and parses the converted text', () => {
    const { markdown, tree } = parseDraft('<h2>Why?</h2><p>Because.</p>', 'html');
    expect(markdown).toContain('## Why?');
    const paragraph = tree.children.find((n): n is Paragraph => n.type === 'paragraph');
    const start = paragraph?.position?.start.offset ?? -1;
    const end = paragraph?.position?.end.offset ?? -1;
    expect(markdown.slice(start, end)).toBe('Because.');
  });

  it('drops page navigation, banners, sidebars and footers from HTML', () => {
    const page =
      '<html><body><header><a href="/">Home</a> | <a href="/about">About</a></header><nav><a href="/blog">Blog</a></nav><main><header><h1>Bitter espresso</h1></header><p>Espresso tastes bitter when it runs long.</p><aside>Related posts</aside><footer>Share this</footer></main><footer>© 2026 Example Cafe</footer></body></html>';
    const { markdown } = parseDraft(page, 'html');
    expect(markdown).toContain('# Bitter espresso');
    expect(markdown).toContain('Espresso tastes bitter when it runs long.');
    for (const chrome of ['Home', 'About', 'Blog', 'Related posts', 'Share this', '© 2026'])
      expect(markdown, chrome).not.toContain(chrome);
    // Without <main>, a lone <article> is the content; a page header holding the H1 stays.
    const article = parseDraft(
      '<header><h1>Title</h1></header><nav>Menu</nav><article><p>Body.</p></article><div role="contentinfo">Legal</div>',
      'html',
    ).markdown;
    expect(article).toContain('Body.');
    expect(article).not.toMatch(/Menu|Legal/);
    expect(parseDraft('<header><h1>Title</h1></header><p>Body.</p>', 'html').markdown).toContain(
      '# Title',
    );
  });

  it('keeps headers, footers and asides that hold content, not only site chrome', () => {
    const md = (html: string) => parseDraft(html, 'html').markdown;
    // A header holding a section heading keeps it.
    expect(md('<header><h2>Section</h2></header><p>Body.</p>')).toContain('## Section');
    // An article footer that lists references keeps its links.
    const refs = md(
      '<article><p>Body.</p><footer><p>Sources: <a href="https://example.org/study">the 2024 study</a></p></footer></article>',
    );
    expect(refs).toContain('https://example.org/study');
    expect(md('<p>Body.</p><footer><cite>Doe, J. (2024). Espresso.</cite></footer>')).toContain(
      'Doe, J. (2024)',
    );
    // An aside with a heading and a paragraph is a real section; a list of related links is not.
    const tip = md('<p>Body.</p><aside><h3>Tip</h3><p>Warm the cup first.</p></aside>');
    expect(tip).toContain('### Tip');
    expect(tip).toContain('Warm the cup first.');
    const related = md(
      '<p>Body.</p><aside><h3>Related posts</h3><ul><li><a href="/milk">Milk</a></li></ul></aside><footer><a href="/privacy">Privacy</a> © 2026</footer>',
    );
    expect(related).not.toMatch(/Related posts|Milk|Privacy|© 2026/);
  });

  it('reads absolute links as sources only when they leave the site and are not social or platform links', () => {
    const md = (html: string) => parseDraft(html, 'html').markdown;
    // A CMS footer with a social link and a "powered by" link is chrome.
    const cms = md(
      '<p>Body.</p><footer><p>© 2026 Jane Doe · <a href="https://twitter.com/jane">Twitter</a> · <a rel="me" href="https://example.social/@jane">Mastodon</a> · Powered by <a href="https://wordpress.org/">WordPress</a></p></footer>',
    );
    expect(cms).not.toMatch(/Jane Doe|Twitter|Mastodon|WordPress/);
    // An aside of related posts with absolute permalinks is chrome, labelled or not.
    const related = md(
      '<p>Body.</p><aside><h3>Related posts</h3><ul><li><a href="https://blog.example.com/milk">Milk</a></li><li><a href="https://blog.example.com/grind">Grind</a></li></ul></aside>',
    );
    expect(related).not.toMatch(/Related posts|Milk|Grind/);
    const page = (body: string) =>
      md(
        `<html><head><link rel="canonical" href="https://blog.example.com/espresso"></head><body><nav><a href="https://blog.example.com/">Home</a></nav><main><p>Body.</p>${body}</main></body></html>`,
      );
    const sameSite = page(
      '<aside><ul><li><a href="https://blog.example.com/milk">Milk</a></li><li><a href="https://www.example.com/shop">Shop</a></li></ul></aside>',
    );
    expect(sameSite).not.toMatch(/Milk|Shop|Home/);
    // A link that leaves the site is a source, with or without a "Sources" label.
    const offSite = page(
      '<footer><p>Data from <a href="https://example.org/study">the 2024 extraction study</a>.</p></footer>',
    );
    expect(offSite).toContain('https://example.org/study');
    const bare = md(
      '<p>Body.</p><footer><p>Data from <a href="https://example.org/study">the 2024 study</a>.</p></footer>',
    );
    expect(bare).toContain('https://example.org/study');
    // A "Sources" or "References" label keeps the block even when its links are same-site or social.
    const labelled = page(
      '<aside><h3>References</h3><ul><li><a href="https://blog.example.com/method">Our method</a></li><li><a href="https://github.com/example/data">The data</a></li></ul></aside>',
    );
    expect(labelled).toContain('### References');
    expect(labelled).toContain('https://github.com/example/data');
  });

  it('keeps a content aside whose heading starts like a site label, and drops labelled site furniture', () => {
    const md = (html: string) => parseDraft(html, 'html').markdown;
    const asides = [
      ['Popular myths', 'Dark roast does not mean more caffeine.'],
      ['Follow-up: what about decaf?', 'Decaf still holds a little caffeine.'],
      ['Related: grind size', 'A finer grind slows the shot down.'],
      ['Share of drinkers', 'About 60% of adults drink coffee every day.'],
      ['Follow-up: is it stronger?', 'No.'],
      ['Related: grind size', '...'],
    ];
    for (const [heading, text] of asides) {
      const out = md(`<p>Body.</p><aside><h3>${heading}</h3><p>${text}</p></aside>`);
      expect(out, heading).toContain(`### ${heading}`);
      expect(out, heading).toContain(text);
      const footer = md(`<p>Body.</p><footer><h3>${heading}</h3><p>${text}</p></footer>`);
      expect(footer, heading).toContain(text);
    }
    // A block named only by a site label is furniture, even with a sentence in it.
    const furniture = [
      '<aside><h3>Subscribe to our newsletter</h3><p>Get one brewing tip in your inbox every week.</p></aside>',
      '<aside><h3>Related posts</h3><p><a href="/milk">Milk</a> How to steam milk for a flat white at home.</p></aside>',
      '<footer><h3>Share this</h3><p>Tell a friend who brews at home about this post.</p></footer>',
      '<aside><h4>Leave a comment</h4><p>Your email address will not be published.</p></aside>',
      '<aside><h3>More from Jane</h3><p><a href="/milk">Milk</a> · <a href="/grind">Grind</a></p></aside>',
    ];
    for (const html of furniture) expect(md(`<p>Body.</p>${html}`), html).toBe('Body.\n');
  });

  it('converts HTML tables to GFM tables', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    const { tree } = parseDraft(html, 'html');
    expect(tree.children.some((n) => n.type === 'table')).toBe(true);
  });

  it('does not parse YAML front matter as content, and keeps the source unchanged', () => {
    const source = '---\ntitle: 50%\n---\n\nBody text.';
    const { markdown, tree } = parseDraft(source);
    expect(markdown).toBe(source);
    expect(tree.children.map((n) => n.type)).toEqual(['paragraph']);
    const [paragraph] = tree.children;
    const start = paragraph?.position?.start.offset ?? -1;
    const end = paragraph?.position?.end.offset ?? -1;
    expect(markdown.slice(start, end)).toBe('Body text.');
  });
});
