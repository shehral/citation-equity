import { expect, type Page, test } from '@playwright/test';
import {
  ADVICE,
  card,
  draftText,
  freshVisit,
  go,
  HEADING_EDIT,
  headingEdit,
  openExample,
  pick,
  ROUTES,
  scrollsSideways,
  startHere,
} from './support';

// Phones: a one-row header, stacked tiles, the draft view's Draft / Fixes switch, the
// bar shown after a jump to a passage, and no sideways scroll on any route at 390 px (and 375).

const PHONE = { width: 390, height: 844 };
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
  await freshVisit(page);
});

const panes = (page: Page) => page.getByRole('group', { name: 'Draft or fixes' });
const paneButton = (page: Page, name: 'Draft' | 'Fixes') =>
  panes(page).getByRole('button', { name: new RegExp(`^${name}`) });
const bar = (page: Page) => page.getByRole('region', { name: 'Selected fix' });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Draft text' });

/** The header is one row: its own height, nothing wrapped below and nothing cut off at the side. */
async function expectOneRowHeader(page: Page, route: string) {
  // The shell's header comes first; a locator, not the banner role, so About's modal (which
  // hides the page from the accessibility tree) does not hide it.
  const header = page.locator('header').first();
  const box = await header.boundingBox();
  expect(box?.height, `${route} header height`).toBeLessThanOrEqual(64);
  const fits = await header.evaluate((el) => {
    const row = el.firstElementChild as HTMLElement;
    const { top, bottom } = row.getBoundingClientRect();
    const items = [...row.querySelectorAll<HTMLElement>('a, button')].filter(
      (i) => i.getClientRects().length > 0,
    );
    return {
      clipped: row.scrollWidth > row.clientWidth,
      outside: items
        .filter((i) => {
          const r = i.getBoundingClientRect();
          return r.top < top || r.bottom > bottom || r.right > window.innerWidth;
        })
        .map((i) => i.getAttribute('aria-label') ?? i.textContent),
    };
  });
  expect(fits, `${route} header`).toEqual({ clipped: false, outside: [] });
}

test('the header stays on one row on every route, with and without the view tabs', async ({
  page,
}) => {
  for (const route of ROUTES) {
    await go(page, route);
    await expectOneRowHeader(page, route);
  }
  // The tabs join the header once a view has been opened; still one row on the home.
  await go(page, '/draft/');
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
  await expectOneRowHeader(page, '/ (with tabs)');
});

test('the home tiles stack in one column', async ({ page }) => {
  const tiles = ['Your draft', 'Your site', 'Who gets cited'].map((name) =>
    page.getByRole('region', { name, exact: true }),
  );
  const boxes = await Promise.all(tiles.map((t) => t.boundingBox()));
  const [a, b, c] = boxes;
  if (!a || !b || !c) throw new Error('a tile is not on screen');
  expect(b.x).toBe(a.x);
  expect(c.x).toBe(a.x);
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  expect(c.y).toBeGreaterThanOrEqual(b.y + b.height);
});

test('an empty draft shows the editor and the empty rail, with no switch', async ({ page }) => {
  await go(page, '/draft/');
  await expect(page.getByText('No content yet')).toBeVisible();
  await expect(editor(page)).toBeVisible();
  await expect(panes(page)).toBeHidden();
});

test('Draft / Fixes switch: the example opens on its fixes, and each tap shows one column', async ({
  page,
}) => {
  await openExample(page);
  await expect(paneButton(page, 'Fixes')).toHaveAttribute('aria-pressed', 'true');
  await expect(startHere(page)).toBeVisible();
  await expect(editor(page)).toBeHidden();
  // The score and the first fix are on the first screen.
  await expect(page.getByRole('img', { name: /^AI-ready score/ })).toBeInViewport();
  await expect(startHere(page).getByRole('article').first()).toBeInViewport();

  await paneButton(page, 'Draft').tap();
  await expect(paneButton(page, 'Draft')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page)).toBeVisible();
  await expect(startHere(page)).toBeHidden();

  // Keyboard works as well as touch.
  await paneButton(page, 'Fixes').focus();
  await page.keyboard.press('Enter');
  await expect(startHere(page)).toBeVisible();
  await expect(editor(page)).toBeHidden();
});

