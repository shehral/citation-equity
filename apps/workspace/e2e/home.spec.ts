import { expect, type Page, test } from '@playwright/test';
import {
  cardChips,
  cardChipsOf,
  coveredHeading,
  EXAMPLE_QUESTIONS,
  expectAt,
  freshVisit,
  go,
  openExample,
  pageText,
  QUESTION_LABELS,
  questionsCard,
  storedText,
  typeDraft,
} from './support';

// The home, "What will your readers ask?", on the built site: Try it with an example fills the
// step cards, the blocker banner and the list; typing your own questions while the example is
// open moves to My post; a tick puts a question on the open draft; keywords and an imported
// export become a ranked list, each question copied or taken to Results; old stored values
// migrate; and a visit that starts on the home lands on the last view.

test.beforeEach(async ({ page }) => {
  await freshVisit(page);
});

const steps = (page: Page) => page.getByRole('region', { name: 'Next steps' });
const stepCard = (page: Page, name: 'Your draft' | 'Your site' | 'Results') =>
  steps(page).getByRole('region', { name, exact: true });
const banner = (page: Page) => page.getByRole('region', { name: 'Blocker' });
const box = (page: Page) => page.getByRole('textbox', { name: "Your readers' questions" });
const list = (page: Page) => page.getByRole('list', { name: 'Your questions, ranked' });
const listed = (page: Page) => list(page).locator(':scope > li [data-question]');
const tick = (page: Page, question: string) =>
  list(page).getByRole('checkbox', { name: question, exact: true });
const item = (page: Page, question: string) =>
  list(page)
    .locator(':scope > li')
    .filter({ has: page.getByText(question, { exact: true }) });

/** Keywords and questions as a writer pastes them, some with a search volume. */
const KEYWORDS = [
  'espresso bitter',
  'espresso shot time, 1900',
  'best espresso grinder for beginners, 720',
  'espresso vs drip coffee, 2400',
  'how to dial in espresso',
].join('\n');
/** KEYWORDS as the list ranks them: by volume, each kept as typed or made a question. */
const RANKED = [
  'Which is better: espresso or drip coffee?',
  'espresso shot time',
  'What is the best espresso grinder for beginners?',
  'espresso bitter',
  'How to dial in espresso?',
];

/** A page whose only blocker is its robots.txt (PerplexityBot), with enough text to read. */
const BLOCKED_PAGE = {
  robots: 'User-agent: PerplexityBot\nDisallow: /\n',
  html: `<html><head><link rel="canonical" href="https://example.com/a"></head><body><article><h1>A</h1><p>${'word '.repeat(300)}</p></article></body></html>`,
};

