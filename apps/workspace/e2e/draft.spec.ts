import { expect, test } from '@playwright/test';
import {
  ADVICE,
  CAVEAT,
  CHANCE,
  card,
  draftText,
  freshVisit,
  go,
  HEADING_EDIT,
  openExample,
  pick,
  startHere,
} from './support';

// The draft view on the built site: the full fix flow (Preview, Apply, Undo, Done, Skip), the
// Test it caveats and the keyboard path to the first Preview. Literal strings are the shipped
// copy; the global constraints fix the caveat word for word, so a change to it fails here.

test.beforeEach(async ({ page }) => {
  await freshVisit(page);
});

test('a new visitor gets the empty My post, not the example', async ({ page }) => {
  await go(page, '/draft/');
  await expect(page.getByText('No content yet')).toBeVisible();
  expect((await draftText(page)).trim()).toBe('');
});

test('pasting your own post over the example moves it to My post', async ({ page }) => {
  await openExample(page);
  const example = await draftText(page);
  const content = page.locator('.cm-content[aria-label="Draft text"]');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await content.evaluate((el) => {
    const data = new DataTransfer();
    data.setData(
      'text/html',
      '<h1>Sourdough at home</h1><h2>Why is my loaf dense?</h2><p>Most dense loaves are underproofed.</p>',
    );
    data.setData('text/plain', 'Sourdough at home');
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your draft');
  await expect(page.getByText('This is an example post.')).toHaveCount(0);
  await expect.poll(() => draftText(page)).toContain('# Sourdough at home');
  await expect(page.getByRole('status', { name: 'Last action' })).toContainText(
    'Moved to My post.',
  );

  // The home shows My post, not the example.
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My post');
  await expect(page.getByRole('region', { name: 'Your draft', exact: true })).not.toContainText(
    'Example',
  );

  // The example is as it was, and Reset to example leaves My post alone.
  await openExample(page);
  expect(await draftText(page)).toBe(example);
  await page.getByRole('button', { name: 'Reset to example' }).click();
  const mine = await page.evaluate(() => window.localStorage.getItem('ce:v1:draft:my-draft'));
  expect(mine).toContain('# Sourdough at home');
});

test('draft flow: Preview, Apply, Undo, Done and Skip, and a reload keeps them', async ({
  page,
}) => {
  await openExample(page);
  await expect(page.getByRole('img', { name: /^AI-ready score: \d+ out of 100$/ })).toBeVisible();
  // Nothing has Apply until a preview is open.
  await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
  const toast = page.getByRole('status', { name: 'Last action' });

  // Preview, then Apply: one heading changes, and only that one.
  const before = await draftText(page);
  expect(before).toContain('## Why espresso turns bitter\n');
  await card(page, HEADING_EDIT).getByRole('button', { name: 'Preview' }).click();
  const dialog = page.getByRole('dialog', { name: HEADING_EDIT });
  await expect(dialog).toContainText('Nothing changes until you click Apply.');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect
    .poll(() => draftText(page))
    .toBe(before.replace('## Why espresso turns bitter\n', '## Why espresso turns bitter?\n'));
  await expect(card(page, HEADING_EDIT)).toHaveCount(0);
  await expect(toast).toContainText('Applied.');

  // Undo in the toast puts the text back; apply it again.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => draftText(page)).toBe(before);
  await card(page, HEADING_EDIT).getByRole('button', { name: 'Preview' }).click();
  await page
    .getByRole('dialog', { name: HEADING_EDIT })
    .getByRole('button', { name: 'Apply' })
    .click();
  await expect.poll(() => draftText(page)).toContain('## Why espresso turns bitter?');

  // Skip one fix from its overflow menu.
  await pick(page, ADVICE, 'Skip');
  await expect(card(page, ADVICE)).toHaveCount(0);
  await expect(toast).toContainText('Skipped.');

  // Mark the first advice card left in Start here as Done. Done never changes the text.
  const advice = startHere(page)
    .getByRole('article')
    .filter({ has: page.getByRole('button', { name: 'Show me' }) })
    .first();
  const doneTitle = (await advice.getByRole('heading').textContent())?.trim() ?? '';
  expect(doneTitle).not.toBe('');
  const text = await draftText(page);
  await pick(page, doneTitle, 'Done');
  await expect(card(page, doneTitle)).toHaveCount(0);
  await expect(toast).toContainText('Done.');
  expect(await draftText(page)).toBe(text);
  // Undo brings the card back; Done again.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, doneTitle)).toBeVisible();
  await pick(page, doneTitle, 'Done');
  await expect(card(page, doneTitle)).toHaveCount(0);

  // After a reload the saved draft keeps the "?", and the skipped and done fixes stay handled.
  // An applied edit is not a saved status.
  await page.reload();
  await expect.poll(() => draftText(page)).toContain('## Why espresso turns bitter?');
  await expect(startHere(page)).toBeVisible();
  await expect(card(page, ADVICE)).toHaveCount(0);
  await expect(card(page, doneTitle)).toHaveCount(0);
  const groups = page.getByRole('region', { name: 'All fixes' });
  await groups.getByRole('button', { name: /^Real numbers/ }).click();
  await expect(groups).toContainText('Skipped:');
});

test('Test it shows the recorded result with its caveats', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: /^Test it/ }).click();
  const test = page.getByRole('region', { name: 'Test it' });
  await expect(test).toContainText(CHANCE);
  await expect(test).toContainText(CAVEAT);
});

test('keyboard: Tab reaches the first Preview button and its focus ring is visible', async ({
  page,
}) => {
  await openExample(page);
  await expect(card(page, HEADING_EDIT)).toBeVisible();
  // Buttons animate their ring (transition-all); measure end states, not a frame mid-transition.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  let reached = false;
  for (let i = 0; i < 400 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLButtonElement && el.textContent?.trim() === 'Preview';
    });
  }
  expect(reached, 'Tab never reached a Preview button').toBe(true);
  const firstPreview = startHere(page).getByRole('button', { name: 'Preview' }).first();
  await expect(firstPreview).toBeFocused();
  const ringStyle = (el: Element) => {
    const s = getComputedStyle(el);
    return `${s.boxShadow}|${s.outlineStyle} ${s.outlineWidth}`;
  };
  expect(await firstPreview.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  const focused = await firstPreview.evaluate(ringStyle);
  await firstPreview.blur();
  const resting = await firstPreview.evaluate(ringStyle);
  expect(focused).not.toBe(resting);

  // Enter opens the preview from the keyboard, and Escape closes it without a change.
  const text = await draftText(page);
  await firstPreview.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: HEADING_EDIT });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await draftText(page)).toBe(text);
});
