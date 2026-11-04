import { expect, type Page, test } from '@playwright/test';
import {
  coveredHeading,
  draftText,
  freshVisit,
  go,
  HEADING_EDIT,
  HEADING_GROUP,
  noteGroup,
  openExample,
  PARAGRAPHS_GROUP,
  pick,
  questionRow,
  quickCard,
  ROUTES,
  scrollsSideways,
  startHere,
} from './support';

// Phones: a one-row header, the home in one column, the draft view's Draft / Questions switch,
// the bar shown after a jump to a passage, and no sideways scroll on any route at 390 px (and 375).

const PHONE = { width: 390, height: 844 };
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
  await freshVisit(page);
});

const panes = (page: Page) => page.getByRole('group', { name: 'Draft or questions' });
const paneButton = (page: Page, name: 'Draft' | 'Questions') =>
  panes(page).getByRole('button', { name: new RegExp(`^${name}`) });
const bar = (page: Page) => page.getByRole('region', { name: 'Selected fix' });
const back = (page: Page) => bar(page).getByRole('button', { name: 'Back to questions and notes' });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Draft text' });

/** The example's first advice note (its main button is Show me), in a group of advice only. */
async function adviceNote(page: Page) {
  return (await noteGroup(page, PARAGRAPHS_GROUP)).getByRole('article').first();
}

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

test('the home is one column: the input card, the step cards stacked, then the list', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Try it with an example' }).click();
  const steps = page.getByRole('region', { name: 'Next steps' });
  const order = [
    page.getByRole('region', { name: 'Blocker' }),
    page.getByRole('region', { name: "Your readers' questions" }),
    ...['Your draft', 'Your site', 'Results'].map((name) =>
      steps.getByRole('region', { name, exact: true }),
    ),
    page.getByRole('region', { name: 'Your questions', exact: true }),
  ];
  const boxes = await Promise.all(order.map((l) => l.boundingBox()));
  for (const [i, box] of boxes.entries()) {
    const above = boxes[i - 1];
    if (!box) throw new Error(`item ${i} is not on screen`);
    if (!above) continue;
    expect(box.x, `item ${i} starts its own row`).toBe(above.x);
    expect(box.y, `item ${i} sits below the one before`).toBeGreaterThanOrEqual(
      above.y + above.height,
    );
  }
});

test('a filled question list, a disclosure open, does not scroll sideways', async ({ page }) => {
  await page
    .getByRole('textbox', { name: "Your readers' questions" })
    .fill(
      'best espresso grinder for beginners, 720\nWhich is better for a small kitchen, a lever or a pump espresso machine?',
    );
  const list = page.getByRole('list', { name: 'Your questions, ranked' });
  await expect(list.locator(':scope > li')).toHaveCount(2);
  await list.locator('details summary').first().click();
  await expect(list.locator('details').first()).toHaveAttribute('open');
  expect(await scrollsSideways(page)).toBe(false);
});

test('an empty draft shows the editor and the empty rail, with no switch', async ({ page }) => {
  await go(page, '/draft/');
  await expect(page.getByText('No content yet')).toBeVisible();
  await expect(editor(page)).toBeVisible();
  await expect(panes(page)).toBeHidden();
});

test('Draft / Questions switch: the example opens on its questions with the card in view, and each tap shows one column', async ({
  page,
}) => {
  await openExample(page);
  await expect(paneButton(page, 'Draft')).toHaveText('Draft');
  await expect(paneButton(page, 'Questions')).toHaveAccessibleName(
    /^Questions\b.*, 4 not covered$/,
  );
  await expect(paneButton(page, 'Questions')).toHaveAttribute('aria-pressed', 'true');
  await expect(startHere(page)).toBeVisible();
  await expect(editor(page)).toBeHidden();
  // The card and its first question are on the first screen.
  await expect(coveredHeading(page)).toBeInViewport();
  await expect(questionRow(page, 'Why does my espresso taste bitter?')).toBeInViewport();

  await paneButton(page, 'Draft').tap();
  await expect(paneButton(page, 'Draft')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page)).toBeVisible();
  await expect(startHere(page)).toBeHidden();

  // Keyboard works as well as touch.
  await paneButton(page, 'Questions').focus();
  await page.keyboard.press('Enter');
  await expect(startHere(page)).toBeVisible();
  await expect(editor(page)).toBeHidden();
});

