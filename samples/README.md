# Samples

Two sample drafts for the workspace demo and the citation test bench. Each folder holds:
- `before.md`: the draft as a typical blog post, with weaknesses the checks detect
- `after.md`: the same draft after following the tool's own suggestions
- `pack.json`: the fixed set of competitor pages the bench tests the draft against
- `results/`: the recorded bench runs (added after the drafts were committed, see below)

| Sample                | Topic                                 | Before draft                                |
| --------------------- | ------------------------------------- | ------------------------------------------- |
| `espresso-bitterness` | Coffee, consumer explainer            | "Why does my espresso taste bitter?"        |
| `rag-explained`       | Machine learning, technical explainer | "Retrieval-augmented generation, explained" |

`index.json` lists the samples for the workspace (`{ slug, title, topic, packId }`).

## Protocol

The order matters, because it keeps the after drafts from being tuned to the bench.
1. **Before drafts.** Each `before.md` was written as an ordinary blog post. The espresso draft has statement headings, no table, almost no numbers, an unattributed quotation and paragraphs that open with "This". The RAG draft has long paragraphs, a section that does not lead with its answer, a comparison written as prose, and figures with no source.
2. **Packs.** Each `pack.json` first had 4 questions on the draft's topic and 6 competitor pages per question. The pages vary on purpose: some are thorough, with tables and figures, and some are thin.
3. **After drafts.** Each `after.md` was written by running `ce analyze before.md` and acting on every suggestion once, the way an author would: edits applied as proposed, advisories carried out by hand, meaning and voice kept. It was not revised again after that pass, so the after draft still draws a few new suggestions of its own.
4. **Commit before any bench run.** The before drafts, packs and after drafts were committed (`samples: drafts and synthetic packs (written before any bench run)`) before the bench ran once on any pack. Nothing in them was changed after a bench result was seen.
5. **Model bake-off**, then the **first canonical runs**. That first recording is superseded (see below).
6. **Packs extended.** After the first recording was diagnosed, each pack got 6 more synthetic pages per question, 12 in all (`q<n>-d7` to `q<n>-d12`: tables with invented figures, forum threads, FAQs, a glossary, first-person posts and keyword-stuffed filler). They were committed (`samples: extend each pack to 12 synthetic pages per question (written before any new bench run)`) before the bench ran again. The drafts were not changed.
7. **A new bake-off**, then the **current canonical runs**, recorded below.

## Everything here is invented

The competitor pages were written for this project. They are not copied from any site, and their figures, tests and anecdotes are made up to look like real pages of mixed quality. Every pack is marked `"synthetic": true`, and so is every page in it. The person and the roaster named in the espresso after draft are fictional. The links in the RAG after draft point to `example.com` placeholders: the draft's suggestions asked for sources, and a real author would link the real ones.

Packs are licensed `MIT (written for this project)`, with source `Citation Equity sample pack`.

## Bench runs

Content check on a local model over a fixed page set. It does not predict live AI engines.

### How the test works

For each question in a pack, the bench puts the draft among the pack's competitor pages, retrieves the top 8 with BM25, and asks a local model (default `llama3.2:3b` through Ollama, with a 16,384-token window) to answer from those sources with numbered citations. It repeats each question 8 times with different seeds and source orders. For the draft before and after a revision it reports how often the draft was retrieved, the answers that failed the citation format, how often the draft was cited among valid answers, and the draft's share of each answer next to the chance level (an even split over the retrieved sources). A paired sign-flip test over the questions compares before and after. The sections below give the exact settings and what changed since the first recording.