test('first visit: Try it with an example fills the step cards, the banner and the list', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What will your readers ask?');
  // The step cards are titled one level below their Next steps heading.
  await expect(steps(page).getByRole('heading', { level: 2 })).toHaveText('Next steps');
  await expect(steps(page).getByRole('heading', { level: 3 })).toHaveText([
    'Your draft',
    'Your site',
    'Results',
  ]);
  for (const name of ['Your draft', 'Your site', 'Results'] as const) {
    await expect(stepCard(page, name)).toContainText('Not checked');
  }
  await expect(banner(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Try it with an example' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Example loaded.' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Try it with an example' })).toHaveCount(0);
  await expect(page.getByText('This is the example.')).toBeVisible();
  for (const name of ['Your draft', 'Your site', 'Results'] as const) {
    await expect(stepCard(page, name)).toContainText('Example');
    await expect(stepCard(page, name)).not.toContainText('Not checked');
  }
  await expect(stepCard(page, 'Your draft')).toContainText('0 of 4 covered');
  await expect(stepCard(page, 'Your site')).toContainText('1 blocker');
  await expect(stepCard(page, 'Your site')).toContainText('AI crawlers allowed');
  await expect(stepCard(page, 'Results')).toContainText('1 of 3 live answers cite you');
  await expect(banner(page)).toContainText('A blocker on the example page');
  await expect(banner(page)).toContainText('Its robots.txt blocks a crawler AI search needs.');

  // The list shows the example's own questions, each ticked for its draft.
  await expect(listed(page)).toHaveText(EXAMPLE_QUESTIONS);
  for (const question of EXAMPLE_QUESTIONS) await expect(tick(page, question)).toBeChecked();

  // See blockers lands on the first blocker on Your site.
  await banner(page).getByRole('link', { name: 'See blockers' }).click();
  await expectAt(page, '/site/#first-issue');
  const first = page.locator('#first-issue');
  await expect(first).toContainText('AI crawlers allowed');
  await expect(first).toBeInViewport();
});

test("the step cards open the example's details, even after a reload, and store none of its inputs", async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Try it with an example' }).click();

  await stepCard(page, 'Your draft').getByRole('link').click();
  await expectAt(page, '/draft/#start-here');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bitter espresso');
  await expect(coveredHeading(page)).toHaveText('Questions covered: 0 of 4');
  // The link lands on Start here, which appears once the draft is analyzed.
  await expect(page.locator('#start-here')).toBeInViewport();

  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await stepCard(page, 'Your site').getByRole('link').click();
  await expectAt(page, '/site/');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('status')).toHaveText('1 blockerExample');
  await expect(results.getByRole('listitem', { name: 'AI crawlers allowed' })).toContainText(
    'Blocked: PerplexityBot.',
  );
  await expect(page.getByText('Paste again to see details')).toHaveCount(0);

  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await stepCard(page, 'Results').getByRole('link').click();
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
  const stored = await storedText(page);
  expect(stored).not.toContain('PerplexityBot');
  expect(stored).not.toContain('reddit.com');
});

test('typing your own questions while the example is open starts My post, and a tick puts one on its list', async ({
  page,
}) => {
  const grind = 'How fine should I grind for espresso?';
  const sour = 'Why is my espresso sour?';
  await page.getByRole('button', { name: 'Try it with an example' }).click();
  await expect(listed(page)).toHaveText(EXAMPLE_QUESTIONS);

  // The first change to the box starts fresh: My post is open, and the example's own
  // summaries are gone from the home.
  await box(page).fill(`${grind}\n${sour}`);
  await expect(page.getByText('This is the example.')).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);
  for (const name of ['Your draft', 'Your site', 'Results'] as const) {
    await expect(stepCard(page, name)).not.toContainText('Example');
  }
  // The typed questions list unticked: My post's list is empty.
  await expect(listed(page)).toHaveText([grind, sour]);
  await expect(tick(page, grind)).not.toBeChecked();
  await expect(tick(page, sour)).not.toBeChecked();

  // My post with a titled draft and no list measures its title, which our tests did not use.
  await go(page, '/draft/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your draft');
  await expect(page.getByText('No content yet')).toBeVisible();
  await typeDraft(
    page,
    '# How fine should espresso be ground?\n\nA fine grind slows the shot down and pulls more out of the coffee.\n',
  );
  await expect(coveredHeading(page)).toBeVisible();
  await expect(page.getByText("From your title. Add your readers' own.")).toBeVisible();
  await expect(cardChipsOf(page)).toHaveText(cardChips(QUESTION_LABELS.page));

  // A tick on the home puts the typed question on My post's list, as the reader's own.
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await tick(page, grind).check();
  await expect(tick(page, sour)).not.toBeChecked();
  await expect(stepCard(page, 'Your draft')).toContainText('1 of 1 covered');
  await stepCard(page, 'Your draft').getByRole('link').click();
  await expectAt(page, '/draft/#start-here');
  await expect(coveredHeading(page)).toHaveText('Questions covered: 1 of 1');
  await expect(questionsCard(page).getByRole('article')).toHaveAccessibleName(grind);
  await expect(page.getByText("From your title. Add your readers' own.")).toHaveCount(0);
  await expect(cardChipsOf(page)).toHaveText(cardChips(QUESTION_LABELS.reader));

  // The example kept its own questions.
  await openExample(page);
  const rows = questionsCard(page).getByRole('article');
  await expect(rows).toHaveCount(EXAMPLE_QUESTIONS.length);
  for (const [i, question] of EXAMPLE_QUESTIONS.entries()) {
    await expect(rows.nth(i)).toHaveAccessibleName(question);
  }
});

