import { expect, type Page, test } from '@playwright/test';

// Shared by the specs. Each spec runs in two projects (playwright.config.ts): the root build at /
// and the GitHub Pages build under /citation-equity/. Routes below are written as the app names
// them ('/draft/'); `go` and `expectAt` resolve them against the project's base URL, so a spec
// never hard-codes the base path and a link or redirect that drops it fails.

/** Every route: the views, Research, then the old routes that now redirect. */
export const ROUTES = [
  '/',
  '/draft/',
  '/site/',
  '/cited/',
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
/** Start here titles on the espresso example: its question-heading edit and a numbers advisory. */
export const HEADING_EDIT = 'Add "?" or reword it';
export const ADVICE = 'Add a real number';

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

/**
 * The whole draft in the editor. CodeMirror renders only the lines near its viewport, so the
 * rendered .cm-line elements miss the rest of a long draft; this reads the editor state the way
 * EditorView.findFromDOM does (the content element's tile, then its root view).
 */
export async function draftText(page: Page) {
  // The draft's own editor; a preview dialog adds two more (its before and after).
  return page.locator('.cm-content[aria-label="Draft text"]').evaluate((content) => {
    type Tile = { root?: { view?: { state: { doc: { toString(): string } } } } };
    const view = (content as HTMLElement & { cmTile?: Tile }).cmTile?.root?.view;
    if (!view) throw new Error('no CodeMirror view on .cm-content');
    return view.state.doc.toString();
  });
}

export const startHere = (page: Page) => page.getByRole('region', { name: 'Start here' });
export const card = (page: Page, title: string) =>
  startHere(page).getByRole('article', { name: title, exact: true });

/** Opens the espresso example in the draft view, as the More menu does. */
export async function openExample(page: Page) {
  await page.evaluate(() =>
    window.localStorage.setItem('ce:v1:active-slot', 'espresso-bitterness'),
  );
  await go(page, '/draft/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bitter espresso');
}

/** Picks Done, Skip or Show me from a Start here card's overflow menu. */
export async function pick(page: Page, title: string, item: 'Done' | 'Skip' | 'Show me') {
  await card(page, title)
    .getByRole('button', { name: /^More actions/ })
    .click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** True when the document is wider than the viewport, so the page scrolls sideways. */
export async function scrollsSideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
