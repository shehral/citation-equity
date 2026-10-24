import { expect, test } from '@playwright/test';
import { expectAt, freshVisit, go } from './support';

// Your site, Who gets cited, Research, the header and the old routes, on the built site.

test.beforeEach(async ({ page }) => {
  await freshVisit(page);
});

test('/site checks pasted HTML and robots.txt in the page, command only on expand', async ({
  page,
}) => {
  await go(page, '/site/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Can AI read your page?');
  await expect(
    page.getByRole('list', { name: 'What it checks' }).getByRole('listitem'),
  ).toHaveCount(7);
  await page
    .getByLabel('Page HTML')
    .fill(
      '<html><head><link rel="canonical" href="https://example.com/blog/a"><script type="application/ld+json">{"@type":"BlogPosting","author":{"name":"A"},"datePublished":"2026-01-01"}</script></head><body><article><p>x</p></article></body></html>',
    );
  await page.getByLabel('robots.txt (optional)').fill('User-agent: GPTBot\nDisallow: /\n');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('status')).toHaveText('5 of 7 pass, 1 warning, 1 to fix');
  await expect(results.getByRole('listitem', { name: 'Author name' })).toContainText('Found: A');
  // The command-line block is real text, not a client reference rendered as a function.
  const command = results.getByText('ce site https://example.com/your-page');
  await expect(command).toBeHidden();
  await results.getByText('1 check needs your live site').press('Enter');
  await expect(command).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Attempted to call');

  // The home tile now carries this page's result.
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await expect(page.getByRole('region', { name: 'Your site', exact: true })).toContainText(
    '5 of 7 pass',
  );
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
  await tabs.getByRole('link', { name: 'Who gets cited' }).click();
  await page
    .getByLabel('The answer, with its links (question 1)')
    .fill('https://www.reddit.com/r/espresso/');
  await tabs.getByRole('link', { name: 'Your site' }).click();
  await expectAt(page, '/site/');
  await expect(page.getByLabel('Page HTML')).toHaveValue(html);
  await expect(page.getByRole('region', { name: 'Results' })).toBeVisible();
  await expect(page.getByText('Paste again to see details')).toHaveCount(0);
  await tabs.getByRole('link', { name: 'Who gets cited' }).click();
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

test('/cited parses pasted answers and puts your site first', async ({ page }) => {
  await go(page, '/cited/');
  await page.getByLabel('Question 1', { exact: true }).fill('Why does espresso taste bitter?');
  await page
    .getByLabel('The answer, with its links (question 1)')
    .fill(
      [
        'https://www.reddit.com/r/espresso/comments/abc/bitter/',
        'https://en.wikipedia.org/wiki/Espresso',
        'https://www.example.com/espresso.',
      ].join('\n'),
    );
  await page.getByLabel('Your site').fill('example.com');
  const report = page.getByRole('region', { name: 'Who gets cited' });
  await expect(report).toContainText('Your site: cited in 1 of 1 answers.');
  await expect(report.getByRole('region').first()).toHaveAccessibleName('Your site');
  await expect(report.getByRole('row', { name: /reddit\.com/ })).toBeVisible();
  await expect(report.getByRole('row', { name: /wikipedia\.org/ })).toBeVisible();
  const forums = report.getByRole('region', { name: 'Forums and Q&A sites' });
  await expect(forums.getByText('Do', { exact: true })).toBeVisible();
  await expect(forums.getByText('Avoid', { exact: true })).toBeVisible();
});

test('/research lists all ten checks with a grade each', async ({ page }) => {
  await go(page, '/research/');
  for (const id of ['standalone-paragraphs', 'lists', 'comparisons']) {
    await expect(page.locator(`#check-${id}`)).toBeVisible();
  }
  await expect(page.locator('section[id^="check-"]')).toHaveCount(10);
  await expect(
    page
      .locator('section[id^="check-"]')
      .getByText(/^(Strong evidence|Moderate evidence|Mixed evidence|Untested)$/),
  ).toHaveCount(10);
});

test('old routes redirect: /off-page to /cited, /evidence to /research, /about to the About dialog', async ({
  page,
}) => {
  await go(page, '/off-page/');
  await expectAt(page, '/cited/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Who does AI cite?');

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

test('header: the More menu opens an example in the draft view; tabs appear after leaving home', async ({
  page,
}) => {
  await expect(page.getByRole('navigation', { name: 'Views' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'RAG explainer' }).click();
  await expectAt(page, '/draft/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RAG explainer');
  const tabs = page.getByRole('navigation', { name: 'Views' });
  await expect(tabs.getByRole('link', { name: 'Your draft' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await tabs.getByRole('link', { name: 'Your site' }).click();
  await expectAt(page, '/site/');
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await expectAt(page, '/');
  await expect(tabs).toBeVisible();
});
