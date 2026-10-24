# Architecture

Citation Equity is a pnpm monorepo with two libraries and one web app, all TypeScript. There is no server and no database: the web app is a static export, and everything that needs the network (fetching a site, a local model, Gemini) runs on the user's own machine.

```
citation-equity/
  packages/
    engine/       Module A: parse a draft, gather artifacts, run checks, score. Browser + Node.
    bench/        Module B: the citation test bench and the `ce` CLI.
                  src/        browser-safe core (retrieval, prompt, metrics, adapters)
                  src/node/   Node-only code (files, fetching, CLI), exported as @citation-equity/bench/node
  apps/
    workspace/    Module C: Next.js static export (/, /draft, /site, /cited, /research)
  samples/        sample drafts, synthetic packs and recorded bench runs
  experiments/    pre-registered experiments and cluster batch scripts
  docs/           evidence.md, this file, cli.md, roadmap.md, research notes
  .github/workflows/  ci.yml (lint, typecheck, test, build, e2e), bench-nightly.yml (template, off)
```

## The original design

Prof. Akram Bayat's design has three modules. This build maps onto them as follows.

| Original design | This build | Where |
| --- | --- | --- |
| **A. Analytical diagnostic engine:** parses a draft and scores it on structural checks | The engine: Markdown or HTML in, ten checks, two weightings, suggestions anchored to exact text ranges. Runs in the browser and in Node. | `packages/engine`, `ce analyze` |
| **B. Automated data pipeline:** nightly queries of a frozen control group and live engines | The citation test bench (a frozen page set, a local model, repeated runs with intervals), a nightly GitHub Actions template (off by default), `ce live` for Gemini, and readers for your own logs and exports. It reports; it never retunes the weights. | `packages/bench`, `ce bench`, `ce live`, `ce signals` |
| **C. Human-AI interactive workspace:** side-by-side suggestions the author accepts or rejects | The web app: a home dashboard with three tiles (your draft, your site, who gets cited), the draft view with its fixes, the page check, the citation report and the research page. | `apps/workspace` |

Her design names the six original checks (standalone paragraphs, question headings, lists, statistics, tables, expert quotes); the Standard weighting gives them weight 1, except lists, which weighs 0 in both built-in weightings because our own test (E1) found no effect larger than 0.03. The four added checks (cited sources, direct answer first, reader questions answered, explicit comparisons) come from the research literature and weigh 0.5 in Standard. Every threshold and weight is ours.

## Module A: the engine (`packages/engine`)

Pure TypeScript with no DOM and no Node APIs, so the same code scores a draft in the browser and in the CLI.

1. **Parse** (`parse.ts`): unified with remark-parse and remark-gfm; HTML input goes through rehype-parse and rehype-remark first, and offsets then refer to the converted Markdown. Front matter and fenced code are kept out of every count.
2. **Gather** (`gather.ts`): immutable artifacts with source positions: sections, headings, paragraphs, sentences (`Intl.Segmenter`), lists, tables, quotes, links.
3. **Check** (`checks/*.ts`): ten pure functions `(artifacts, { questions }) => CheckResult`, each with a 0 to 1 score, findings and suggestions. A suggestion is an `edit` (a deterministic before/after, for example adding the missing "?" to a heading that already reads as a question) or an `advisory` the author carries out. Each carries the exact Markdown range it refers to.
4. **Score** (`score.ts`): a weighted average of the applicable checks, 0 to 100, under the two weightings in `registry.ts` (Standard, `foundation` in code, and By evidence, `evidence` in code, which weights each check by its evidence grade) or custom weights. The app calls the result the AI-ready score. A draft with no applicable check has no score ("No content yet").

The registry (`registry.ts`, `evidence.ts`) holds each check's title, Prof. Bayat's category, evidence grade, summary, sources and default weights. `docs/evidence.md` is the long form of the same evidence, and `/research` renders it.

