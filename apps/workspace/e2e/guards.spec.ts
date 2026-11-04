import { expect, type Page, test } from '@playwright/test';
import {
  basePath,
  coveredHeading,
  freshVisit,
  go,
  pageText,
  RETIRED_GRADE,
  ROUTES,
  writingNotes,
} from './support';

// Product truths checked on every route of the built site, in both projects:
// nothing leaves the origin on load, every same-site file loads from under the base path (the
// Pages build serves the site under /citation-equity/), no page uses the retired grade word, and
// no page shows a score, with or without the example.

interface Traffic {
  outside: string[];
  offBase: string[];
  failed: string[];
}

/** Records what the page requests: other origins, same-site paths off the base path, failures. */
function watch(page: Page, origin: string): Traffic {
  const traffic: Traffic = { outside: [], offBase: [], failed: [] };
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.origin !== origin) traffic.outside.push(req.url());
    else if (!url.pathname.startsWith(basePath())) traffic.offBase.push(url.pathname);
  });
  page.on('response', (res) => {
    if (new URL(res.url()).origin === origin && res.status() >= 400) {
      traffic.failed.push(`${res.status()} ${res.url()}`);
    }
  });
  // A prefetch the page cancels (it navigates, or the test ends) is aborted, not missing.
  page.on('requestfailed', (req) => {
    const reason = req.failure()?.errorText ?? '';
    if (reason !== 'net::ERR_ABORTED') traffic.failed.push(`${reason} ${req.url()}`);
  });
  return traffic;
}

/** The body's text with its scripts' payloads, lowercased: no copy can hide from it. */
async function bodyText(page: Page) {
  return ((await page.locator('body').textContent()) ?? '').toLowerCase();
}

/** What no route may show: the score this redesign removed, by its name or its "out of 100". */
function expectNoScore(text: string, where: string) {
  expect(text, where).not.toContain('AI-ready');
  expect(text, where).not.toContain('/ 100');
}

for (const route of ROUTES) {
  test(`${route}: nothing leaves the origin on load, every file loads from the base path, no retired grade word or score`, async ({
    page,
    baseURL,
  }) => {
    const traffic = watch(page, new URL(baseURL ?? '').origin);
    await go(page, route, { waitUntil: 'networkidle' });
    expect(traffic.outside).toEqual([]);
    expect(traffic.offBase).toEqual([]);
    expect(traffic.failed).toEqual([]);
    expect(await bodyText(page)).not.toContain(RETIRED_GRADE);
    expectNoScore(await pageText(page), route);
  });
}

test('the self-hosted fonts load from the base path', async ({ page, baseURL }) => {
  const fonts: string[] = [];
  page.on('response', (res) => {
    if (res.url().endsWith('.woff2') && res.ok()) fonts.push(new URL(res.url()).pathname);
  });
  await go(page, '/', { waitUntil: 'networkidle' });
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
  });
  expect(loaded.join(' ')).toMatch(/Newsreader/);
  expect(loaded.join(' ')).toMatch(/Instrument/);
  expect(fonts.length).toBeGreaterThan(0);
  for (const path of fonts)
    expect(path.startsWith(`${new URL(baseURL ?? '').pathname}_next/`)).toBe(true);
});

/**
 * What the working screens never say (the evidence lives on /research): test names, intervals,
 * p values, sample sizes, grade words and "our test found" sentences.
 */
const EVIDENCE_TALK =
  /\bE[123]\b|95%|\bCI\b|Holm|\bp = |(^|[\s(])n \d|\b[Ss]trong evidence|\b[Mm]oderate evidence|\b[Mm]ixed evidence|\bUntested\b|\b[Oo]ur (own )?tests? (found|measured)\b|\bGEO\b/;

test('with the example loaded, no view shows a score or the retired grade word, or leaves the origin', async ({
  page,
  baseURL,
}) => {
  await freshVisit(page);
  await page.getByRole('button', { name: 'Try it with an example' }).click();
  await expect(page.getByRole('region', { name: 'Blocker' })).toBeVisible();
  const traffic = watch(page, new URL(baseURL ?? '').origin);
  expect(await bodyText(page)).not.toContain(RETIRED_GRADE);
  expectNoScore(await pageText(page), '/ (example)');
  for (const route of ['/draft/', '/site/', '/cited/', '/questions/', '/research/']) {
    await go(page, route, { waitUntil: 'networkidle' });
    if (route === '/draft/') {
      // Open the question editor, Writing notes and every note group, so their text is checked
      // too (the rail renders a collapsed section's body only once it is opened).
      await expect(coveredHeading(page)).toBeVisible();
      await page.getByRole('button', { name: 'Edit questions' }).click();
      const notes = await writingNotes(page);
      const groups = await notes.getByRole('button', { name: /, (\d+ notes?|done)$/ }).all();
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        await group.click();
        await expect(group).toHaveAttribute('aria-expanded', 'true');
      }
    }
    expect(await bodyText(page), route).not.toContain(RETIRED_GRADE);
    const text = await pageText(page);
    expectNoScore(text, route);
    if (route !== '/research/') expect(text.match(EVIDENCE_TALK)?.[0], route).toBeUndefined();
  }
  expect(traffic.outside).toEqual([]);
  expect(traffic.failed).toEqual([]);
});
