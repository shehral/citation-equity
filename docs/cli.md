# Command line

The `ce` command runs the same checks as the web app, plus the parts that need your machine: the citation test on a local model, fetching pages you name, and reading your own logs and exports. It needs Node 24 and pnpm 10.

```sh
pnpm install && pnpm build
pnpm ce --help                      # or: alias ce="node packages/bench/bin/ce.js"
```

Run it from the repository root. `pnpm ce <command> --help` lists every option of a command.

## Make a test pack

A test pack is the set of questions and competitor pages the citation test runs your draft against. The web app's **Test it** section can load one for your own post (**Load a test pack**), and `ce bench --pack` reads the same file. There are three ways to make one:

1. **From pages you name.** Put one URL per line in a text file (`#` starts a comment), then:

   ```sh
   ce pack from-urls --question "Why does my espresso taste bitter?" --urls urls.txt --id espresso --out pack.json
   ```

   It fetches each page, respects robots.txt, keeps the readable text and skips pages it cannot read (the reason is printed). The pack holds one question. Keep it on your machine: it contains other people's pages.

2. **From C-SEO Bench, for research.** `ce pack cseo --out pack.json` downloads a question-answering subset of [C-SEO Bench](https://huggingface.co/datasets/cseo/cseo-bench) into a local cache (`.cache/cseo`, gitignored). Pick domains with `--domains` and the size with `--max-queries`. The data is fetched at run time and never committed; its dataset card says `license: cc` without naming a specific license (see [NOTICE](../NOTICE)).

3. **By hand.** A pack is JSON:

   ```json
   {
     "schemaVersion": 1,
     "packId": "espresso",
     "title": "Espresso pack",
     "source": "Written by hand",
     "license": "MIT",
     "synthetic": true,
     "queries": [
       {
         "queryId": "q1",
         "query": "Why does my espresso taste bitter?",
         "documents": [
           { "docId": "q1-d1", "title": "Bitter espresso: five causes", "text": "...", "synthetic": true }
         ]
       }
     ]
   }
   ```

   Each document may also carry a `url`. Mark every page you wrote yourself `"synthetic": true`. The two packs in [samples/](../samples/README.md) are complete examples, with 4 questions and 12 pages per question.

## Commands

| Command | What it does |
| --- | --- |
| `ce analyze <draft.md> [--questions q.txt] [--format md\|html] [--json]` | Both scores, every check and the suggestions. |
| `ce bench --draft <before.md> [--after <after.md>] --pack <pack.json> [--runs 8] [--k 8] [--model llama3.2:3b] [--temperature 0.5] [--seed 1] [--num-ctx 16384] [--out results] [--record]` | The citation test, before and after, on a local model. |
| `ce pack from-urls --question "..." --urls <urls.txt> --id <packId> --out <pack.json>` | A one-question pack from pages you name. |
| `ce pack cseo --out <pack.json> [--domains web,news] [--max-queries 20] [--max-doc-chars 4000] [--cache-dir .cache/cseo]` | A C-SEO Bench subset, downloaded and cached. |
| `ce site <url> [--json]` | Can AI read your published page. |
| `ce signals logs <access.log> [--format combined\|jsonl] [--json]` | AI crawler visits and AI referrals in your log. |
| `ce signals bing <export.csv> [--json]` | Citations from a Bing AI Performance export. |
| `ce questions --from-search-console <q.csv> \| --from-bing <b.csv> \| --generate <draft.md> [--local-model] [--model <name>]` | Reader questions from real queries or a draft. |
| `ce live --engine gemini --questions <q.txt> --url <page> [--runs 8] [--model <name>] [--out results]` | Does Gemini with Google Search cite your page. |
| `ce sources --live <report.json> \| --pasted <answers.txt> [--own example.com]` | Which sites AI answers cite, grouped by type. |

Exit codes: 0 on success, 1 for a usage or input error, 2 when the model server cannot be reached, the model is not available, or a required API key is not set.

## Details by command

**`ce analyze`** prints the score under both weightings (Standard, called `Foundation score` in the output, and By evidence, called `Evidence score`, which weights each check by its evidence grade), each check with its grade, and every suggestion with the text it points at. Without `--questions`, the draft's own question headings are scored as its reader questions, and questions made from its title and headings are listed as suggestions, not scored. HTML input is converted to Markdown first; `--format` overrides the guess from the file extension.

**`ce bench`** talks to a local [Ollama](https://ollama.com/download) by default (`http://127.0.0.1:11434`; pull the model first with `ollama pull llama3.2:3b`). `--adapter openai --base-url <url>` uses any OpenAI-compatible server instead, which then receives the draft in every prompt. `OPENAI_API_KEY` is sent only to https URLs; a plain http server, such as one on your own network, needs `--send-key`. `--record` also writes `recording.json`, every answer keyed so the run can be replayed exactly. Every bench result carries this line: _Content check on a local model over a fixed page set. It does not predict live AI engines._ How the test works and what it found on the samples: [samples/README.md](../samples/README.md).

**`ce bench --export-prompts` and `--answers`** split a run in two for larger models on a GPU cluster: the first writes every prompt to a JSONL file without calling a model, the second replays answers generated elsewhere into the normal reports. See [experiments/README.md](../experiments/README.md).

**`ce site`** fetches the page and its robots.txt and checks crawler access for each AI crawler (from each operator's own documentation), rendering without JavaScript, indexing and snippet directives, canonical URL, byline, dates and structured data. The page check is reported on its own and never changes a draft's score.

**`ce signals logs`** reads an access log in combined format or JSON lines (guessed from the first lines unless you pass `--format`). **`ce signals bing`** reads the AI Performance export from Bing Webmaster Tools.

**`ce questions`** ranks reader questions from a Search Console Performance export (Queries table), a Bing AI Performance export (grounding queries) or a draft. With `--generate`, `--local-model` also asks your local Ollama for more.

Microsoft and Google do not publish the column names of these exports, so the readers match the documented metric names through lists of likely headers and fail with the headers they found. If yours fails, please open an issue with the header row.

**`ce live`** asks Gemini with Google Search each question `--runs` times through the API and records whether its sources include your page, following Google's redirect link for each source to learn where it points. It needs `GEMINI_API_KEY`, which is never logged or saved. It measures one engine through its API, which can differ from what people see in the consumer app.

**`ce sources`** reads a `ce live` report, or answers you copied from ChatGPT, Perplexity, Gemini or Copilot (each starting with a line `Q: <question>`), and groups the cited sites by type with what you can do about each. It reads local files only. `--own` names your site so it is counted apart.

## What the command line sends

It fetches only what you ask for: the URLs you name (`ce site`, `ce pack from-urls`), C-SEO Bench (`ce pack cseo`), your local Ollama, and Gemini or an OpenAI-compatible server when you choose them. Drafts stay on your disk unless you point `ce bench` at a hosted server.