Outside the score, the engine also holds:
- `readiness.ts`: the seven site readiness items; the five page-level ones run on pasted HTML or front matter.
- `questions.ts`: reader questions generated from a draft's title, headings and first paragraph.
- `import-queries.ts`, `bing-ai.ts`, `csv.ts`: parsers for Search Console and Bing AI Performance CSV exports.
- `offpage.ts`: domain classification, the cited-sources tally and the evidence-graded advice for each kind of site.

## Module B: the bench (`packages/bench`)

**Browser-safe core** (`src/`, the package root entry, bundled by the workspace):
- `retrieve.ts`: BM25 over the pack's documents plus the draft (MiniSearch), top k = 8, positive scores only.
- `prompt.ts`: the GEO paper's answer prompt (adapted, see NOTICE) and the citation parser.
- `run.ts`: `runBench` repeats each question N = 8 times with seeds `baseSeed + 1000 × question + run` and a seeded shuffle of the source order; `compareReports` pairs before and after by question.
- `metrics.ts`: Wilson intervals, the position-adjusted word count share (GEO paper port), the chance level, and an exact sign-flip test.
- `adapters/`: `OllamaAdapter` (local, `num_ctx` sent), `OpenAICompatibleAdapter`, and `RecordedAdapter`/`RecordingAdapter` (replay and capture, keyed by `recordingKey`).
- `questions-llm.ts`: question fan-out on a local model. `crawlers.ts`: the AI crawler list, from each operator's documentation. `robots-check.ts`: the crawler verdicts for a robots.txt, shared by `ce site` and the app's page check, so both give the same answer.

**Node-only** (`src/node/`, exported as `@citation-equity/bench/node`): the `ce` CLI (commander), pack builders (`from-urls.ts` with robots.txt and Defuddle; `cseo.ts`, downloaded at run time), `site.ts` (robots.txt and a no-JavaScript fetch), `signals/` (access logs, Bing export), `gemini.ts` and `live.ts` (`ce live`), and `sources.ts` (`ce sources`).

A Biome rule bans Node modules (`node:*`, `fs`, `linkedom`, `defuddle`, `commander` and others) from `src/` outside `src/node/`, so the browser bundle cannot pick them up.

Every bench report (`BenchReport`, schemaVersion 2) stores its settings and carries the caveat: *Content check on a local model over a fixed page set. It does not predict live AI engines.* A run on a non-local OpenAI-compatible server says *a model* instead of *a local model*, and records `numCtx` as null, since that adapter cannot send it. `LiveReport` (from `ce live`) carries its own caveat: measured through an API.

## Module C: the workspace (`apps/workspace`)

Next.js (App Router) with `output: 'export'`: `next build` writes plain files to `out/`, so the site can be served by any static host. With `NEXT_PUBLIC_BASE_PATH` set (GitHub Pages serves it under `/citation-equity`), every asset and link carries that prefix.

| Route | View |
| --- | --- |
| `/` | Home dashboard: a headline, **Try it with an example**, and three tiles (Your draft, Your site, Who gets cited), each Not checked, Checked or Needs attention, then a Next up strip with one action. |
| `/draft/` | Your draft: the editor and the fix rail (score card, Start here, fixes grouped by check, then Reader questions, All checks and Test it, collapsed). |
| `/site/` | Your site: paste a page's HTML and, optionally, its robots.txt; a compact pass, warning or fail row per check. |
| `/cited/` | Who gets cited: paste answers from AI tools; cited sites grouped by type, each with a Do and an Avoid line. |
| `/research/` | The evidence for every check: one grade and one plain sentence, with the studies on expand. |
| `/evidence/`, `/off-page/`, `/about/` | Redirects from the earlier pages to `/research/`, `/cited/` and the About dialog. |

