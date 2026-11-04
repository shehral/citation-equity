import { expect, type Page, test } from '@playwright/test';
import {
  CAVEAT,
  CHANCE,
  CHECK_IDS,
  E5_TEXT,
  expectAt,
  freshVisit,
  go,
  helpedChecks,
  RESTYLE,
  shortAnswer,
  TEST_LABEL_TEXT,
  TEST_LABELS,
} from './support';

// Your site, Results, Research, the header and the old routes, on the built site.

test.beforeEach(async ({ page }) => {
  await freshVisit(page);
});

/**
 * A page with one blocker: its robots.txt blocks PerplexityBot, a crawler AI search needs. Its
 * schema names an author; it loads enough text without JavaScript.
 */
async function pasteBlockedPage(page: Page) {
  await go(page, '/site/');
  await page
    .getByLabel('Page HTML')
    .fill(
      `<html><head><link rel="canonical" href="https://example.com/blog/a"><script type="application/ld+json">{"@type":"BlogPosting","author":{"name":"A"},"datePublished":"2026-01-01"}</script></head><body><article><h1>A</h1><p>${'word '.repeat(300)}</p></article></body></html>`,
    );
  await page.getByLabel('robots.txt (optional)').fill('User-agent: PerplexityBot\nDisallow: /\n');
  return page.getByRole('region', { name: 'Results' });
}

test('/site/ checks pasted HTML and robots.txt in the page: 1 blocker, command only on expand', async ({
  page,
}) => {
  await go(page, '/site/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Can engines reach it?');
  await expect(page.getByRole('list', { name: 'What it checks' })).toBeVisible();
  const results = await pasteBlockedPage(page);
  await expect(results.getByRole('status')).toHaveText('1 blocker');
  await expect(results.getByRole('listitem', { name: 'AI crawlers allowed' })).toContainText(
    'Blocked: PerplexityBot.',
  );
  // The command-line block is real text, not a client reference rendered as a function.
  const command = results.getByText('ce site https://example.com/your-page');
  await expect(command).toBeHidden();
  await results.getByText('1 check needs your live site').press('Enter');
  await expect(command).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Attempted to call');

  // The home's step card and banner now carry this page's result.
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await expect(page.getByRole('region', { name: 'Your site', exact: true })).toContainText(
    '1 blocker',
  );
  await expect(page.getByRole('region', { name: 'Blocker' })).toContainText(
    'A blocker on your page',
  );
});

test.describe('Your site restyle', () => {
  test.skip(!RESTYLE, 'The Your site restyle is cut.');

  test('/site/: the blockers by name, the crawler row reads Blocker and holds the first-issue anchor; the page notes are collapsed and Not tested', async ({
    page,
  }) => {
    // Before a paste: the three blockers by name, then the notes as one item.
    await go(page, '/site/');
    await expect(
      page.getByRole('list', { name: 'What it checks' }).getByRole('listitem'),
    ).toHaveText([
      'AI crawlers allowed',
      'Search can show it',
      'Text loads without JavaScript',
      'Four page notes',
    ]);
    const results = await pasteBlockedPage(page);
    const blockers = results.getByRole('list', { name: 'Blockers' });
    await expect(blockers.getByRole('listitem')).toHaveCount(3);
    // Each row's pill itself, not the row's text, which a finding could share a word with.
    const pill = (name: string) => blockers.getByRole('listitem', { name }).locator('[data-pill]');
    const crawler = blockers.getByRole('listitem', { name: 'AI crawlers allowed' });
    await expect(pill('AI crawlers allowed')).toHaveText('Blocker');
    await expect(crawler).toHaveAttribute('id', 'first-issue');
    await expect(page.locator('#first-issue')).toHaveCount(1);
    for (const name of ['Search can show it', 'Text loads without JavaScript']) {
      await expect(pill(name)).toHaveText('Clear');
    }

    // Other page notes: collapsed, with its Not tested chip; its rows show once it is opened.
    const notes = results.locator('details').filter({ hasText: 'Other page notes' });
    const summary = notes.locator(':scope > summary');
    await expect(notes).not.toHaveAttribute('open');
    await expect(summary).toContainText('Other page notes (4)');
    await expect(summary.locator('[data-label-chip]')).toHaveText(TEST_LABEL_TEXT['not-tested']);
    const rows = notes.getByRole('list', { name: 'Other page notes' });
    await expect(rows).toBeHidden();
    await summary.click();
    await expect(rows.getByRole('listitem')).toHaveText([
      /^Author name/,
      /^Dates/,
      /^Structured data \(schema\)/,
      /^Main URL \(canonical\)/,
    ]);
    await expect(rows.getByRole('listitem', { name: 'Author name' })).toContainText('Found: A');
  });
});

