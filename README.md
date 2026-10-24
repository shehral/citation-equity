# Citation Equity

Citation Equity helps independent writers make pages that AI answer engines (ChatGPT, Perplexity, Google's AI Overviews and others) can find, read and cite, without handing the writing over to an AI. It checks a draft against an evidence-graded checklist, suggests changes the author applies one click at a time, tests the draft on a free local model, and reads the author's own real signals (server logs, Search Console and Bing exports, answers copied from AI assistants). It is an open-source build of the three-module design by Prof. Akram Bayat (principal investigator), made at Northeastern University's SPARK program. Everything runs for free: in the browser, on a local model, or from the command line.

![The workspace: the espresso sample draft on the left; the GEO Score, target questions and suggestions on the right](docs/screenshot.png)
- **Hosted demo:** [shehral.github.io/citation-equity](https://shehral.github.io/citation-equity/)
- **Run it locally:** `pnpm i && pnpm dev`, then open http://localhost:3000

## What it helps you do

1. **Make sure engines can reach the page.** An engine can only cite a page it may fetch, can read without running JavaScript, and is allowed to quote. The site readiness report checks crawler access in robots.txt for the AI crawlers (from each operator's own documentation), rendering without JavaScript, indexing and snippet directives, canonical URL, byline, dates and structured data. Paste a page's HTML on `/site`, or run `ce site <url>`. `ce signals logs` counts AI crawler visits and AI assistant referrals in your own access log.
2. **Answer the questions people ask.** Each draft carries up to eight target questions. They start from the draft's own headings and title (or a sample's question pack), can come from your real queries (a Search Console or Bing AI Performance CSV, in the workspace or with `ce questions`), and stay fully editable. The _Target questions answered_ check looks for a short, direct answer to each one, and _Direct answer first_ checks that each section leads with its answer. Questions generated from your own draft tend to look covered, so real queries are the better test.
3. **Make content worth citing, with real sourced material.** Checks for statistics, attributed quotes, cited sources, comparison tables and explicit comparisons point at where a reader would want evidence. The advice says to add only real figures, quotes and sources you can name: in the larger studies, adding them for their own sake did not help and sometimes hurt.
4. **Measure real AI visibility for free.** The citation test bench runs your draft against a fixed set of competitor pages on a local model. `ce live` asks Gemini with Google Search (optional, with your own Gemini API key) and records whether its sources include your page. `ce signals bing` reads Bing Webmaster Tools' AI Performance export, and `/off-page` (or `ce sources`) shows which sites AI answers cite for your questions, from answers you paste in.
5. **Keep the author in control.** The tool suggests and never rewrites. Every change is one click on one suggestion (Apply, Mark done or Ignore, each with Undo); there is no "apply all". An optional local model can propose wording for one piece of advice, shown side by side, applied only on a click. Drafts stay on your machine, unless you point `ce bench` at a hosted OpenAI-compatible server, which then receives the draft in every prompt.

## What it cannot do

- **It cannot promise rankings or citations.** The GEO Score is a writing checklist, not a prediction. None of its ten checks has strong evidence behind it: eight are graded _mixed_ (at least one study found no effect or a negative one) and two _untested_. See [docs/evidence.md](docs/evidence.md).
- **It cannot measure off-page authority from a draft.** Whether other sites, forums and reviewers mention you matters to answer engines, and a draft cannot show it. The off-page report shows where engines look for your questions; being there honestly is up to you.
- **The bench is not a live engine.** Every bench result says: _Content check on a local model over a fixed page set. It does not predict live AI engines._ (With a hosted OpenAI-compatible server it says _a model_ instead of _a local model_.)
- **Live measurement covers one engine, through its API.** `ce live` measures Gemini with Google Search through the API, which can differ from what people see in the consumer app. The tool never scrapes ChatGPT, Perplexity, Google results or any other consumer interface.

## And SEO?

Search-engine basics still come first. Google says its AI features (AI Overviews and AI Mode) are rooted in its core Search ranking and quality systems, and that a page must be indexed and eligible to be shown with a snippet to appear as a supporting link ([Optimizing your website for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)). The same pages say structured data is not required and there is no special schema.org markup to add; what structured data does is help a page become eligible for rich results. That is why the readiness report checks indexing and snippet directives as hard requirements and grades structured data _mixed_.

## The three modules

Prof. Bayat's design has three modules. This build maps onto them as follows.

| Original design                                                                                     | This build                                                                                                                                                                                                                                               | Where                                                 |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **A. Analytical diagnostic engine:** parses a draft and computes a GEO Score from structural checks | The engine: Markdown or HTML in, ten checks, two weight presets, suggestions anchored to exact text ranges. Runs in the browser and in Node.                                                                                                             | `packages/engine`, `ce analyze`                       |
| **B. Automated data pipeline:** nightly queries of a frozen control group and live engines          | The citation test bench (a frozen page set, a local model, repeated runs with intervals), a nightly GitHub Actions template (off by default), `ce live` for Gemini, and readers for your own logs and exports. It reports; it never retunes the weights. | `packages/bench`, `ce bench`, `ce live`, `ce signals` |
| **C. Human-AI interactive workspace:** side-by-side suggestions the author accepts or rejects       | The web workspace: the draft on the left, the score, target questions, suggestions, checks and bench on the right. Plus `/site`, `/off-page`, `/evidence` and `/about`.                                                                                  | `apps/workspace`                                      |

Her design names the six original checks (standalone paragraphs, question headings, lists, statistics, tables, expert quotes). The four added checks (cited sources, direct answer first, target questions answered, explicit comparisons) come from the research literature. Every threshold and weight is ours.

## How the score works

- **Ten checks**, each scored 0 to 1 with findings that point at exact text. The score is their weighted average, shown as a whole number out of 100.
- **Two presets, both shown.** _Foundation design_ follows Prof. Bayat's design: her six checks weigh 1, the four added checks 0.5. _Evidence-weighted_ weights each check by its evidence grade (strong 1.0, moderate 0.7, mixed 0.25, untested 0.15). Drag any weight to make your own.
- **Four evidence grades:** strong, moderate, mixed, untested. Each check lists the studies behind it on `/evidence` and in [docs/evidence.md](docs/evidence.md). Where a study found no effect or harm, the check is graded mixed and the page says so.
- **The score is not a prediction** of citations. Site readiness and off-page results are reported on their own and never change it.

## The citation test bench, and what it found

The bench puts your draft among competitor pages for each question in a pack, retrieves the top 8 with BM25, and asks a local model (default `llama3.2:3b` through Ollama, 16,384-token window) to answer with numbered citations. It repeats 8 times per question with different seeds and source orders, and reports, before and after a revision: how often the draft was retrieved, answers that failed the citation format, how often the draft was cited among valid answers, and the draft's share of each answer next to the chance level (an even split over the retrieved sources). A paired sign-flip test compares before and after.

The sample results ([samples/README.md](samples/README.md)), on `llama3.2:3b` with 8 runs of 4 questions per draft:
- All 128 answers cited in the right format.
- **The draft's share sits near chance** (0.125 with 8 sources): 0.086 to 0.137 across the four drafts. The model cites most of the sources it is given.
- **One gain is retrieval, not citation:** the espresso after draft is retrieved for a question the before draft never reached (+25 points retrieved).
- **No difference the test can separate from noise.** With 4 questions the smallest possible p is 0.125.

The after drafts score much higher on the checks (37 to 72 and 45 to 76), yet this small model did not cite them measurably more. A pre-registered sensitivity test on four larger open models (9B to 31B) gave the same picture: the floor held (an off-topic page is almost never cited), but the pre-registered bar of a 0.10 share gain for an answer-first rewrite was not met by any model (gains of +0.007 to +0.034), so none qualified for the planned follow-up. The small positive shifts were consistent across questions and are treated as exploratory. See [experiments/RESULTS_sensitivity.md](experiments/RESULTS_sensitivity.md) and the design in [experiments/](experiments/).

The sample packs are synthetic pages written for this project. To test your own topic, build a pack from pages you name (`ce pack from-urls`, robots.txt respected) or, for research, from C-SEO Bench (`ce pack cseo`, downloaded at run time, not redistributed).

## Running a local model for the workspace

The workspace can run the bench, propose wording and suggest questions with a model on your own computer. Install [Ollama](https://ollama.com/download), quit the Ollama app if it is running, then start it so the site's origin may call it:

```sh
OLLAMA_ORIGINS=https://shehral.github.io ollama serve   # the hosted demo; http://localhost:3000 for pnpm dev
ollama pull llama3.2:3b
```

The origin is the scheme and host only, with no path; the workspace shows the right value for wherever you opened it.

The workspace calls only `http://127.0.0.1:11434` (or `localhost:11434`), and only after you click a button that says so. Without a local model it shows the recorded sample results.

## The command line

Build once, then run `ce` from the repository root:

```sh
pnpm install && pnpm build
pnpm ce --help                      # or: alias ce="node packages/bench/bin/ce.js"
```

| Command                                                                                                                              | What it does                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ce analyze draft.md [--questions q.txt] [--json]`                                                                                   | Both scores, every check, and the suggestions. Without `--questions`, the draft's own question headings are scored and template questions are listed as suggestions, not scored.                                   |
| `ce bench --draft before.md [--after after.md] --pack pack.json [--runs 8] [--k 8] [--model llama3.2:3b] [--out results] [--record]` | Local Ollama by default. `--adapter openai --base-url <url>` uses an OpenAI-compatible server, which receives the draft in every prompt; `OPENAI_API_KEY` goes only to https URLs (plain http needs `--send-key`). |
| `ce pack from-urls --question "..." --urls urls.txt --id my-topic --out pack.json`                                                   | A one-question pack from pages you name; robots.txt respected.                                                                                                                                                     |
| `ce pack cseo --out pack.json`                                                                                                       | A C-SEO Bench question-answering subset, downloaded and cached locally.                                                                                                                                            |
| `ce site <url> [--json]`                                                                                                             | Site readiness for a published page, including crawler access and rendering without JavaScript.                                                                                                                    |
| `ce signals logs access.log [--json]`                                                                                                | AI crawler hits and AI assistant referrals in your access log (combined format or JSON lines).                                                                                                                     |
| `ce signals bing export.csv [--json]`                                                                                                | Citations per page and per grounding query from a Bing Webmaster Tools AI Performance export.                                                                                                                      |
| `ce questions --from-search-console q.csv \| --from-bing b.csv \| --generate draft.md [--local-model]`                               | Target questions from real queries or from a draft, ranked.                                                                                                                                                        |
| `ce live --engine gemini --questions q.txt --url <page> [--runs 8]`                                                                  | Asks Gemini with Google Search and records whether its sources include your page. Needs `GEMINI_API_KEY`; the key is never logged or saved.                                                                        |
| `ce sources --live report.json \| --pasted answers.txt [--own example.com]`                                                          | Which sites AI answers cite for your questions, grouped by kind, with evidence-graded advice.                                                                                                                      |

Microsoft and Google do not publish the column names of the Bing AI Performance and Search Console exports, so the readers match the documented metric names through lists of likely headers and fail with the headers they found. If yours fails, please open an issue with the header row.

### Experiment harness

For larger models on a GPU cluster, the bench can hand its exact prompts out and read answers back, so retrieval, seeds and metrics stay identical to a local run: `ce bench ... --export-prompts prompts.jsonl` writes every prompt without calling a model, a vLLM batch script generates the answers on the cluster, and `ce bench ... --answers answers.jsonl` replays them into the normal reports. See [experiments/README.md](experiments/README.md).

### Nightly bench template

[`.github/workflows/bench-nightly.yml`](.github/workflows/bench-nightly.yml) runs the bench in GitHub Actions with Ollama in a service container, on every sample or on your own `bench/*.json` configs, and uploads the reports. It runs when you start it by hand; the 2 AM Pacific schedule from the original design is in the file, commented out.

## Privacy

Your draft stays in your browser (saved in its local storage) or on your disk, unless you run `ce bench --adapter openai` against a hosted server (by default `api.openai.com`): that server receives the draft in every prompt. The hosted site has no server and sends nothing anywhere; the only requests it can make go to a local Ollama, after you click. Pasted HTML, CSV exports and AI answers are read in the page. The command line fetches only what you ask for: the URLs you name (`ce site`, `ce pack from-urls`), C-SEO Bench (`ce pack cseo`), your local Ollama, and Gemini or an OpenAI-compatible server when you choose them (for `ce live`, also Google's redirect link for each source, to learn which page it points to).

## Documentation

- [docs/evidence.md](docs/evidence.md): the studies behind every check, readiness item and off-page card
- [docs/architecture.md](docs/architecture.md): packages, data flow and contracts
- [docs/roadmap.md](docs/roadmap.md): what comes next
- [samples/README.md](samples/README.md): how the samples and recorded runs were made
- [NOTICE](NOTICE): adapted code and data, with licenses

## Development

```sh
pnpm install
pnpm dev                                   # the workspace on http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test   # Biome, TypeScript, Vitest
pnpm build && pnpm e2e                     # static export, then the Playwright smoke test
```

The first `pnpm e2e` needs a browser: `pnpm --filter workspace exec playwright install chromium`. Node 24 and pnpm 10.

### Deploying your own copy

The hosted demo is GitHub Pages, built by [.github/workflows/pages.yml](.github/workflows/pages.yml) on every push to `main`. To host a fork:
1. Fork the repository.
2. In the fork's Settings > Pages, set the source to **GitHub Actions**.
3. In `.github/workflows/pages.yml`, set `NEXT_PUBLIC_BASE_PATH` to `/<repo>`, your fork's name (Pages serves a project site under that path). Remove it for a site served at the root of its domain (a custom domain, or a `<user>.github.io` repository).

The site is static files with no server, so any static host works: `NEXT_PUBLIC_BASE_PATH=/<path> pnpm --filter workspace build` writes it to `apps/workspace/out`.

## Related work

- [shehral/geo-measurement-prototype](https://github.com/shehral/geo-measurement-prototype): the August 2026 pre-work for this project.
- [shehral/footnoteone](https://github.com/shehral/footnoteone): FootnoteOne, a separate project. Citation Equity does not use or connect to it.

## Credits

- **Prof. Akram Bayat**, principal investigator and author of the original design: the three modules and the checks of the foundation preset.
- **Mohammad Ali Shehral** and **Ishan Gupta** built this version.
- SPARK research program, Northeastern University, Khoury College of Computer Sciences, San Jose.

Adapted code from GEO-optim/GEO, aiseo-audit, geo-lint, aeo-linter and shadcn/ui is listed with its license in [NOTICE](NOTICE).

## License

MIT. See [LICENSE](LICENSE).