- **Editor:** CodeMirror 6 on the Markdown source, styled as paper, so engine offsets map one to one onto editor positions. Only the passages of the selected fix are underlined; anchors map through the author's edits between analyses. `@codemirror/merge` shows an edit's before and after in the preview.
- **Paste** (`lib/paste.ts`): clipboard HTML (a web page, Google Docs, Word) is cleaned in the browser (scripts, styles and embedded content dropped) and converted to Markdown by the engine's own HTML import, so headings and lists survive. Plain text pastes as is.
- **Analysis** (`lib/use-analysis.ts`): runs `analyze` on the current text after a short debounce, with the draft's reader questions.
- **Fixes** (`lib/apply.ts`): Apply replaces exactly the suggestion's range, and only if that text is unchanged; otherwise the card says "Out of date" and the analysis reruns. Start here shows three fixes: those with a ready edit first, then by expected score gain, then in document order. There is no bulk action.
- **Storage** (`lib/storage.ts`, `lib/store.ts`): the draft, its reader questions and the Done and Skip statuses are saved per draft slot, and the home tiles read small summaries (score, pass counts, answers citing you) rather than the pasted HTML or answers, which stay in memory. Every `localStorage` access is wrapped in try/catch and backed by an in-memory copy, so the app works with storage blocked. "Clear my data" removes everything under the app's key prefix.
- **Samples:** `scripts/gen-samples.mjs` runs before dev, build, test and typecheck and writes `lib/generated/samples.json` (gitignored) from `samples/`: drafts, packs and bench reports, without the recordings or answer text.
- **Local model:** Test it, Rewrite with local AI and the question fan-out call `http://127.0.0.1:11434` only after a click, with `OllamaAdapter`.

The engine and the bench are compiled from source: a custom export condition `@citation-equity/source` points Vitest and `tsx` at `src/`, and the Next.js config aliases both packages to their source entries for Turbopack.

## Contracts

Modules talk through typed JSON with a `schemaVersion`:

| Type | From | Used by |
| --- | --- | --- |
| `AnalysisResult`, `CheckResult`, `Suggestion` | engine `analyze` | workspace, `ce analyze` |
| `ReadinessResult` | engine `analyzeReadiness` | `/site/`, inside `SiteReport` |
| `Pack` | `samples/*/pack.json`, `ce pack` | bench |
| `BenchReport`, `Comparison` | bench `runBench`, `compareReports` | Test it in the draft view, `samples/*/results/` |
| `SiteReport` | `ce site` | CLI output |
| `LiveReport` | `ce live` | `ce sources --live` |

## Testing and CI

- **Vitest** (`pnpm test`): each package is a project; unit tests for every check (positive and negative fixtures), the scorer, anchoring, retrieval, metrics against hand-computed values, the recorded-adapter replay of both samples, CLI commands, and the workspace components under jsdom.
- **Playwright** (`pnpm e2e`, `apps/workspace/e2e/`): both static exports, rebuilt before each run and served locally (the root build from `out/` at `/`, the GitHub Pages build under `/citation-equity/`): the first visit with Try it with an example, the draft flow (Preview, Apply, Undo, Done, Skip), a returning visit landing on the last view, the page check, phone width, keyboard focus, and no request leaving the origin on load. Vitest never loads `e2e/`.
- **CI** (`.github/workflows/ci.yml`): lint, typecheck, test and build in one job; Chromium and the Playwright suite on both exports in another.

## Nightly bench template

[`.github/workflows/bench-nightly.yml`](../.github/workflows/bench-nightly.yml) is Module B's nightly run, switched off. It starts Ollama in a service container, pulls the bench's default model, runs `ce bench` on every sample (or on your own `bench/*.json` configs, each naming a draft, an optional after draft, a pack and runs), and uploads the reports as the `bench-results` artifact. Start it by hand from the Actions tab; the 2 AM Pacific schedule of the original design is in the file, commented out. GitHub's runners have no GPU, so a full run is slow; lower `runs` for a quick look.
