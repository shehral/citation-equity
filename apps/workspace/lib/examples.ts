// The example behind the home's "Try it with an example": the espresso post,
// the page it was published as, that site's robots.txt and three AI answers to the post's
// questions. All of it is synthetic, written for this project, and meant not to flatter: the
// page passes 5 of its 7 checks (1 warning, 1 fail) and the post is cited in 1 of 3 answers.
// Nothing below is a stored number: runExample() computes every summary with the engine.

import { citedReport, citedSummary } from '@/components/cited/tally';
import { checkPastedSite } from '@/components/site/site-check';
import { selectDraftSlot } from './draft-summary';
import { type CitedInput, clearPasted, type SiteInput } from './pasted';
import { setSummary } from './store';

/** The sample the example opens (samples/espresso-bitterness). */
export const EXAMPLE_SLUG = 'espresso-bitterness';
/** The example author's own site. example.com is reserved for examples (RFC 2606). */
export const EXAMPLE_SITE = 'example.com';
/** Where the example page lives (tests check `ce site` on it for verdict parity). */
export const EXAMPLE_PAGE_URL = 'https://example.com/espresso-bitter/';

/**
 * The espresso post as its blog serves it, before any JavaScript runs. Byline, dates, schema and
 * robots meta are in order; it has no canonical link (the warning).
 */
export const EXAMPLE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Why does my espresso taste bitter? | Jane's coffee notes</title>
<meta name="description" content="The usual reasons a home espresso shot turns bitter, and what to change first.">
<meta name="author" content="Jane Writer">
<meta name="robots" content="index, follow">
<meta property="article:published_time" content="2026-03-01">
<meta property="article:modified_time" content="2026-09-12">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"Why does my espresso taste bitter?","author":{"@type":"Person","name":"Jane Writer"},"datePublished":"2026-03-01","dateModified":"2026-09-12"}</script>
</head>
<body>
<header><a href="/">Jane's coffee notes</a> <nav><a href="/about/">About</a> <a href="/archive/">Archive</a></nav></header>
<main>
<article>
<h1>Why does my espresso taste bitter?</h1>
<p class="byline">By Jane Writer. Published <time datetime="2026-03-01">1 March 2026</time>, updated <time datetime="2026-09-12">12 September 2026</time>.</p>
<p>If you have ever pulled a shot at home, tasted it and made a face, you are in good company. Home espresso is fussy, and a lot of things can push a shot from rich and sweet to harsh and bitter. The good news is that most of the causes are things you can see and change once you know where to look, and you do not need new gear to start.</p>
<h2>A little background on extraction</h2>
<p>Espresso is made by pushing hot water through a tight puck of finely ground coffee. As the water moves through, it dissolves flavors out of the grounds. Acids and fruity notes come out first, then sugars, and last of all the heavier, woody, bitter compounds. A good shot stops somewhere in the sweet middle of that process.</p>
<h2>Why espresso turns bitter</h2>
<p>Bitterness usually comes from over extraction, from water that is too hot, or from beans that were roasted very dark. It can also come from channeling, when the water finds a weak spot in the puck and rushes through it, so the cup tastes bitter and sour at the same time.</p>
<h2>Grind size</h2>
<p>Grind size is the biggest lever you have. A finer grind gives the water more surface to work on and slows the shot down, so more gets extracted. If your shots are bitter and they run slowly, try going a little coarser and see how the next shot tastes. Grinders drift with fresh beans, old beans and humid days, so a setting that worked last week might be too fine today.</p>
<h2>Water temperature</h2>
<p>Hotter water extracts faster. If your machine lets you set the temperature, dropping it a couple of degrees can take the edge off a harsh shot, especially with darker roasts. Lighter roasts usually want hotter water, so there is no single right number for everyone.</p>
</article>
</main>
<footer><p>Written and photographed by Jane Writer.</p></footer>
</body>
</html>
`;

/**
 * The example site's robots.txt: a "block the AI bots" list copied from a forum, which also
 * blocks PerplexityBot, a search crawler (the fail; GPTBot and CCBot are training crawlers).
 */
export const EXAMPLE_ROBOTS_TXT = `# Block AI bots (copied from a forum thread)
User-agent: GPTBot
User-agent: CCBot
User-agent: PerplexityBot
Disallow: /

