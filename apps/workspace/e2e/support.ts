import { expect, type Locator, type Page, test } from '@playwright/test';
import { type QuestionLineLabels, TEST_LABEL_TEXT } from '../../../packages/engine/src/labels';

// Shared by the specs. Each spec runs in two projects (playwright.config.ts): the root build at /
// and the GitHub Pages build under /citation-equity/. Routes below are written as the app names
// them ('/draft/'); `go` and `expectAt` resolve them against the project's base URL, so a spec
// never hard-codes the base path and a link or redirect that drops it fails.
//
// Labels our tests can change (the question lines' chips, the Research short answer) are read
// from the engine's source, never typed here, so a new result changes the app and these
// expectations together. The engine's modules are imported by path: its package entry points
// at a build the e2e run does not make, and its index pulls in the analyzer, which Playwright's
// loader cannot read (a JSON import); these modules hold data and labels only.

export { E5_TEXT } from '../../../packages/engine/src/e5';
export {
  helpedChecks,
  QUESTION_LABELS,
  shortAnswer,
  TEST_LABEL_TEXT,
  TEST_LABELS,
} from '../../../packages/engine/src/labels';
export { CHECK_IDS } from '../../../packages/engine/src/types';

/**
 * True while the Your site restyle ships (the Blockers rows with their pills, Other page notes).
 * If the restyle is cut, set this to false: the specs that check that layout are skipped.
 */
export const RESTYLE = true;

/** Every route: the views, Research, then the old routes that now redirect. */
export const ROUTES = [
  '/',
  '/draft/',
  '/site/',
  '/cited/',
  '/questions/',
  '/research/',
  '/evidence/',
  '/off-page/',
  '/about/',
];

/** The word the four public grades replaced; built in two parts so this file never contains it. */
export const RETIRED_GRADE = ['contra', 'dicted'].join('');

export const CAVEAT =
  'Content check on a local model over a fixed page set. It does not predict live AI engines.';
export const CHANCE = 'Small local AI and sample pages, so this could be chance.';

/** The espresso example's four questions (its pack's), in their order. */
export const EXAMPLE_QUESTIONS = [
  'Why does my espresso taste bitter?',
  'How do I fix bitter espresso?',
  'What water temperature should I use for espresso?',
  'How long should an espresso shot take?',
];

/**
 * The example's one ready edit, the question-heading "?" edit: the Quick edit on load, and a
 * note in HEADING_GROUP under Writing notes.
 */
export const HEADING_EDIT = 'Add "?" or reword it';
/** The writing-note group that holds HEADING_EDIT. */
export const HEADING_GROUP = 'Headings ask questions';
/** A writing-note group of advice only (each note's main button is Show me): Done and Skip. */
export const PARAGRAPHS_GROUP = 'Paragraphs make sense alone';

/**
 * The chips the Questions covered card shows beside its heading for a pair of line labels: one
 * when the two lines agree, else one per line (words up top, then answered).
 */
export function cardChips(labels: QuestionLineLabels): string[] {
  return labels.words === labels.answer
    ? [TEST_LABEL_TEXT[labels.words]]
    : [TEST_LABEL_TEXT[labels.words], TEST_LABEL_TEXT[labels.answer]];
}

/** The project's base URL, which ends in a slash ('http://127.0.0.1:47381/' or '.../citation-equity/'). */
export function baseURL(): string {
  const url = test.info().project.use.baseURL;
  if (!url) throw new Error('playwright.config.ts gives every project a baseURL');
  return url;
}