test('Show me jumps to the passage and the bar offers Done and Back to fixes', async ({ page }) => {
  await openExample(page);
  await card(page, ADVICE).getByRole('button', { name: 'Show me' }).tap();
  await expect(editor(page)).toBeVisible();
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText(ADVICE);
  // The passage is selected and on screen above the bar.
  const active = page.locator('.cm-ce-highlight-active').first();
  await expect(active).toBeInViewport();
  const barTop = (await bar(page).boundingBox())?.y ?? 0;
  expect((await active.boundingBox())?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(barTop);

  const text = await draftText(page);
  await bar(page).getByRole('button', { name: 'Done' }).tap();
  await expect(bar(page)).toBeHidden();
  await expect(page.getByRole('status', { name: 'Last action' })).toContainText('Done.');
  expect(await draftText(page)).toBe(text);

  await paneButton(page, 'Fixes').tap();
  await expect(card(page, ADVICE)).toHaveCount(0);

  // Back to fixes returns to the rail at the card the jump came from.
  const next = startHere(page)
    .getByRole('article')
    .filter({ has: page.getByRole('button', { name: 'Show me' }) })
    .first();
  await next.getByRole('button', { name: 'Show me' }).tap();
  await bar(page).getByRole('button', { name: 'Back to fixes' }).tap();
  await expect(bar(page)).toBeHidden();
  await expect(paneButton(page, 'Fixes')).toHaveAttribute('aria-pressed', 'true');
  await expect(next).toBeInViewport();
});

test("an edit's Show me leads to Preview in the bar, and Apply stays in the preview", async ({
  page,
}) => {
  await openExample(page);
  const before = await draftText(page);
  await pick(page, await headingEdit(page), 'Show me');
  await expect(bar(page)).toContainText(HEADING_EDIT);
  await expect(bar(page).getByRole('button', { name: 'Done' })).toHaveCount(0);
  await bar(page).getByRole('button', { name: 'Preview' }).tap();
  const dialog = page.getByRole('dialog', { name: HEADING_EDIT });
  await expect(dialog).toContainText('Nothing changes until you click Apply.');
  expect(await draftText(page)).toBe(before);
  await dialog.getByRole('button', { name: 'Apply' }).tap();
  await expect.poll(() => draftText(page)).toContain('## Why espresso turns bitter?');
});

// The bar's buttons go with the bar, so each one hands focus on instead of dropping it on the
// page: a keyboard user (or a desktop zoomed past 1024 px) keeps their place.
test('from the keyboard, Back to fixes, Done and Preview in the bar keep focus on the page', async ({
  page,
}) => {
  await openExample(page);
  const showMe = card(page, ADVICE).getByRole('button', { name: 'Show me' });

  // Back to fixes: focus is on the card the jump came from, at its main button.
  await showMe.focus();
  await page.keyboard.press('Enter');
  await bar(page).getByRole('button', { name: 'Back to fixes' }).focus();
  await page.keyboard.press('Enter');
  await expect(bar(page)).toBeHidden();
  await expect(showMe).toBeFocused();
  await expect(showMe).toBeInViewport();

  // Done: the card leaves the rail, so focus is on the switch's Fixes button.
  await page.keyboard.press('Enter');
  await bar(page).getByRole('button', { name: 'Done' }).focus();
  await page.keyboard.press('Enter');
  await expect(bar(page)).toBeHidden();
  await expect(paneButton(page, 'Fixes')).toBeFocused();

  // Preview: closing it (Escape here) puts focus on the Fixes button too.
  await page.keyboard.press('Enter');
  await pick(page, await headingEdit(page), 'Show me');
  await bar(page).getByRole('button', { name: 'Preview' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: HEADING_EDIT });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(paneButton(page, 'Fixes')).toBeFocused();

  // And after Apply.
  await page.keyboard.press('Enter');
  await pick(page, await headingEdit(page), 'Show me');
  await bar(page).getByRole('button', { name: 'Preview' }).focus();
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Apply' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(paneButton(page, 'Fixes')).toBeFocused();
  await expect.poll(() => draftText(page)).toContain('## Why espresso turns bitter?');
});

for (const width of [375, 390]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`at ${width} px (${colorScheme}), no route scrolls sideways, empty or with the example`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme });
      for (const route of ROUTES) {
        await go(page, route);
        await expect(page.locator('main').first()).toBeVisible();
        expect(await scrollsSideways(page), `${route} (empty) scrolls sideways`).toBe(false);
      }
      await go(page, '/');
      await page.getByRole('button', { name: 'Try it with an example' }).click();
      await expect(page.getByRole('region', { name: 'Next up' })).toBeVisible();
      expect(await scrollsSideways(page), '/ (example) scrolls sideways').toBe(false);
      // The draft view last, so its columns and bar are checked next.
      for (const route of ['/site/', '/cited/', '/draft/']) {
        await go(page, route);
        await expect(page.locator('main').first()).toBeVisible();
        expect(await scrollsSideways(page), `${route} (example) scrolls sideways`).toBe(false);
      }
      // Both columns of the draft view, and the bar after a jump.
      await expect(startHere(page)).toBeVisible();
      await paneButton(page, 'Draft').click();
      expect(await scrollsSideways(page), '/draft/ (Draft column) scrolls sideways').toBe(false);
      await paneButton(page, 'Fixes').click();
      await card(page, ADVICE).getByRole('button', { name: 'Show me' }).click();
      await expect(bar(page)).toBeVisible();
      expect(await scrollsSideways(page), '/draft/ (with the bar) scrolls sideways').toBe(false);
    });
  }
}