test('Start fresh leaves nothing marked Example on the home', async ({ page }) => {
  await page.getByRole('button', { name: 'Try it with an example' }).click();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.getByText('This is the example.')).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);
  for (const name of ['Your draft', 'Your site', 'Results'] as const) {
    await expect(stepCard(page, name)).toContainText('Not checked');
    await expect(stepCard(page, name)).not.toContainText('Example');
  }
  await expect(page.getByText('No questions yet.', { exact: false })).toBeVisible();
});

test('pasted keywords become a ranked list, kept in this browser', async ({ page }) => {
  await box(page).fill(KEYWORDS);
  await expect(listed(page)).toHaveText(RANKED);
  await expect(page.getByText('5 questions, ranked by volume.', { exact: false })).toBeVisible();
  await expect(item(page, RANKED[0])).toContainText('Volume 2,400');
  for (const question of RANKED) await expect(tick(page, question)).not.toBeChecked();

  // Kept in this browser: a reload shows the same list.
  await page.reload();
  await expect(listed(page)).toHaveText(RANKED);
});

test('copy, the searches behind a question, and Ask AI into Results', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const outside: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).origin !== new URL(page.url()).origin) outside.push(req.url());
  });
  const question = 'What is the best espresso grinder for beginners?';
  await box(page).fill(KEYWORDS);
  const row = item(page, question);

  await row.getByRole('button', { name: `Copy "${question}"` }).click();
  await expect(row.getByText('Copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(question);

  const searches = row.locator('details');
  await expect(searches.getByText('espresso grinder reviews')).toBeHidden();
  await searches.getByText('Searches behind this question').click();
  await expect(searches.getByText('espresso grinder reviews')).toBeVisible();
  await expect(
    searches.getByText('Answer engines often search for these before answering.', { exact: false }),
  ).toBeVisible();

  await row.getByRole('button', { name: `Ask AI: ${question}` }).click();
  const askSteps = row.getByRole('list', { name: 'Ask AI' });
  await expect(askSteps.getByRole('listitem')).toHaveCount(3);
  await askSteps.getByRole('link', { name: 'Results' }).click();
  await expectAt(page, '/cited/');
  await expect(page.getByRole('textbox', { name: 'Question 1', exact: true })).toHaveValue(
    question,
  );
  expect(outside).toEqual([]);
});

test('imports a Search Console export in the browser and ranks it in', async ({ page }) => {
  await box(page).fill(KEYWORDS);
  await page.getByLabel('Import CSV').setInputFiles({
    name: 'Queries.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Top queries,Clicks,Impressions,CTR,Position\nespresso grind size,12,2310,0.52%,11.2\n',
    ),
  });
  await expect(page.getByText('Imported 1 query from Queries.csv.')).toBeVisible();
  await expect(listed(page).nth(1)).toHaveText('espresso grind size');
  await expect(item(page, 'espresso grind size')).toContainText('2,310 impressions');
  await expect(item(page, 'espresso grind size')).toContainText('Search Console');

  // The x forgets the import; the typed keywords stay.
  await page.getByRole('button', { name: 'Remove the imported queries' }).click();
  await expect(listed(page)).toHaveText(RANKED);
});

test("See blockers lands on your site's stored result after a reload", async ({ page }) => {
  await go(page, '/site/');
  await page.getByLabel('robots.txt (optional)').fill(BLOCKED_PAGE.robots);
  await page.getByLabel('Page HTML').fill(BLOCKED_PAGE.html);
  await expect(page.locator('#first-issue')).toHaveCount(1);
  // A reload forgets the pasted HTML; the stored summary stays.
  await page.reload();
  await expect(page.getByText('Paste again to see details')).toBeVisible();
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await expect(banner(page)).toContainText('A blocker on your page');
  await expect(stepCard(page, 'Your site')).toContainText('1 blocker');
  await banner(page).getByRole('link', { name: 'See blockers' }).click();
  await expectAt(page, '/site/#first-issue');
  const target = page.locator('#first-issue');
  await expect(target).toHaveCount(1);
  await expect(target).toContainText('Paste again to see details');
});

