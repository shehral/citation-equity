import { expect, type Page, test } from '@playwright/test';

// Smoke test of the built static site (playwright.config.ts serves out/).
// Literal strings below are the shipped copy; the global constraints fix the
// caveat word for word, so a change to it should fail here.

const CAVEAT =
  'Content check on a local model over a fixed page set. It does not predict live AI engines.';
const HEADING_EDIT = 'End this heading with "?", or reword it as a question';
const ADVISORY = 'Name who said this';
const PAGES = ['/', '/evidence', '/site', '/off-page', '/about'];
const RETIRED_GRADE = ['contra', 'dicted'].join('');

/** The draft as CodeMirror shows it, one line per .cm-line. */
async function draftText(page: Page) {
  return (await page.locator('.cm-content .cm-line').allInnerTexts()).join('\n');
}

const suggestions = (page: Page) => page.getByRole('region', { name: /^Suggestions/ });
const card = (page: Page, title: string) =>
  suggestions(page).getByRole('article', { name: title, exact: true });
const handled = (page: Page) => suggestions(page).locator('details');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test('workspace: sample, score, apply one edit, ignore one advisory, reload keeps them', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Why does my espresso taste bitter?',
  );
  const score = page.getByRole('region', { name: /^GEO Score/ });
  await expect(score).toContainText(/\d+\s*\/ 100/);
  await expect(suggestions(page).getByRole('article').first()).toBeVisible();

  // Apply the one deterministic edit: the heading gains its "?".
  expect(await draftText(page)).toContain('## Why espresso turns bitter\n');
  await card(page, HEADING_EDIT).getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => draftText(page)).toContain('## Why espresso turns bitter?');
  await expect(card(page, HEADING_EDIT)).toHaveCount(0);
  await handled(page).locator('summary').click();
  await expect(handled(page)).toContainText(`Applied: ${HEADING_EDIT}`);

  // Ignore one advisory.
  await card(page, ADVISORY).getByRole('button', { name: 'Ignore' }).click();
  await expect(card(page, ADVISORY)).toHaveCount(0);
  await expect(handled(page)).toContainText(`Ignored: ${ADVISORY}`);

  // After a reload the saved draft keeps the "?", and the ignored card stays
  // handled. An applied edit is not a saved status (Ruling R16).
  await page.reload();
  await expect.poll(() => draftText(page)).toContain('## Why espresso turns bitter?');
  await expect(card(page, ADVISORY)).toHaveCount(0);
  await handled(page).locator('summary').click();
  await expect(handled(page)).toContainText(`Ignored: ${ADVISORY}`);
});

test('workspace: the bench panel shows the recorded runs with the caveat', async ({ page }) => {
  const bench = page.getByRole('region', { name: /bench/i }).first();
  await expect(bench).toContainText(CAVEAT);
  await expect(bench).toContainText(/chance level/i);
});

test('keyboard: Tab reaches the first Apply button and its focus ring is visible', async ({
  page,
}) => {
  await expect(suggestions(page).getByRole('article').first()).toBeVisible();
  // Buttons animate their ring (transition-all); measure end states, not a frame mid-transition.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  let reached = false;
  for (let i = 0; i < 400 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLButtonElement && el.textContent?.trim() === 'Apply';
    });
  }
  expect(reached, 'Tab never reached an Apply button').toBe(true);
  // The first Apply in tab order is the first edit card's.
  const firstApply = suggestions(page).getByRole('button', { name: 'Apply' }).first();
  await expect(firstApply).toBeFocused();
  // The ring is visible: focused, the button draws a box shadow or outline it lacks at rest.
  const ringStyle = (el: Element) => {
    const s = getComputedStyle(el);
    return `${s.boxShadow}|${s.outlineStyle} ${s.outlineWidth}`;
  };
  expect(await firstApply.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  const focused = await firstApply.evaluate(ringStyle);
  await firstApply.blur();
  const resting = await firstApply.evaluate(ringStyle);
  expect(focused).not.toBe(resting);
});

test('/evidence lists all ten checks with a grade each', async ({ page }) => {
  await page.goto('/evidence');
  await expect(page.getByText(/^Evidence: (strong|moderate|mixed|untested)$/)).toHaveCount(10);
});

test('/site renders the seven readiness items and reads pasted HTML in the page', async ({
  page,
}) => {
  await page.goto('/site');
  // The command-line block is real text, not a client reference rendered as a function.
  await expect(page.locator('main')).toContainText('ce site https://example.com/your-page --json');
  await expect(page.locator('body')).not.toContainText('Attempted to call');
  const titles = [
    'Byline',
    'Publication dates',
    'Structured data',
    'Indexing directives',
    'Canonical URL',
    'AI crawler access',
    'Renders without JavaScript',
  ];
  for (const title of titles) {
    await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible();
  }
  await page
    .getByLabel('Page HTML')
    .fill(
      '<html><head><script type="application/ld+json">{"@type":"BlogPosting","author":{"name":"A"},"datePublished":"2026-01-01"}</script></head><body><p>x</p></body></html>',
    );
  await expect(page.getByRole('region', { name: 'Byline', exact: true })).toContainText('Pass');
  await expect(page.getByRole('region', { name: 'Structured data', exact: true })).toContainText(
    'BlogPosting',
  );
});

test('/off-page renders and parses a pasted URL list', async ({ page }) => {
  await page.goto('/off-page');
  await page.getByLabel('Question 1').fill('Why does espresso taste bitter?');
  await page
    .getByLabel('Answer 1, with its sources')
    .fill(
      [
        'https://www.reddit.com/r/espresso/comments/abc/bitter/',
        'https://en.wikipedia.org/wiki/Espresso',
        'https://www.example.com/espresso.',
      ].join('\n'),
    );
  await page.getByLabel('Your site').fill('example.com');
  const report = page.getByRole('region', { name: 'Who gets cited' });
  await expect(report).toContainText('1 answer to 1 question');
  await expect(report).toContainText('Your site (example.com) is cited in 1 of 1 answer.');
  await expect(report.getByRole('row', { name: /reddit\.com/ })).toBeVisible();
  await expect(report.getByRole('row', { name: /wikipedia\.org/ })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'What to do: Forums and Q&A sites' }),
  ).toBeVisible();
});

for (const path of PAGES) {
  test(`${path}: no request leaves the origin on load, and no page uses the retired grade word`, async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    const outside: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.protocol === 'data:' || url.protocol === 'blob:') return;
      if (url.origin !== origin) outside.push(req.url());
    });
    await page.goto(path, { waitUntil: 'networkidle' });
    expect(outside).toEqual([]);
    const text = (await page.locator('body').textContent()) ?? '';
    expect(text.toLowerCase()).not.toContain(RETIRED_GRADE);
  });
}

for (const width of [375, 390]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`at ${width} px (${colorScheme}), no page scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme });
      for (const path of PAGES) {
        await page.goto(path);
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, `${path} scrolls sideways`).toBeLessThanOrEqual(clientWidth);
      }
    });
  }
}