User-agent: *
Allow: /

Sitemap: https://example.com/sitemap.xml
`;

export interface ExampleAnswer {
  question: string;
  /** The answer as an AI tool shows it, with its links. Written for this project. */
  answer: string;
}

/** Three answers to the post's questions, as a reader might paste them. One cites the post. */
export const EXAMPLE_ANSWERS: readonly ExampleAnswer[] = [
  {
    question: 'Why does my espresso taste bitter?',
    answer: `Bitter espresso is usually over extracted: the grind is too fine, the shot runs too long or the water is too hot. Very dark roasts taste bitter even when the shot is right.

Sources:
1. https://www.reddit.com/r/espresso/
2. https://en.wikipedia.org/wiki/Espresso
3. https://example.com/espresso-bitter/`,
  },
  {
    question: 'How long should an espresso shot take?',
    answer: `Most guides aim for 25 to 30 seconds for a double shot, but taste matters more than the clock. Adjust the grind first.

Sources:
1. https://www.reddit.com/r/espresso/
2. https://www.youtube.com/results?search_query=espresso+shot+time`,
  },
  {
    question: 'Does water temperature change how espresso tastes?',
    answer: `Yes. Hotter water extracts faster, so lowering it a few degrees can soften a harsh shot, especially with dark roasts.

Sources:
1. https://en.wikipedia.org/wiki/Espresso_machine
2. https://www.reddit.com/r/espresso/`,
  },
];

/** The example's page as the Your site view's input, when the example is the active content. */
export const EXAMPLE_SITE_INPUT: SiteInput = {
  html: EXAMPLE_PAGE_HTML,
  robotsTxt: EXAMPLE_ROBOTS_TXT,
};

/** The example's answers and site as the Who gets cited view's input. */
export const EXAMPLE_CITED_INPUT: CitedInput = {
  entries: EXAMPLE_ANSWERS.map((a, key) => ({ key, ...a })),
  own: EXAMPLE_SITE,
};

/** True when a site input is the example's own, unchanged. */
export const isExampleSite = (input: SiteInput) =>
  input.html === EXAMPLE_SITE_INPUT.html && input.robotsTxt === EXAMPLE_SITE_INPUT.robotsTxt;

/** True when the cited input is the example's own answers and site, unchanged. */
export const isExampleCited = (input: CitedInput) =>
  input.own === EXAMPLE_CITED_INPUT.own &&
  input.entries.length === EXAMPLE_CITED_INPUT.entries.length &&
  input.entries.every((e, i) => {
    const x = EXAMPLE_CITED_INPUT.entries[i];
    return x !== undefined && e.question === x.question && e.answer === x.answer;
  });

/**
 * "Try it with an example": opens the espresso example in the draft slot and stores the three
 * summaries it produces, each labelled Example. The site and cited summaries come from the same
 * code as the /site and /cited views (the browser-safe robots and render checks, the tally),
 * so the tiles match what those views show for the same input. Works with storage blocked (the
 * store keeps them in memory for this page). The inputs themselves are never stored: while the
 * stored summaries are the example's, the views re-run on the inputs above.
 */
export function runExample(at: Date = new Date()): void {
  const iso = at.toISOString();
  clearPasted();
  const site = checkPastedSite({ html: EXAMPLE_PAGE_HTML, robotsTxt: EXAMPLE_ROBOTS_TXT });
  const cited = citedSummary(citedReport([...EXAMPLE_ANSWERS], EXAMPLE_SITE), iso);
  selectDraftSlot(EXAMPLE_SLUG, at);
  setSummary('site', { ...site.summary, example: true, at: iso });
  setSummary('cited', { ...cited, example: true });
}
