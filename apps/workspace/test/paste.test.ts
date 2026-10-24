import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownFromClipboard, sanitizeHtml } from '@/lib/paste';

describe('htmlToMarkdown', () => {
  it('keeps h1 to h3 as Markdown headings', () => {
    expect(htmlToMarkdown('<h1>Why espresso is bitter</h1><h2>Grind</h2><h3>Water</h3>')).toBe(
      '# Why espresso is bitter\n\n## Grind\n\n### Water',
    );
  });

  it('keeps bulleted and numbered lists', () => {
    expect(htmlToMarkdown('<ul><li>Grind finer</li><li>Use less water</li></ul>')).toBe(
      '* Grind finer\n* Use less water',
    );
    expect(htmlToMarkdown('<ol><li>Weigh</li><li>Tamp</li></ol>')).toBe('1. Weigh\n2. Tamp');
  });

  it('keeps links and inline emphasis', () => {
    expect(
      htmlToMarkdown(
        '<p>See <a href="https://example.com/brew">the guide</a> for <strong>ratios</strong>.</p>',
      ),
    ).toBe('See [the guide](https://example.com/brew) for **ratios**.');
  });

  it('keeps tables as GFM tables', () => {
    const html =
      '<table><thead><tr><th>Grind</th><th>Time</th></tr></thead>' +
      '<tbody><tr><td>Fine</td><td>30 s</td></tr></tbody></table>';
    expect(htmlToMarkdown(html)).toBe('| Grind | Time |\n| ----- | ---- |\n| Fine  | 30 s |');
  });

  it('drops scripts, styles and comments with their content', () => {
    const md = htmlToMarkdown(
      '<h2>Hi</h2><script>alert("x")</script><style>p { color: red }</style>' +
        '<!-- tracking note --><p>Text</p>',
    );
    expect(md).toBe('## Hi\n\nText');
  });

  it('drops javascript: links but keeps their text', () => {
    expect(htmlToMarkdown('<p><a href="javascript:alert(1)">Click</a> here</p>')).toBe(
      'Click here',
    );
    expect(htmlToMarkdown('<p><a href=" JaVaScRiPt:alert(1)">Click</a></p>')).toBe('Click');
  });

  it('unwraps the Google Docs wrapper, keeping headings, bold and tight lists', () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b">' +
      '<h1 dir="ltr"><span style="font-size:20pt;font-weight:700">Why espresso is bitter</span></h1>' +
      '<p dir="ltr"><span style="font-weight:400">Bitterness comes from </span>' +
      '<span style="font-weight:700">over-extraction</span><span>.</span></p>' +
      '<ul><li dir="ltr"><p dir="ltr"><span>Grind finer</span></p></li>' +
      '<li dir="ltr"><p dir="ltr"><span style="font-style:italic">Use less water</span></p></li></ul>' +
      '<br></b>';
    expect(htmlToMarkdown(html)).toBe(
      '# Why espresso is bitter\n\nBitterness comes from **over-extraction**.\n\n' +
        '* Grind finer\n* *Use less water*',
    );
  });

  it('turns Word list paragraphs into a list', () => {
    const html =
      '<p class="MsoNormal">Steps:</p>' +
      '<p class="MsoListParagraphCxSpFirst" style="mso-list:l0 level1 lfo1">' +
      '<![if !supportLists]><span style="font-family:Symbol;mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span><![endif]>' +
      'Grind finer<o:p></o:p></p>' +
      '<p class="MsoListParagraphCxSpLast" style="mso-list:l0 level1 lfo1">' +
      '<![if !supportLists]><span style="mso-list:Ignore">·<span>&nbsp;</span></span><![endif]>' +
      'Use less water<o:p></o:p></p>' +
      '<p class="MsoListParagraph" style="mso-list:l1 level1 lfo2">' +
      '<![if !supportLists]><span style="mso-list:Ignore">1.<span>&nbsp;</span></span><![endif]>' +
      'Weigh<o:p></o:p></p>';
    expect(htmlToMarkdown(html)).toBe('Steps:\n\n* Grind finer\n* Use less water\n\n1. Weigh');
  });
});

describe('sanitizeHtml', () => {
  it('removes event attributes and keeps the others', () => {
    const clean = sanitizeHtml(
      '<p onclick="steal()" class="lead">Hi <img src="https://example.com/a.png" alt="A" onerror="x()"></p>',
    );
    expect(clean).not.toMatch(/onclick|onerror|steal|x\(\)/);
    expect(clean).toContain('class="lead"');
    expect(clean).toContain('src="https://example.com/a.png"');
  });

  it('removes script, style, iframe and comment nodes', () => {
    const clean = sanitizeHtml(
      '<p>a</p><script>bad()</script><style>.x{}</style><iframe src="https://example.com"></iframe><!-- c --><p>b</p>',
    );
    expect(clean).toBe('<p>a</p><p>b</p>');
  });
});

describe('markdownFromClipboard', () => {
  it('converts HTML that carries document structure', () => {
    expect(markdownFromClipboard('<h2>Grind</h2><p>Finer is better.</p>')).toBe(
      '## Grind\n\nFiner is better.',
    );
  });

  it('returns null for styled plain text, such as Markdown copied from a code editor', () => {
    const vscode =
      '<meta charset="utf-8"><div style="color: #d4d4d4;"><div><span style="color: #569cd6;">## Heading</span></div>' +
      '<div><span>- item</span></div></div>';
    expect(markdownFromClipboard(vscode)).toBeNull();
  });

  it('returns null when nothing but scripts and styles remains', () => {
    expect(markdownFromClipboard('<script>alert(1)</script><style>p{}</style>')).toBeNull();
  });
});
