# Citation Equity

Citation Equity helps independent writers get quoted by AI search. Paste a draft, fix what makes it hard to quote, check your page and see who AI cites; it suggests, you decide.

**[Try the demo](https://shehral.github.io/citation-equity/)**: free, open source and in your browser, with no account.

![The home after Try it with an example: the draft's AI-ready score, its page check and who AI cites](docs/screenshot.png)

## What it does

1. **Check your draft**: 10 writing checks, each with its research grade.
2. **Answer real questions**: import your Search Console or Bing queries.
3. **Fix one thing at a time**: apply, mark done or skip; there is no apply-all.
4. **Test before and after** on a free local model.
5. **See who AI cites** for your questions, and whether AI crawlers can read your page.

The score is a writing checklist, not a forecast; the test uses a small local model and sample pages, so live AI search may differ.

## How the score works

- Ten checks, each scored 0 to 1, averaged into an AI-ready score from 0 to 100.
- Two weightings, Standard and By evidence (each check weighted by its research grade), both adjustable.
- Four evidence grades: strong, moderate, mixed, untested. No check is graded strong yet; see [docs/evidence.md](docs/evidence.md).

## What the test found

The edited sample drafts scored much higher on the checks, 35 to 73 (espresso) and 45 to 76 (RAG), but a small local model did not cite them measurably more. Details and the larger-model follow-up: [samples/README.md](samples/README.md) and [experiments/README.md](experiments/README.md).

## Quick start

```sh
pnpm install && pnpm dev     # the app on http://localhost:3000
```

To test drafts on a local model, install [Ollama](https://ollama.com/download), quit its app, then:

```sh
OLLAMA_ORIGINS=https://shehral.github.io ollama serve   # http://localhost:3000 for pnpm dev
ollama pull llama3.2:3b
```

The app shows the right origin for wherever you opened it; without a local model it shows the recorded sample results.

## The command line

Build once (`pnpm install && pnpm build`), then run `pnpm ce <command>` from the repository root. Options: [docs/cli.md](docs/cli.md).

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `ce analyze`        | Score a draft and list its fixes.                   |
| `ce bench`          | Test a draft before and after, on a local model.    |
| `ce pack from-urls` | Build a test pack from pages you name.              |
| `ce pack cseo`      | Build a test pack from C-SEO Bench.                 |
| `ce site`           | Check if AI can read your published page.           |
| `ce signals logs`   | Count AI crawler visits in your access log.         |
| `ce signals bing`   | Read a Bing AI Performance export.                  |
| `ce questions`      | Reader questions from your queries or your draft.   |
| `ce live`           | Ask Gemini with Google Search whether it cites you. |
| `ce sources`        | See which sites AI answers cite.                    |

## Privacy

The web app has no server: drafts stay in your browser; the only request goes to your local Ollama, after you click. The CLI fetches only what you ask for: URLs you name, your local model, or a hosted API you choose, which then receives the draft.

## Documentation

- [docs/evidence.md](docs/evidence.md): the studies behind every check
- [docs/architecture.md](docs/architecture.md): modules, packages and data flow
- [docs/cli.md](docs/cli.md): every command, and how to make a test pack
- [samples/README.md](samples/README.md): the sample drafts and the test method
- [experiments/README.md](experiments/README.md): larger models on a GPU cluster
- [docs/roadmap.md](docs/roadmap.md): what comes next

## Development

```sh
pnpm lint && pnpm typecheck && pnpm test   # Biome, TypeScript, Vitest
pnpm e2e                                   # builds both static exports, then Playwright
```

The first `pnpm e2e` needs `pnpm --filter workspace exec playwright install chromium`. Node 24 and pnpm 10.

### Deploying your own copy

The demo is GitHub Pages, built by [.github/workflows/pages.yml](.github/workflows/pages.yml) on every push to `main`. For a fork, set Settings > Pages source to **GitHub Actions** and `NEXT_PUBLIC_BASE_PATH` in that workflow to `/<repo>`. Any static host works: `NEXT_PUBLIC_BASE_PATH=/<path> pnpm --filter workspace build` writes `apps/workspace/out`.

## Related work

[shehral/geo-measurement-prototype](https://github.com/shehral/geo-measurement-prototype): the August 2026 pre-work for this project.

## License

MIT ([LICENSE](LICENSE)). Adapted code and data, with their licenses: [NOTICE](NOTICE).

## Credits

Original design by Prof. Akram Bayat. Built by Mohammad Ali Shehral and Ishan Gupta, Northeastern University, Khoury College of Computer Sciences, San Jose. How this build maps onto her three-module design: [docs/architecture.md](docs/architecture.md#the-original-design).
