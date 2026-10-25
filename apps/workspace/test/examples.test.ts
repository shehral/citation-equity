// @vitest-environment node
// The example behind "Try it with an example": its page, robots.txt and AI answers
// are written for this project and must not flatter. Every number here is computed by the
// engine (and, for parity, by the CLI's checkSite), never typed in.
import { checkSite } from '@citation-equity/bench/node';
import { analyze, READINESS_IDS } from '@citation-equity/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkPastedSite } from '@/components/site/site-check';
import * as examples from '@/lib/examples';
import {
  EXAMPLE_ANSWERS,
  EXAMPLE_PAGE_HTML,
  EXAMPLE_PAGE_URL,
  EXAMPLE_ROBOTS_TXT,
  EXAMPLE_SITE,
  EXAMPLE_SLUG,
  runExample,
} from '@/lib/examples';
import { authorQuestionTexts, initialQuestions } from '@/lib/questions';
import { getSample } from '@/lib/samples';
import { clearAll, getActiveSlot, getSummary, setSummary } from '@/lib/store';

const AT = new Date('2026-10-24T10:00:00.000Z');

beforeEach(() => clearAll());

describe('the example page and robots.txt', () => {
  const check = checkPastedSite({ html: EXAMPLE_PAGE_HTML, robotsTxt: EXAMPLE_ROBOTS_TXT });

  it('checks all seven rows in the browser when robots.txt is pasted', () => {
    expect(check.rows.map((r) => r.id).sort()).toEqual([...READINESS_IDS].sort());
    expect(check.rows.filter((r) => r.status === 'live')).toEqual([]);
  });

  it('does not flatter: 5 of 7 pass, 1 warning, 1 fail', () => {
    expect(check.summary).toMatchObject({ pass: 5, warn: 1, fail: 1, total: 7 });
    // The X-Robots-Tag response header still needs the live site.
    expect(check.summary.needsLiveSite).toBe(1);
  });

  it('gives the same verdict on every row as ce site on the same page and robots.txt', async () => {
    const served = (body: string, type: string) =>
      new Response(body, { status: 200, headers: { 'content-type': type } });
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/robots.txt')) return served(EXAMPLE_ROBOTS_TXT, 'text/plain');
      if (url === EXAMPLE_PAGE_URL) return served(EXAMPLE_PAGE_HTML, 'text/html');
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const cli = await checkSite(EXAMPLE_PAGE_URL, { fetchImpl });
    const statuses = (list: { id: string; status: string }[]) =>
      Object.fromEntries(list.map((i) => [i.id, i.status]));
    expect(statuses(check.rows)).toEqual(statuses(cli.readiness.items));
  });

  it('ships one robots.txt reader: the interim one in lib/examples is gone', () => {
    for (const name of [
      'robotsAllows',
      'crawlerAndRenderAdapter',
      'checkPastedPage',
      'siteSummaryFrom',
      'citedSummaryFrom',
    ]) {
      expect(examples, name).not.toHaveProperty(name);
    }
  });
});

describe('the example AI answers', () => {
  it('cite the example post in 1 of 3 answers, and the summary names the site', () => {
    runExample(AT);
    expect(getSummary('cited')).toMatchObject({
      answers: 3,
      citingYou: 1,
      site: EXAMPLE_SITE,
      example: true,
    });
    expect(getSummary('cited')?.topKinds[0]).toBe('forum');
    expect(EXAMPLE_ANSWERS).toHaveLength(3);
  });
});

describe('runExample', () => {
  it('opens the espresso example and stores the three summaries, labelled Example', () => {
    runExample(AT);
    const sample = getSample(EXAMPLE_SLUG);
    const initial = initialQuestions(sample, sample.before);
    // The pack's questions are imported, so they are the author's own for reader-words.
    const result = analyze(sample.before, {
      questions: initial.map((q) => q.text),
      authorQuestions: authorQuestionTexts(initial),
    });
    // Start here shows at most one fix per check.
    const checksWithFixes = result.checks.filter((c) => c.suggestions.length > 0).length;

    expect(getActiveSlot()).toBe(EXAMPLE_SLUG);
    expect(getSummary('draft')).toEqual({
      slot: EXAMPLE_SLUG,
      score: result.scores.foundation,
      baseline: { standard: result.scores.foundation, evidence: result.scores.evidence },
      openStartHere: Math.min(3, checksWithFixes),
      example: true,
      at: AT.toISOString(),
    });
    expect(getSummary('site')).toEqual({
      ...checkPastedSite({ html: EXAMPLE_PAGE_HTML, robotsTxt: EXAMPLE_ROBOTS_TXT }).summary,
      example: true,
      at: AT.toISOString(),
    });
    expect(getSummary('cited')).toMatchObject({ answers: 3, citingYou: 1, example: true });
  });

  it("keeps the baseline of the same slot's earlier check, so +N survives a second run", () => {
    setSummary('draft', {
      slot: EXAMPLE_SLUG,
      score: 30,
      baseline: { standard: 20, evidence: 21 },
      openStartHere: 3,
      example: true,
      at: AT.toISOString(),
    });
    runExample(AT);
    expect(getSummary('draft')?.baseline).toEqual({ standard: 20, evidence: 21 });
  });

  it("replaces another slot's baseline with the example's own score", () => {
    setSummary('draft', {
      slot: 'my-post',
      score: 80,
      baseline: { standard: 10, evidence: 10 },
      openStartHere: 0,
      example: false,
      at: AT.toISOString(),
    });
    runExample(AT);
    const draft = getSummary('draft');
    expect(draft?.baseline.standard).toBe(draft?.score);
  });
});