To test your own topic, build a pack from pages you name or, for research, from C-SEO Bench: see [docs/cli.md](../docs/cli.md#make-a-test-pack).

### The first recording, and why it was superseded

The first canonical runs (commit `760a239`, k 5, Ollama's default context window) are superseded. Their files were replaced by the runs below and stay in the git history. Diagnosing them showed that the bench, not the drafts, produced most of what they seemed to say:
- **Truncated prompts.** Ollama's default window is 4,096 tokens. The RAG after-draft prompts came to about 3,500 tokens before the answer, and the Ollama log showed 3 calls truncated.
- **Format failures counted as "not cited".** Some answers carried no valid `[n]` citation at all: 0 and 1 of 32 for espresso (before, after), 3 and 9 of 32 for RAG. The old bench scored each of them as an answer that did not cite the draft. Most of the RAG after draft's drop (27 to 18 of 32 cited) came from these answers.
- **No chance level.** Among answers that cited anything, the draft's share was 0.13 to 0.22 in every condition. With 5 sources an even split gives 0.20, and the answers cited 3.7 to 4.9 of the 5 sources on average: the 3B model cites nearly every source it is given.

The earlier reading, that following the suggestions lowered citation, is withdrawn. It was a bench artifact.

### What changed in the bench (report schemaVersion 2)

- Every generation asks Ollama for a 16,384-token window (`numCtx`, sent as `num_ctx`).
- The answer prompt keeps the GEO paper's instruction word for word at the top and adds one line after the sources: "Answer the question above using only these sources. Write in English. End every sentence with its citation, for example [1][2]."
- An answer with no valid `[n]` is a **format failure**. Reports count format failures on their own, and the main measures use valid answers only: **cited among valid answers**, and the **draft's share among valid answers** (position-adjusted word count, averaged per question) next to the **chance level**, the share an even split over the retrieved sources would give each of them (1 in 8 sources here, 0.125). The chance level is the draft's even-split share only in runs where the draft was retrieved. The draft's share counts every other valid run as 0, so when the draft is retrieved in fewer than all runs its share is pulled down by those runs.
- The paired test compares per-question means over valid answers. A question with no valid answer on one side is left out of the test and listed.
- k is 8 instead of 5, so each answer draws on the draft plus 7 competitor pages when the draft is retrieved.

### Model bake-off

Both small models ran `ce bench --runs 2` on both samples (before and after drafts, k 8, 16,384-token window, temperature 0.5, base seed 1), 32 answers each. The rule was the same as before: keep the model whose answers cite in the `[n]` format most reliably, measured as the share of answers with at least one valid citation and the share of answer sentences with at least one valid citation.

| Model         | Answers with a valid citation | Sentences with a valid citation |
| ------------- | ----------------------------- | ------------------------------- |
| `qwen2.5:3b`  | 32 of 32                      | 182 of 477 (38%)                |
| `llama3.2:3b` | 32 of 32                      | 522 of 599 (87%)                |

Both models cited in every answer, and `llama3.2:3b` cited more than twice as many sentences, so it stays the bench default. In a rough word-frequency check, no bake-off answer read as non-English.

### Canonical runs

```sh
# from the repository root; <slug> is espresso-bitterness or rag-explained
pnpm --filter @citation-equity/bench ce bench \
  --draft "$PWD/samples/<slug>/before.md" --after "$PWD/samples/<slug>/after.md" \
  --pack "$PWD/samples/<slug>/pack.json" --runs 8 --k 8 --record --out "$PWD/samples/<slug>/results"
```

The paths are absolute because `pnpm --filter` runs the command inside `packages/bench`.
- Settings: the bench defaults, `llama3.2:3b` (Q4_K_M, digest `a80c4f17acd5`), k 8, 8 runs per question, temperature 0.5, base seed 1, a 16,384-token window. Seeds are `1 + 1000 × question index + run`, and every report stores its settings.
- Ollama 0.40.9 on a Mac with an Apple M4 Pro and 24 GB of memory (model identifier Mac16,8, macOS 26.5), Node 24.22.1.
- Run on 2026-10-23: espresso from 18:37 to 18:52 PDT, RAG from 18:52 to 19:10 PDT. Each report's `createdAt` is the time its draft's runs finished.
- No prompt came near the window. Rebuilt offline from the same retrieval and seeds, the longest prompt (RAG after draft, seed 3001) is 4,165 words, about 5,600 tokens at 1.35 tokens per word, against 16,384.
- `results/` holds `before.json` and `after.json` (one `BenchReport` each), `comparison.json` (the paired comparison) and `recording.json` (every answer, keyed by `recordingKey`, so the runs replay with `RecordedAdapter`). Biome reformatted the JSON whitespace afterwards; the data is unchanged. Later the same day the share intervals moved from the normal quantile 1.96 to Student's t quantile (3.18 for 4 questions), and each report's `summary` was recomputed by replaying `recording.json`; the runs and answers are unchanged.

| Sample                | Draft  | Valid answers | Cited among valid (95% CI) | Draft share among valid (95% t interval) | Chance level | Retrieved |
| --------------------- | ------ | ------------- | -------------------------- | ---------------------------------------- | ------------ | --------- |
| `espresso-bitterness` | before | 32 of 32      | 18 of 32 (39% to 72%)      | 0.087 (0.000 to 0.189)                   | 0.125        | 24 of 32  |
| `espresso-bitterness` | after  | 32 of 32      | 21 of 32 (48% to 80%)      | 0.137 (0.048 to 0.227)                   | 0.125        | 32 of 32  |
| `rag-explained`       | before | 32 of 32      | 23 of 32 (55% to 84%)      | 0.086 (0.037 to 0.135)                   | 0.125        | 32 of 32  |
| `rag-explained`       | after  | 32 of 32      | 22 of 32 (51% to 82%)      | 0.095 (0.000 to 0.194)                   | 0.125        | 32 of 32  |

What these runs show:
- **No format failures.** All 128 answers carried a valid citation, against 13 of 128 in the first recording.
- **The draft's share sits near chance.** An answer cites 5.3 to 6.5 of its 8 sources on average. Three drafts were retrieved in all 32 runs, so 0.125 is their even-split share: both RAG drafts sit below it (0.086 and 0.095) and the espresso after draft above it (0.137). All three of their intervals include 0.125 (95% t intervals over the 4 questions; an earlier normal-quantile interval was too narrow for so few questions). The espresso before draft was retrieved in 24 of 32 runs, and its share counts the other 8 as 0, so its even-split share over all 32 runs is 0.094 (24 of 32 times 0.125), not the 0.125 in the table. Its measured share of 0.087 sits just under that, and most of its gap to 0.125 comes from retrieval, not from how often the model cited it.
- **One difference is retrieval, not citation.** The espresso before draft is never retrieved for the water-temperature question (0 of 8 runs) and the after draft always is, which is the +25 points in retrieved. When retrieved, the espresso before draft was cited in 18 of 24 runs and the after draft in 21 of 32.
- **No difference the test can separate from noise.** Paired over the 4 questions: espresso, cited among valid +9 points (sign-flip p = 1), share +0.050 (p = 0.25); RAG, cited among valid -3 points (p = 1), share +0.009 (p = 0.75). With 4 questions the smallest possible p is 0.125, so these runs can show a direction at most.

The after drafts score much higher on the checks (foundation score 40 to 69 for espresso, 42 to 68 for RAG, from `ce analyze` with its eleven checks, each draft's own question headings as targets and its title and topic questions for the reader's-words check; with the pack's four questions as targets, as the workspace sets them for the samples, 37 to 70 for espresso and 41 to 69 for RAG). Four checks are notes, not scored, since our own tests found no effect larger than 0.03: lists ([RESULTS_E1.md](../experiments/RESULTS_E1.md)), and question headings, cited sources and direct answer first ([RESULTS_E3.md](../experiments/RESULTS_E3.md)); with every check scored and without the reader's-words check, as when these runs were recorded, the same figures were 35 to 73 and 45 to 76. On these pages this model did not cite them more often, or give them a larger share, by an amount these runs can tell apart from chance. That fits the evidence page, which grades no check as strongly supported.

### Larger models

A pre-registered sensitivity test on four larger open models (9B to 31B) gave the same picture. The floor held: an off-topic page was almost never cited. But no model met the pre-registered bar of a 0.10 share gain for an answer-first rewrite (gains of +0.007 to +0.034), so none qualified for the planned follow-up. The small positive shifts were consistent across questions and are treated as exploratory. See [experiments/RESULTS_sensitivity.md](../experiments/RESULTS_sensitivity.md) and [experiments/README.md](../experiments/README.md).

### Replay check

`packages/bench/test/samples.test.ts` replays each sample from `recording.json` with `RecordedAdapter` and asserts that the replayed runs, summaries and comparison equal the committed files, so the demo's numbers come from these exact answers. The workspace shows the reports but not the recordings or the answer text, which stay out of its bundle.
