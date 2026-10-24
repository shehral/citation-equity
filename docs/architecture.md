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
    workspace/    Module C: Next.js static export (pages /, /evidence, /site, /off-page, /about)
  samples/        sample drafts, synthetic packs and recorded bench runs
  experiments/    pre-registered experiments and cluster batch scripts
  docs/           evidence.md, this file, roadmap.md, research notes
  .github/workflows/  ci.yml (lint, typecheck, test, build, e2e), bench-nightly.yml (template, off)
```

## Module A: the engine (`packages/engine`)

Pure TypeScript with no DOM and no Node APIs, so the same code scores a draft in the browser and in the CLI.

1. **Parse** (`parse.ts`): unified with remark-parse and remark-gfm; HTML input goes through rehype-parse and rehype-remark first, and offsets then refer to the converted Markdown. Front matter and fenced code are kept out of every count.
2. **Gather** (`gather.ts`): immutable artifacts with source positions: sections, headings, paragraphs, sentences (`Intl.Segmenter`), lists, tables, quotes, links.
3. **Check** (`checks/*.ts`): ten pure functions `(artifacts, { questions }) => CheckResult`, each with a 0 to 1 score, findings and suggestions. A suggestion is an `edit` (a deterministic before/after, for example adding the missing "?" to a heading that already reads as a question) or an `advisory` the author carries out. Each carries the exact Markdown range it refers to.
4. **Score** (`score.ts`): a weighted average of the applicable checks, 0 to 100, under the two presets in `registry.ts` (`foundation`, `evidence`) or custom weights. A draft with no applicable check has no score ("No content yet").

The registry (`registry.ts`, `evidence.ts`) holds each check's title, Prof. Bayat's category, evidence grade, summary, sources and default weights. `docs/evidence.md` is the long form of the same evidence, and `/evidence` renders the registry.

Outside the score, the engine also holds:
- `readiness.ts`: the seven site readiness items; the five page-level ones run on pasted HTML or front matter.
- `questions.ts`: target questions generated from a draft's title, headings and first paragraph.
- `import-queries.ts`, `bing-ai.ts`, `csv.ts`: parsers for Search Console and Bing AI Performance CSV exports.
- `offpage.ts`: domain classification, the cited-sources tally and the evidence-graded off-page advice.

## Module B: the bench (`packages/bench`)

**Browser-safe core** (`src/`, the package root entry, bundled by the workspace):
- `retrieve.ts`: BM25 over the pack's documents plus the draft (MiniSearch), top k = 8, positive scores only.
- `prompt.ts`: the GEO paper's answer prompt (adapted, see NOTICE) and the citation parser.
- `run.ts`: `runBench` repeats each question N = 8 times with seeds `baseSeed + 1000 × question + run` and a seeded shuffle of the source order; `compareReports` pairs before and after by question.
- `metrics.ts`: Wilson intervals, the position-adjusted word count share (GEO paper port), the chance level, and an exact sign-flip test.
- `adapters/`: `OllamaAdapter` (local, `num_ctx` sent), `OpenAICompatibleAdapter`, and `RecordedAdapter`/`RecordingAdapter` (replay and capture, keyed by `recordingKey`).
- `questions-llm.ts`: question fan-out on a local model. `crawlers.ts`: the AI crawler list, from each operator's documentation.

**Node-only** (`src/node/`, exported as `@citation-equity/bench/node`): the `ce` CLI (commander), pack builders (`from-urls.ts` with robots.txt and Defuddle; `cseo.ts`, downloaded at run time), `site.ts` (robots.txt and a no-JavaScript fetch), `signals/` (access logs, Bing export), `gemini.ts` and `live.ts` (`ce live`), and `sources.ts` (`ce sources`).

A Biome rule bans Node modules (`node:*`, `fs`, `linkedom`, `defuddle`, `commander` and others) from `src/` outside `src/node/`, so the browser bundle cannot pick them up.

Every bench report (`BenchReport`, schemaVersion 2) stores its settings and carries the caveat: *Content check on a local model over a fixed page set. It does not predict live AI engines.* A run on a non-local OpenAI-compatible server says *a model* instead of *a local model*, and records `numCtx` as null, since that adapter cannot send it. `LiveReport` (from `ce live`) carries its own caveat: measured through an API.

## Module C: the workspace (`apps/workspace`)

Next.js (App Router) with `output: 'export'`: `next build` writes plain files to `out/`, so the site can be served by any static host.

- **Editor:** CodeMirror 6 on the Markdown source, so engine offsets map one to one onto editor positions. Pending suggestions are underlined; anchors map through the author's edits between analyses. `@codemirror/merge` shows an edit's before and after side by side.
- **Analysis** (`lib/use-analysis.ts`): runs `analyze` on the current text after a short debounce, with the draft's target questions.
- **Suggestions** (`lib/apply.ts`): Apply replaces exactly the suggestion's range, and only if that text is unchanged; otherwise the card says "Out of date" and the analysis reruns. There is no bulk action.
- **Storage** (`lib/storage.ts`): the draft, its target questions and the Done/Ignored statuses are saved per sample in `localStorage`, every access wrapped in try/catch. Applied edits are not a saved status: the saved draft carries them.
- **Samples:** `scripts/gen-samples.mjs` runs before dev, build, test and typecheck and writes `lib/generated/samples.json` (gitignored) from `samples/`: drafts, packs and bench reports, without the recordings or answer text.
- **Local model:** the bench panel, the wording helper and the question fan-out call `http://127.0.0.1:11434` only after a click, with `OllamaAdapter`.

The engine and the bench are compiled from source: a custom export condition `@citation-equity/source` points Vitest and `tsx` at `src/`, and the Next.js config aliases both packages to their source entries for Turbopack.

## Contracts

Modules talk through typed JSON with a `schemaVersion`:

| Type | From | Used by |
| --- | --- | --- |
| `AnalysisResult`, `CheckResult`, `Suggestion` | engine `analyze` | workspace, `ce analyze` |
| `ReadinessResult` | engine `analyzeReadiness` | `/site`, inside `SiteReport` |
| `Pack` | `samples/*/pack.json`, `ce pack` | bench |
| `BenchReport`, `Comparison` | bench `runBench`, `compareReports` | workspace bench panel, `samples/*/results/` |
| `SiteReport` | `ce site` | CLI output |
| `LiveReport` | `ce live` | `ce sources --live` |

## Testing and CI

- **Vitest** (`pnpm test`): each package is a project; unit tests for every check (positive and negative fixtures), the scorer, anchoring, retrieval, metrics against hand-computed values, the recorded-adapter replay of both samples, CLI commands, and the workspace components under jsdom.
- **Playwright** (`pnpm e2e`, `apps/workspace/e2e/`): a smoke test of the built site served from `out/`: load the sample, see the score, apply one edit, ignore one advisory, reload and keep both, the bench caveat, keyboard focus, `/evidence`, `/site`, `/off-page`, and no request leaving the origin on load. Vitest never loads `e2e/`.
- **CI** (`.github/workflows/ci.yml`): lint, typecheck, test and build in one job; Chromium, build and the smoke test in another.