test('pasted HTML and answers survive switching tabs, and a reload forgets them', async ({
  page,
}) => {
  await go(page, '/site/');
  const html =
    '<html><head><link rel="canonical" href="https://example.com/a"></head><body><article><p>x</p></article></body></html>';
  await page.getByLabel('Page HTML').fill(html);
  await expect(page.getByRole('region', { name: 'Results' })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Views' });
  await tabs.getByRole('link', { name: 'Your draft' }).click();
  await expectAt(page, '/draft/');
  await tabs.getByRole('link', { name: 'Results' }).click();
  await expectAt(page, '/cited/');
  await page
    .getByLabel('The answer, with its links (question 1)')
    .fill('https://www.reddit.com/r/espresso/');
  await tabs.getByRole('link', { name: 'Your site' }).click();
  await expectAt(page, '/site/');
  await expect(page.getByLabel('Page HTML')).toHaveValue(html);
  await expect(page.getByRole('region', { name: 'Results' })).toBeVisible();
  await expect(page.getByText('Paste again to see details')).toHaveCount(0);
  await tabs.getByRole('link', { name: 'Results' }).click();
  await expect(page.getByLabel('The answer, with its links (question 1)')).toHaveValue(
    'https://www.reddit.com/r/espresso/',
  );
  await expect(
    page.getByRole('region', { name: 'Who gets cited' }).getByRole('row', { name: /reddit\.com/ }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('The answer, with its links (question 1)')).toHaveValue('');
  await expect(page.getByText('Paste again to see details')).toBeVisible();
});

test('/cited/: Did it change anything? Test before and after shows the example’s recorded result with its caveats', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Try it with an example' }).click();
  await go(page, '/cited/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Did it change anything?');
  await expect(
    page.getByText(
      'Test your draft before and after on a local AI, or see who live AI search cites.',
    ),
  ).toBeVisible();
  const testIt = page.getByRole('region', { name: 'Test before and after' });
  await expect(testIt).toHaveAttribute('id', 'test');
  await expect(testIt).toContainText(
    'Open models answer from fixed sources, so this shows a direction at most.',
  );
  // The panel reads this browser's draft, so it fills in after the page loads.
  const recorded = testIt.getByRole('region', { name: 'Sample result' });
  await expect(recorded).toContainText('Sample result, before and after the edits:');
  await expect(recorded.getByText(/^Cited: \d+% before, \d+% after$/)).toHaveCount(1);
  await expect(recorded).toContainText(CHANCE);
  await expect(recorded).toContainText(CAVEAT);
  await expect(page.getByRole('region', { name: 'Who AI search cites' })).toHaveAttribute(
    'id',
    'cited',
  );
});

test('/cited/: with no draft, Test before and after asks for one', async ({ page }) => {
  await go(page, '/cited/#test');
  const testIt = page.getByRole('region', { name: 'Test before and after' });
  await expect(testIt).toContainText('Paste a draft first.');
  await testIt.getByRole('link', { name: 'Open draft' }).click();
  await expectAt(page, '/draft/');
});

test('/cited/: Who AI search cites parses pasted answers and puts your site first', async ({
  page,
}) => {
  await go(page, '/cited/');
  const cites = page.getByRole('region', { name: 'Who AI search cites' });
  await cites.getByLabel('Question 1', { exact: true }).fill('Why does espresso taste bitter?');
  await cites
    .getByLabel('The answer, with its links (question 1)')
    .fill(
      [
        'https://www.reddit.com/r/espresso/comments/abc/bitter/',
        'https://en.wikipedia.org/wiki/Espresso',
        'https://www.example.com/espresso.',
      ].join('\n'),
    );
  await cites.getByLabel('Your site').fill('example.com');
  const report = cites.getByRole('region', { name: 'Who gets cited' });
  await expect(report).toContainText('Your site: cited in 1 of 1 answers.');
  await expect(report.getByRole('region').first()).toHaveAccessibleName('Your site');
  await expect(report.getByRole('row', { name: /reddit\.com/ })).toBeVisible();
  await expect(report.getByRole('row', { name: /wikipedia\.org/ })).toBeVisible();
  const forums = report.getByRole('region', { name: 'Forums and Q&A sites' });
  await expect(forums.getByText('Do', { exact: true })).toBeVisible();
  await expect(forums.getByText('Avoid', { exact: true })).toBeVisible();
});

test('/research/: the short answer, all eleven checks with a label and a grade each, and the E5 entry', async ({
  page,
}) => {
  await go(page, '/research/');
  await expect(page.getByText(shortAnswer(helpedChecks()), { exact: true })).toBeVisible();
  const cards = page.locator('section[id^="check-"]');
  await expect(cards).toHaveCount(CHECK_IDS.length);
  for (const id of CHECK_IDS) {
    const card = page.locator(`#check-${id}`);
    await expect(card.locator('[data-label-chip]')).toHaveText(TEST_LABEL_TEXT[TEST_LABELS[id]]);
    await expect(
      card.getByText(/^(Strong evidence|Moderate evidence|Mixed evidence|Untested)$/),
    ).toHaveCount(1);
  }
  // E5's entry reads the E5 module: its two paragraphs, its numbers behind an expand, its files.
  const e5 = page.getByRole('region', { name: 'When the question is a guess' });
  await expect(e5).toHaveAttribute('id', 'e5');
  await expect(e5).not.toContainText('Results are not in yet.');
  for (const paragraph of [E5_TEXT.summary, E5_TEXT.toolNote])
    await expect(e5.getByText(paragraph ?? '', { exact: true })).toBeVisible();
  const numbers = e5.getByText('The numbers', { exact: true });
  await expect(numbers).toBeVisible();
  const main = e5.getByRole('list', { name: 'Main set' });
  await expect(main).toBeHidden();
  await numbers.click();
  await expect(main.getByRole('listitem').first()).toContainText(
    'The gate, 9 vs original on new queries (115 with a valid edit): helps',
  );
  await expect(e5.getByRole('link', { name: 'The plan' })).toBeVisible();
  await expect(e5.getByRole('link', { name: 'E5 results' })).toBeVisible();

  // What Your site and Results leave out is here too, each at the anchor they link to.
  await expect(page.locator('section[id^="site-"]')).toHaveCount(7);
  await expect(page.locator('section[id^="offpage-"]')).toHaveCount(9);
  await go(page, '/research/#offpage-forum');
  await expect(page.locator('#offpage-forum')).toBeInViewport();
});

test('/questions/ redirects to the home, keeping its anchor, and the visit stays there', async ({
  page,
}) => {
  await go(page, '/questions/');
  await expectAt(page, '/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What will your readers ask?');

  // A last view is stored; a visit that starts at the old URL still stays on the home.
  await go(page, '/site/');
  await go(page, '/questions/#your-questions');
  await expectAt(page, '/#your-questions');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What will your readers ask?');
  // Back skips the old page.
  await page.goBack();
  await expectAt(page, '/site/');
});

test('old routes redirect: /off-page to /cited, /evidence to /research, /about to the About dialog', async ({
  page,
}) => {
  await go(page, '/off-page/');
  await expectAt(page, '/cited/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Did it change anything?');

  await go(page, '/evidence/#lists');
  await expectAt(page, '/research/#lists');

  await go(page, '/about/');
  const about = page.getByRole('dialog', { name: 'About' });
  await expect(about).toBeVisible();
  await expectAt(page, '/');
  await expect(about).toContainText(
    'Original design by Prof. Akram Bayat. Built by Mohammad Ali Shehral and Ishan Gupta, Northeastern University, San Jose.',
  );
});

test('header: the More menu opens an example in the draft view; the four tabs appear after leaving home', async ({
  page,
}) => {
  await expect(page.getByRole('navigation', { name: 'Views' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'RAG explainer' }).click();
  await expectAt(page, '/draft/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RAG explainer');
  const tabs = page.getByRole('navigation', { name: 'Views' });
  await expect(tabs.getByRole('link')).toHaveText([
    'Your questions',
    'Your draft',
    'Your site',
    'Results',
  ]);
  await expect(tabs.getByRole('link', { name: 'Your draft' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await tabs.getByRole('link', { name: 'Your site' }).click();
  await expectAt(page, '/site/');
  await tabs.getByRole('link', { name: 'Your questions' }).click();
  await expectAt(page, '/');
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Your questions' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
