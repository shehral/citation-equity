import { expect, test } from '@playwright/test';
import {
  basePath,
  cardChips,
  cardChipsOf,
  coveredHeading,
  draftText,
  EXAMPLE_QUESTIONS,
  freshVisit,
  go,
  HEADING_EDIT,
  HEADING_GROUP,
  noteGroup,
  openExample,
  PARAGRAPHS_GROUP,
  pick,
  QUESTION_LABELS,
  questionRow,
  questionsCard,
  quickCard,
  quickEdit,
  rail,
  selectedPassage,
  TEST_LABEL_TEXT,
  TEST_LABELS,
} from './support';

// The draft view on the built site: the Questions covered card (its rows, chip and Show), the
// Quick edit (Preview, Apply, Undo), the writing notes (Done, Skip, kept after a reload), the
// keyboard path to the first Show and a paste over the example. Literal strings are the shipped
// copy; labels our tests can change come from the engine.

test.beforeEach(async ({ page }) => {
  await freshVisit(page);
});

test('a new visitor gets the empty My post, not the example', async ({ page }) => {
  await go(page, '/draft/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your draft');
  await expect(page.getByText('No content yet')).toBeVisible();
  expect((await draftText(page)).trim()).toBe('');
});

test('the example: Questions covered 0 of 4 with its chip, a words line and an answer line per question, and Show marks a passage', async ({
  page,
}) => {
  await openExample(page);
  await expect(coveredHeading(page)).toHaveText('Questions covered: 0 of 4');
  // The pack's questions are the reader's own: one chip for the card, none on the rows.
  await expect(cardChipsOf(page)).toHaveText(cardChips(QUESTION_LABELS.reader));
  const rows = questionsCard(page).getByRole('article');
  await expect(rows).toHaveCount(EXAMPLE_QUESTIONS.length);
  for (const [i, question] of EXAMPLE_QUESTIONS.entries()) {
    await expect(rows.nth(i)).toHaveAccessibleName(question);
    await expect(rows.nth(i)).toContainText('Not covered yet');
    await expect(rows.nth(i)).toContainText(/Words up top|Missing up top: /);
    await expect(rows.nth(i)).toContainText(/Answered|No direct answer yet/);
    await expect(rows.nth(i).locator('[data-label-chip]')).toHaveCount(0);
  }
  const fix = questionRow(page, 'How do I fix bitter espresso?');
  await expect(fix).toContainText('Missing up top: "fix"');

  // Show on the words line selects the top of the draft, above its first section.
  const text = await draftText(page);
  const firstSection = text.indexOf('\n## ');
  expect((await selectedPassage(page)).text).toBe('');
  await fix
    .getByRole('button', { name: 'Show where: words up top, "How do I fix bitter espresso?"' })
    .click();
  await expect.poll(async () => (await selectedPassage(page)).text).not.toBe('');
  expect((await selectedPassage(page)).from).toBeLessThan(firstSection);
  // Show on an answer line selects the passage, in a section, that matches the question.
  const bitter = 'Why does my espresso taste bitter?';
  await questionRow(page, bitter)
    .getByRole('button', { name: `Show where: answer, "${bitter}"` })
    .click();
  await expect.poll(async () => (await selectedPassage(page)).from).toBeGreaterThan(firstSection);
  expect((await selectedPassage(page)).text).toContain('bitter');
  await expect(page.locator('.cm-content[aria-label="Draft text"]')).toBeFocused();
  // Selecting is not editing.
  expect(await draftText(page)).toBe(text);

  // The rail sends the bench to Results.
  await expect(rail(page).getByRole('link', { name: 'Test it' })).toHaveAttribute(
    'href',
    `${basePath()}cited/#test`,
  );
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

  // The home's draft card shows My post, not the example.
  await page.getByRole('link', { name: 'Citation Equity home' }).click();
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

test('Quick edit: Preview, Apply and Undo; writing notes: Done and Skip, kept after a reload', async ({
  page,
}) => {
  await openExample(page);
  // The one ready edit, with its note's label chip.
  const edit = quickCard(page, HEADING_EDIT);
  await expect(edit.locator('[data-label-chip]')).toHaveText(
    TEST_LABEL_TEXT[TEST_LABELS['question-headings']],
  );
  // Nothing has Apply until a preview is open.
  await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
  const toast = page.getByRole('status', { name: 'Last action' });

  // Preview, then Apply: one heading changes, and only that one.
  const before = await draftText(page);
  expect(before).toContain('## Why espresso turns bitter\n');
  await edit.getByRole('button', { name: 'Preview' }).click();
  const dialog = page.getByRole('dialog', { name: HEADING_EDIT });
  await expect(dialog).toContainText('Nothing changes until you click Apply.');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect
    .poll(() => draftText(page))
    .toBe(before.replace('## Why espresso turns bitter\n', '## Why espresso turns bitter?\n'));
  await expect(toast).toContainText('Applied.');
  // The example has one ready edit, so no Quick edit is left.
  await expect(quickEdit(page)).toHaveCount(0);

  // Undo in the toast puts the text back, and the Quick edit with it; apply it again.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => draftText(page)).toBe(before);
  await quickCard(page, HEADING_EDIT).getByRole('button', { name: 'Preview' }).click();
  await page
    .getByRole('dialog', { name: HEADING_EDIT })
    .getByRole('button', { name: 'Apply' })
    .click();
  await expect.poll(() => draftText(page)).toContain('## Why espresso turns bitter?');

  // The same edit is a note of its group, which is collapsed with Writing notes until opened.
  const headings = await noteGroup(page, HEADING_GROUP);
  await expect(headings).toContainText('Applied:');
  // Its Learn more goes to the check's section of Research, under the base path.
  await expect(headings.getByRole('link', { name: /^Learn more/ })).toHaveAttribute(
    'href',
    `${basePath()}research/#check-question-headings`,
  );

  // Done and Skip on two notes of one group, each from its overflow menu. Neither changes the text.
  const group = await noteGroup(page, PARAGRAPHS_GROUP);
  const notes = group.getByRole('article');
  const count = await notes.count();
  expect(count).toBeGreaterThanOrEqual(2);
  const text = await draftText(page);
  await pick(page, notes.first(), 'Done');
  await expect(toast).toContainText('Done.');
  await expect(notes).toHaveCount(count - 1);
  // Undo brings the note back; Done again.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(notes).toHaveCount(count);
  await pick(page, notes.first(), 'Done');
  await expect(notes).toHaveCount(count - 1);
  await pick(page, notes.first(), 'Skip');
  await expect(toast).toContainText('Skipped.');
  await expect(notes).toHaveCount(count - 2);
  expect(await draftText(page)).toBe(text);

  // After a reload the saved draft keeps the "?", and the done and skipped notes stay handled.
  // An applied edit is not a saved status, so its row (and its Undo) is gone.
  await page.reload();
  await expect.poll(() => draftText(page)).toContain('## Why espresso turns bitter?');
  await expect(coveredHeading(page)).toBeVisible();
  const kept = await noteGroup(page, PARAGRAPHS_GROUP);
  await expect(kept.getByRole('article')).toHaveCount(count - 2);
  await expect(kept).toContainText('Done:');
  await expect(kept).toContainText('Skipped:');
  await expect(await noteGroup(page, HEADING_GROUP)).not.toContainText('Applied:');
});

test('keyboard: Tab reaches the first Show and its focus ring is visible', async ({ page }) => {
  await openExample(page);
  // The first row's words are up top, so its first Show is on its answer line.
  const first = questionsCard(page)
    .getByRole('button', { name: /^Show where: / })
    .first();
  await expect(first).toHaveAccessibleName(`Show where: answer, "${EXAMPLE_QUESTIONS[0]}"`);
  // Buttons animate their ring (transition-all); measure end states, not a frame mid-transition.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  let reached = false;
  for (let i = 0; i < 400 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLButtonElement && el.textContent?.trim() === 'Show';
    });
  }
  expect(reached, 'Tab never reached a Show button').toBe(true);
  await expect(first).toBeFocused();
  const ringStyle = (el: Element) => {
    const s = getComputedStyle(el);
    return `${s.boxShadow}|${s.outlineStyle} ${s.outlineWidth}`;
  };
  expect(await first.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  const focused = await first.evaluate(ringStyle);
  await first.blur();
  const resting = await first.evaluate(ringStyle);
  expect(focused).not.toBe(resting);

  // Enter selects the passage from the keyboard, without a change to the text.
  const text = await draftText(page);
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content[aria-label="Draft text"]')).toBeFocused();
  await expect.poll(async () => (await selectedPassage(page)).text).not.toBe('');
  expect(await draftText(page)).toBe(text);
});
