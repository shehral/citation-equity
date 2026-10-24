import { expect, test } from '@playwright/test';
import { expectAt, freshVisit, go } from './support';

// The home dashboard on the built site: Try it with an example fills all three
// tiles, Next up deep-links into the draft, and a returning visit lands on the last view.

test.beforeEach(async ({ page }) => {
  await freshVisit(page);
});

const tilesOf = (page: import('@playwright/test').Page) =>
  ['Your draft', 'Your site', 'Who gets cited'].map((name) =>
    page.getByRole('region', { name, exact: true }),
  );

test('first visit: Try it with an example fills all three tiles, labelled Example', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Get quoted by AI search.');
  const tiles = tilesOf(page);
  for (const tile of tiles) await expect(tile).toContainText('Not checked');

  await page.getByRole('button', { name: 'Try it with an example' }).click();
  for (const tile of tiles) {
    await expect(tile).toContainText('Example');
    await expect(tile).not.toContainText('Not checked');
  }
  await expect(tiles[0]).toContainText(/\d+ \/ 100/);
  await expect(tiles[1]).toContainText('5 of 7 pass');
  await expect(tiles[2]).toContainText('1 of 3 answers cite you');

  const next = page.getByRole('region', { name: 'Next up' });
  await next.getByRole('link', { name: 'Open' }).click();
  await expectAt(page, '/draft/#start-here');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bitter espresso');
  // The link lands on the Start here list, which appears once the draft is analyzed.
  await expect(page.locator('#start-here')).toBeInViewport();
});

test("after the example, the tiles open the example's details, even after a reload", async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Try it with an example' }).click();
  const tiles = tilesOf(page);

  await tiles[1].getByRole('link').click();
  await expectAt(page, '/site/');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('status')).toHaveText('5 of 7 pass, 1 warning, 1 to fixExample');
  await expect(results.getByRole('listitem', { name: 'AI crawlers allowed' })).toContainText(
    'Blocked: PerplexityBot.',
  );
  await expect(page.getByText('Paste again to see details')).toHaveCount(0);

  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await tiles[2].getByRole('link').click();
  await expectAt(page, '/cited/');
  const report = page.getByRole('region', { name: 'Who gets cited' });
  await expect(report).toContainText('Your site: cited in 1 of 3 answers.');
  await expect(report.getByRole('region').first()).toHaveAccessibleName('Your site');
  await expect(page.getByText('Paste again to see details')).toHaveCount(0);

  // The inputs are never stored; a full load re-runs the views on the example's own input.
  for (const route of ['/site/', '/cited/']) {
    await go(page, route);
    await expect(page.getByText('Example', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Paste again to see details')).toHaveCount(0);
  }
  const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(stored).not.toContain('PerplexityBot');
  expect(stored).not.toContain('reddit.com');
});

test("Next up lands on the site's stored result after a reload", async ({ page }) => {
  await go(page, '/site/');
  await page.getByLabel('robots.txt (optional)').fill('User-agent: PerplexityBot\nDisallow: /\n');
  await page
    .getByLabel('Page HTML')
    .fill(
      `<html><head><link rel="canonical" href="https://example.com/a"></head><body><article><h1>A</h1><p>${'word '.repeat(300)}</p></article></body></html>`,
    );
  await expect(page.locator('#first-issue')).toHaveCount(1);
  // A reload forgets the pasted HTML; the stored summary stays.
  await page.reload();
  await expect(page.getByText('Paste again to see details')).toBeVisible();
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  const next = page.getByRole('region', { name: 'Next up' });
  await expect(next).toContainText('1 check fails on your page.');
  await next.getByRole('link', { name: 'Open' }).click();
  await expectAt(page, '/site/#first-issue');
  const target = page.locator('#first-issue');
  await expect(target).toHaveCount(1);
  await expect(target).toContainText('Paste again to see details');
});

test('Next up deep-links to the first failing row on the site view', async ({ page }) => {
  // A long page whose only failing row is the crawler check, low enough to need a scroll.
  await page.setViewportSize({ width: 1280, height: 500 });
  await go(page, '/site/#first-issue');
  await page.getByLabel('robots.txt (optional)').fill('User-agent: PerplexityBot\nDisallow: /\n');
  await page
    .getByLabel('Page HTML')
    .fill(
      `<html><head><link rel="canonical" href="https://example.com/a"></head><body><article><h1>A</h1><p>${'word '.repeat(300)}</p></article></body></html>`,
    );
  const first = page.locator('#first-issue');
  await expect(first).toHaveCount(1);
  await expect(first).toContainText('AI crawlers allowed');
  await expect(first).toBeInViewport();
});

test('Use my own post leaves no example on the draft tile', async ({ page }) => {
  await page.getByRole('button', { name: 'Try it with an example' }).click();
  await page.getByRole('button', { name: 'Use my own post' }).click();
  await expectAt(page, '/draft/');
  await expect(page.getByText('No content yet')).toBeVisible();
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  const draft = tilesOf(page)[0];
  await expect(draft).toContainText('Not checked');
  await expect(draft).not.toContainText('Example');
});

test('a returning visit that starts on the home lands on the last view', async ({ page }) => {
  await go(page, '/site/');
  await go(page, '/');
  await expectAt(page, '/site/');

  // Coming back to the home within the visit stays on the home.
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await expectAt(page, '/');
  await expect(page.getByRole('region', { name: 'Your site', exact: true })).toBeVisible();
});

test('a returning visit lands on the draft view when that was the last one', async ({
  page,
  context,
}) => {
  await page.getByRole('button', { name: 'Try it with an example' }).click();
  await page.getByRole('region', { name: 'Next up' }).getByRole('link', { name: 'Open' }).click();
  await expectAt(page, '/draft/#start-here');
  // A new tab is a new visit; the stored last view survives it.
  const later = await context.newPage();
  await go(later, '/');
  await expectAt(later, '/draft/');
  await expect(later.getByRole('heading', { level: 1 })).toHaveText('Bitter espresso');
});