test("a card line's Show leads to the draft, with a bar holding its question and Back", async ({
  page,
}) => {
  await openExample(page);
  const question = 'How do I fix bitter espresso?';
  await questionRow(page, question)
    .getByRole('button', { name: `Show where: answer, "${question}"` })
    .tap();
  await expect(editor(page)).toBeVisible();
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText(question);
  // A question line is no fix: the bar offers only Back.
  await expect(bar(page).getByRole('button')).toHaveCount(1);
  // The passage is selected and on screen above the bar.
  const selected = page.locator('.cm-selectionBackground').first();
  await expect(selected).toBeInViewport();
  const barTop = (await bar(page).boundingBox())?.y ?? 0;
  expect((await selected.boundingBox())?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(barTop);

  await back(page).tap();
  await expect(bar(page)).toBeHidden();
  await expect(paneButton(page, 'Questions')).toHaveAttribute('aria-pressed', 'true');
  await expect(coveredHeading(page)).toBeVisible();
});

test("a note's Show me gives Done in the bar for advice and Preview for an edit, and Apply stays in the preview", async ({
  page,
}) => {
  await openExample(page);
  const toast = page.getByRole('status', { name: 'Last action' });

  // Advice: Show me, then Done in the bar, which never changes the text.
  const notes = (await noteGroup(page, PARAGRAPHS_GROUP)).getByRole('article');
  const count = await notes.count();
  const title = (await notes.first().getByRole('heading').textContent()) ?? '';
  // A blank title would make the bar check below pass on any bar.
  expect(title.trim()).not.toBe('');
  await notes.first().getByRole('button', { name: 'Show me' }).tap();
  await expect(bar(page)).toContainText(title);
  await expect(bar(page).getByRole('button', { name: 'Preview' })).toHaveCount(0);
  const text = await draftText(page);
  await bar(page).getByRole('button', { name: 'Done' }).tap();
  await expect(bar(page)).toBeHidden();
  await expect(toast).toContainText('Done.');
  expect(await draftText(page)).toBe(text);
  await paneButton(page, 'Questions').tap();
  await expect(notes).toHaveCount(count - 1);

  // An edit: Show me from its overflow, then Preview in the bar; Apply is only in the preview.
  await pick(page, quickCard(page, HEADING_EDIT), 'Show me');
  await expect(bar(page)).toContainText(HEADING_EDIT);
  await expect(bar(page).getByRole('button', { name: 'Done' })).toHaveCount(0);
  await bar(page).getByRole('button', { name: 'Preview' }).tap();
  const dialog = page.getByRole('dialog', { name: HEADING_EDIT });
  await expect(dialog).toContainText('Nothing changes until you click Apply.');
  expect(await draftText(page)).toBe(text);
  await dialog.getByRole('button', { name: 'Apply' }).tap();
  await expect.poll(() => draftText(page)).toContain('## Why espresso turns bitter?');
});

// The bar's buttons go with the bar, so each one hands focus on instead of dropping it on the
// page: a keyboard user (or a desktop zoomed past 1024 px) keeps their place.
test('from the keyboard, Back, Done and Preview in the bar keep focus on the page', async ({
  page,
}) => {
  await openExample(page);
  const showMe = (await adviceNote(page)).getByRole('button', { name: 'Show me' });

  // Back: focus is on the note the jump came from, at its main button.
  await showMe.focus();
  await page.keyboard.press('Enter');
  await back(page).focus();
  await page.keyboard.press('Enter');
  await expect(bar(page)).toBeHidden();
  await expect(showMe).toBeFocused();
  await expect(showMe).toBeInViewport();

  // Done: the note leaves the rail, so focus is on the switch's Questions button.
  await page.keyboard.press('Enter');
  await bar(page).getByRole('button', { name: 'Done' }).focus();
  await page.keyboard.press('Enter');
  await expect(bar(page)).toBeHidden();
  await expect(paneButton(page, 'Questions')).toBeFocused();

  // Back from a card line, which has no note to return to: focus is on the Questions button.
  await page.keyboard.press('Enter');
  const line = page.getByRole('button', { name: /^Show where: answer, / }).first();
  await line.focus();
  await page.keyboard.press('Enter');
  await back(page).focus();
  await page.keyboard.press('Enter');
  await expect(bar(page)).toBeHidden();
  await expect(paneButton(page, 'Questions')).toBeFocused();

  // Preview: closing it (Escape here) puts focus on the Questions button too.
  await page.keyboard.press('Enter');
  await pick(page, quickCard(page, HEADING_EDIT), 'Show me');
  await bar(page).getByRole('button', { name: 'Preview' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: HEADING_EDIT });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(paneButton(page, 'Questions')).toBeFocused();

  // And after Apply.
  await page.keyboard.press('Enter');
  await pick(page, quickCard(page, HEADING_EDIT), 'Show me');
  await bar(page).getByRole('button', { name: 'Preview' }).focus();
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Apply' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(paneButton(page, 'Questions')).toBeFocused();
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
      await expect(page.getByRole('region', { name: 'Blocker' })).toBeVisible();
      expect(await scrollsSideways(page), '/ (example) scrolls sideways').toBe(false);
      // The draft view last, so its columns and bar are checked next.
      for (const route of ['/site/', '/cited/', '/research/', '/draft/']) {
        await go(page, route);
        await expect(page.locator('main').first()).toBeVisible();
        expect(await scrollsSideways(page), `${route} (example) scrolls sideways`).toBe(false);
      }
      // Both columns of the draft view, the notes opened, and the bar after a jump.
      await expect(coveredHeading(page)).toBeVisible();
      await noteGroup(page, HEADING_GROUP);
      expect(await scrollsSideways(page), '/draft/ (notes open) scrolls sideways').toBe(false);
      await paneButton(page, 'Draft').click();
      expect(await scrollsSideways(page), '/draft/ (Draft column) scrolls sideways').toBe(false);
      await paneButton(page, 'Questions').click();
      await page
        .getByRole('button', { name: /^Show where: / })
        .first()
        .click();
      await expect(bar(page)).toBeVisible();
      expect(await scrollsSideways(page), '/draft/ (with the bar) scrolls sideways').toBe(false);
    });
  }
}