test('two blockers on your own page: the banner counts them and gives the first reason', async ({
  page,
}) => {
  await go(page, '/site/');
  await page.getByLabel('robots.txt (optional)').fill(BLOCKED_PAGE.robots);
  await page
    .getByLabel('Page HTML')
    .fill(BLOCKED_PAGE.html.replace('<head>', '<head><meta name="robots" content="noindex">'));
  await expect(page.getByRole('region', { name: 'Results' }).getByRole('status')).toHaveText(
    '2 blockers',
  );
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await expect(banner(page)).toContainText('2 blockers on your page');
  await expect(banner(page)).toContainText(
    'Its robots.txt blocks a crawler AI search needs, and 1 more.',
  );
  await expect(stepCard(page, 'Your site')).toContainText('2 blockers');
});

test("See blockers' anchor scrolls to the first blocker once the pasted page is checked", async ({
  page,
}) => {
  // A long page whose only blocker is the crawler check, low enough to need a scroll.
  await page.setViewportSize({ width: 1280, height: 500 });
  await go(page, '/site/#first-issue');
  await page.getByLabel('robots.txt (optional)').fill(BLOCKED_PAGE.robots);
  await page.getByLabel('Page HTML').fill(BLOCKED_PAGE.html);
  const first = page.locator('#first-issue');
  await expect(first).toHaveCount(1);
  await expect(first).toContainText('AI crawlers allowed');
  await expect(first).toBeInViewport();
});

test('an older build’s stored values migrate: no score, the draft summary recomputed, baselines gone', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const at = '2026-10-24T10:00:00.000Z';
  // What the older build stored for a visitor on the example: a score summary, a pass count
  // and a score baseline.
  await page.evaluate((at) => {
    const s = window.localStorage;
    s.setItem('ce:v1:active-slot', 'espresso-bitterness');
    s.setItem(
      'ce:v1:summary:draft',
      JSON.stringify({
        slot: 'espresso-bitterness',
        score: 37,
        baseline: 30,
        openStartHere: 3,
        example: true,
        at,
      }),
    );
    s.setItem(
      'ce:v1:summary:site',
      JSON.stringify({ pass: 5, warn: 1, fail: 1, total: 7, needsLiveSite: 1, example: true, at }),
    );
    s.setItem('ce:v1:baseline:espresso-bitterness', JSON.stringify({ standard: 30 }));
  }, at);
  await go(page, '/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What will your readers ask?');
  await expect(stepCard(page, 'Your draft')).toContainText('of 4 covered');
  await expect(stepCard(page, 'Your site')).toContainText('Not checked');
  const text = await pageText(page);
  expect(text).not.toContain('/ 100');
  expect(text).not.toMatch(/\d+ of \d+ pass/);
  expect(
    await page.evaluate(() => window.localStorage.getItem('ce:v1:baseline:espresso-bitterness')),
  ).toBeNull();
  const draft = JSON.parse(
    (await page.evaluate(() => window.localStorage.getItem('ce:v1:summary:draft'))) ?? 'null',
  );
  expect(draft).toMatchObject({ slot: 'espresso-bitterness', total: 4, example: true });
  expect(draft).not.toHaveProperty('score');
  expect(await page.evaluate(() => window.localStorage.getItem('ce:v1:summary:site'))).toBeNull();
  expect(errors).toEqual([]);
});

test('a returning visit that starts on the home lands on the last view', async ({ page }) => {
  await go(page, '/site/');
  await go(page, '/');
  await expectAt(page, '/site/');

  // Coming back to the home within the visit stays on the home.
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await expectAt(page, '/');
  await expect(steps(page)).toBeVisible();
});

test('a returning visit lands on the draft view when that was the last one', async ({
  page,
  context,
}) => {
  await page.getByRole('button', { name: 'Try it with an example' }).click();
  await stepCard(page, 'Your draft').getByRole('link').click();
  await expectAt(page, '/draft/#start-here');
  // A new tab is a new visit; the stored last view survives it.
  const later = await context.newPage();
  await go(later, '/');
  await expectAt(later, '/draft/');
  await expect(later.getByRole('heading', { level: 1 })).toHaveText('Bitter espresso');
});