/** The full URL of an app route ('/draft/#start-here') under the project's base URL. */
export function urlOf(route: string): string {
  return new URL(route.replace(/^\//, '') || './', baseURL()).href;
}

/** The base path the project serves the site under ('/' or '/citation-equity/'). */
export const basePath = () => new URL(baseURL()).pathname;

export async function go(page: Page, route: string, options?: Parameters<Page['goto']>[1]) {
  return page.goto(urlOf(route), options);
}

export async function expectAt(page: Page, route: string) {
  await expect(page).toHaveURL(urlOf(route));
}

/** A first visit: nothing stored for this origin. */
export async function freshVisit(page: Page) {
  await go(page, '/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

/** Every key this origin stores, as one string, to check what is (and is not) kept. */
export async function storedText(page: Page) {
  return page.evaluate(() => JSON.stringify(window.localStorage));
}

/**
 * The draft editor's text and selection. CodeMirror renders only the lines near its viewport, so
 * the rendered .cm-line elements miss the rest of a long draft; this reads the editor state the
 * way EditorView.findFromDOM does (the content element's tile, then its root view).
 */
async function editorState(page: Page) {
  // The draft's own editor; a preview dialog adds two more (its before and after).
  return page.locator('.cm-content[aria-label="Draft text"]').evaluate((content) => {
    type View = {
      state: { doc: { toString(): string }; selection: { main: { from: number; to: number } } };
    };
    type Tile = { root?: { view?: View } };
    const view = (content as HTMLElement & { cmTile?: Tile }).cmTile?.root?.view;
    if (!view) throw new Error('no CodeMirror view on .cm-content');
    const { from, to } = view.state.selection.main;
    return { text: view.state.doc.toString(), from, to };
  });
}

/** The whole draft in the editor. */
export async function draftText(page: Page) {
  return (await editorState(page)).text;
}

/** The passage selected in the draft (what Show marks): where it starts and its text. */
export async function selectedPassage(page: Page) {
  const { text, from, to } = await editorState(page);
  return { from, text: text.slice(from, to) };
}

/** Types `text` into the draft editor at its end. */
export async function typeDraft(page: Page, text: string) {
  const content = page.locator('.cm-content[aria-label="Draft text"]');
  await content.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(text);
}

export const rail = (page: Page) =>
  page.getByRole('complementary', { name: 'Questions and notes' });
export const startHere = (page: Page) => page.getByRole('region', { name: 'Start here' });

/** The Questions covered heading, "Questions covered: N of M". */
export const coveredHeading = (page: Page) =>
  page.getByRole('heading', { name: /^Questions covered: \d+ of \d+$/ });
/** The Questions covered card, named by its heading. */
export const questionsCard = (page: Page) =>
  startHere(page).getByRole('region', { name: /^Questions covered: \d+ of \d+$/ });
/** One question's row on the card. */
export const questionRow = (page: Page, question: string) =>
  questionsCard(page).getByRole('article', { name: question, exact: true });
/** The card's own label chips, beside or under its heading (not a row's own). */
export const cardChipsOf = (page: Page) =>
  questionsCard(page).locator('[data-card-chips] [data-label-chip]');

/** The Quick edit card in Start here: the one ready edit, titled by its fix. */
export const quickEdit = (page: Page) =>
  startHere(page).getByRole('region', { name: 'Quick edit' });
export const quickCard = (page: Page, title: string) =>
  quickEdit(page).getByRole('article', { name: title, exact: true });

/** The Writing notes body, opened first if it is collapsed. */
export async function writingNotes(page: Page): Promise<Locator> {
  const toggle = rail(page).getByRole('button', { name: /^Writing notes/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return rail(page).getByRole('region', { name: 'Writing notes' });
}

/**
 * `text` as a literal pattern inside a RegExp, since a group name such as "Structured data
 * (schema)" holds regex characters.
 */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One writing-note group, opened (with Writing notes) if it is collapsed. Its toggle is named
 * "<check>, <n> notes", so the group is found by the check's name.
 */
export async function noteGroup(page: Page, group: string): Promise<Locator> {
  const notes = await writingNotes(page);
  const name = new RegExp(`^${literal(group)},`);
  const toggle = notes.getByRole('button', { name });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // An inner locator is matched inside each item, so it starts from the page, not the rail.
  return notes.getByRole('listitem').filter({ has: page.getByRole('button', { name }) });
}

/** Opens the espresso example in the draft view, as the More menu does. */
export async function openExample(page: Page) {
  await page.evaluate(() =>
    window.localStorage.setItem('ce:v1:active-slot', 'espresso-bitterness'),
  );
  await go(page, '/draft/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bitter espresso');
  await expect(coveredHeading(page)).toBeVisible();
}

/** Picks Done, Skip or Show me from a fix card's overflow menu. */
export async function pick(page: Page, card: Locator, item: 'Done' | 'Skip' | 'Show me') {
  await card.getByRole('button', { name: /^More actions/ }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/**
 * The page's own text, hidden parts included, without its scripts' payloads (the static export
 * inlines the rendered payload in script tags, which would echo any copy back).
 */
export async function pageText(page: Page) {
  return page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    for (const el of body.querySelectorAll('script, style')) el.remove();
    return body.textContent ?? '';
  });
}

/** True when the document is wider than the viewport, so the page scrolls sideways. */
export async function scrollsSideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
