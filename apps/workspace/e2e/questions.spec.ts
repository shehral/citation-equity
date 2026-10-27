import { expect, type Page, test } from '@playwright/test';
import { expectAt, freshVisit, go, openExample } from './support';

// Your questions on the built site, in both projects: keywords in, a ranked list out, each
// question copied, used in the draft or taken to Who gets cited; the searches behind it; the
// list kept in this browser; and no request on the way.

const KEYWORDS = [
  'espresso bitter',
  'espresso shot time, 1900',
  'best espresso grinder for beginners, 720',
  'espresso vs drip coffee, 2400',
  'how to dial in espresso',
].join('\n');
const RANKED = [
  'Which is better: espresso or drip coffee?',
  'espresso shot time',
  'What is the best espresso grinder for beginners?',
  'espresso bitter',
  'How to dial in espresso?',
];
const QUESTION = 'What is the best espresso grinder for beginners?';

const list = (page: Page) => page.getByRole('list', { name: 'Your questions, ranked' });
const questions = (page: Page) => list(page).locator(':scope > li [data-question]');
const item = (page: Page, text: string) =>
  list(page)
    .locator(':scope > li')
    .filter({ has: page.getByText(text, { exact: true }) });

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await freshVisit(page);
});

test('the tab opens Your questions, and pasted keywords become a ranked list', async ({ page }) => {
  await go(page, '/draft/');
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Your questions' })
    .click();
  await expectAt(page, '/questions/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What do your readers ask?');
  await page.getByRole('textbox', { name: 'Your keywords' }).fill(KEYWORDS);
  await expect(questions(page)).toHaveText(RANKED);
  await expect(page.getByText('5 questions, ranked by volume.')).toBeVisible();
  await expect(item(page, RANKED[0])).toContainText('Volume 2,400');

  // Kept in this browser: a reload shows the same list.
  await page.reload();
  await expect(questions(page)).toHaveText(RANKED);
});

test('copy, the searches behind a question, and Ask an AI into Who gets cited', async ({
  page,
}) => {
  const outside: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).origin !== new URL(page.url()).origin) outside.push(req.url());
  });
  await go(page, '/questions/');
  await page.getByRole('textbox', { name: 'Your keywords' }).fill(KEYWORDS);
  const row = item(page, QUESTION);

  await row.getByRole('button', { name: `Copy "${QUESTION}"` }).click();
  await expect(row.getByText('Copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(QUESTION);

  const searches = row.locator('details');
  await expect(searches.getByText('espresso grinder reviews')).toBeHidden();
  await searches.getByText('Searches behind this question').click();
  await expect(searches.getByText('espresso grinder reviews')).toBeVisible();
  await expect(
    searches.getByText('Answer engines often search for these before answering.', { exact: false }),
  ).toBeVisible();

  await row.getByRole('button', { name: `Ask an AI: ${QUESTION}` }).click();
  const steps = row.getByRole('list', { name: 'Ask an AI' });
  await expect(steps.getByRole('listitem')).toHaveCount(3);
  await steps.getByRole('link', { name: 'Who gets cited' }).click();
  await expectAt(page, '/cited/');
  await expect(page.getByRole('textbox', { name: 'Question 1', exact: true })).toHaveValue(
    QUESTION,
  );
  expect(outside).toEqual([]);
});

test('Use in my draft adds the question to the open draft’s reader questions', async ({ page }) => {
  await openExample(page);
  await go(page, '/questions/');
  await page.getByRole('textbox', { name: 'Your keywords' }).fill(KEYWORDS);
  const row = item(page, QUESTION);
  await row.getByRole('button', { name: `Use in my draft: ${QUESTION}` }).click();
  await expect(row.getByText(/Added to Reader questions in the example draft/)).toBeVisible();
  await row.getByRole('link', { name: 'Open your draft' }).click();
  await expectAt(page, '/draft/');
  await page.getByRole('button', { name: /^Reader questions/ }).click();
  const added = page
    .getByRole('list', { name: 'Your reader questions' })
    .locator(':scope > li')
    .last();
  await expect(added.getByRole('textbox')).toHaveValue(QUESTION);
  await expect(added).toContainText('Your keywords');
  await expect(added.locator('details summary')).toHaveText('Searches behind this question');
});

test('imports a Search Console export in the browser and ranks it in', async ({ page }) => {
  await go(page, '/questions/');
  await page.getByRole('textbox', { name: 'Your keywords' }).fill(KEYWORDS);
  await page.getByLabel('Import from Search Console or Bing (CSV)').setInputFiles({
    name: 'Queries.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Top queries,Clicks,Impressions,CTR,Position\nespresso grind size,12,2310,0.52%,11.2\n',
    ),
  });
  await expect(page.getByText('Imported 1 query from Queries.csv.')).toBeVisible();
  await expect(questions(page).nth(1)).toHaveText('espresso grind size');
  await expect(item(page, 'espresso grind size')).toContainText('2,310 impressions');
});

test('at phone width, the filled list does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await go(page, '/questions/');
  await page.getByRole('textbox', { name: 'Your keywords' }).fill(KEYWORDS);
  await item(page, QUESTION).locator('details summary').click();
  await expect(questions(page)).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
