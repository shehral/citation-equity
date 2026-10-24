# E1 pipeline: data and edited versions

This folder builds the page sets and every edited version for E1, as pre-registered in [`../PREREG_E1.md`](../PREREG_E1.md) (r2). Measurement and analysis (prompts, judges, scores, tests) are a separate part of the pipeline and read the files below.

Nothing fetched or derived from GEO-bench or C-SEO Bench is committed: `data/` and `out/` are gitignored. The page set is research use only and never redistributed.

## Interfaces

| File                      | One line per                     | Fields                                                                                                                                                      |
| ------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/pages.jsonl`        | admitted page                    | `page_id, query_id, set, query, url, source, title, text, words, tokens_max, cut, sha256, role`                                                             |
| `data/applicability.jsonl`| (query, arm), arms 1-14 and ALL  | `query_id, arm, applicable, reason`                                                                                                                         |
| `data/versions.jsonl`     | version of a target              | `version_id, query_id, set, arm, text, title, valid, attempts, excluded_reason, edit_distance, length_ratio, key_terms_delta, added_words`                   |

- `set` is `main`, `replication` or `smoke`; `source` is `live`, `wayback`, `cseo` or `sample`; `role` is `target`, `competitor` or `donor`.
- `arm` in versions is `original`, `1`-`14`, `P2`, `P3`, `P5`, `P6`, `P7`, `P8`, `P10`, `P12`, `ALL` or `P_ALL`. `version_id` is `<query_id>:<arm>`.
- A version is used only when `valid` is true. `excluded_reason` starting `not applicable` (arm 7 whose editor answered NONE) is not a validity exclusion; every other reason starts `invalid:` and counts as one.
- A placebo `P_A` exists only when arm A's edit is valid. A version is written only for pairs the applicability table marks applicable.
- `edit_distance` is a word-level Levenshtein distance from the original; `length_ratio` is words of the version over words of the original (title and text); `key_terms_delta` is the change in occurrences of the query's key terms.

## Files

| File | What it does |
| --- | --- |
| `fetch_geobench.ts` | GEO-bench rows (datasets-server API, cached in `.cache/geobench`), the query filter, live fetch through the bench's `packFromUrls` (robots.txt respected), and the Wayback `2023id_` fallback. Appends to `data/raw/live.jsonl` or `data/raw/wayback.jsonl` and resumes. |
| `cseo_replication.ts` | C-SEO Bench `web` rows (shares `.cache/cseo` with `ce pack cseo`) to `data/raw/cseo.jsonl`. |
| `normalize.py` | Removes images, footnote markers and definitions, turns own-site links into text; usable-page rules; the 3,000-token cap at the last heading (larger of the two judge tokenizers, or `--approx`). Writes `candidates.jsonl`, `fetch_log.jsonl`, `wayback_needed.jsonl`. |
| `draw.py` | Query admission (target 80, floor 60, the four-page fallback; replication: first 60 with 5 usable pages; smoke: all 8) and the sha256 target, donor and competitor draw. Writes `pages.jsonl` and `admission.json`. |
| `engine_json.ts`, `engine_cli.ts` | The engine's checks and artifacts as JSON, offsets converted from UTF-16 to code points. The CLI reads JSONL on stdin; it is bundled into one file, `out/bundle/engine_cli.js`, so Python (here and on the cluster) can call it. |
| `applicability.ts` | Runs the engine on every target with the query as the target question, writes `engine_original.jsonl` and the frozen `applicability.jsonl`. |
| `deterministic_arms.py` | Arms 4, 9, 11, 13, 14 and the arm 11-14 "feature already present" rules. |
| `editor.py`, `prompts/*.txt` | Spans, one strict prompt per LLM arm and placebo (committed verbatim), JSON span replacements, splicing, ALL step by step, P_ALL, regenerate once. `--backend vllm` on Explorer, `--backend fake` locally. |
| `validate.py` | The six validity checks. |
| `edit.sbatch`, `normalize.sbatch`, `generate.sbatch` | Explorer jobs: the editor (Gemma-4-31B-it, one H200 or 2x A100), the tokenizer cap (CPU) and the judges' answers (measurement). |
| `local.env.example` | The cluster settings the three jobs read: copy it to `local.env` (gitignored) next to them on the cluster and fill it in. |
| `smoke.sh` | The whole pipeline on the 8 sample questions with the fake editor (no reported results). |
| `tests/` | `python3 -I -m unittest discover -s experiments/e1/tests` and the Vitest project `e1`. |

## Running it

Commands run from the repository root. TypeScript steps use the bench's `tsx`.

```sh
# 0. Build the engine bridge (also done by smoke.sh).
pnpm exec tsup experiments/e1/engine_cli.ts --format esm --target node22 -d experiments/e1/out/bundle

# 1. Fetch (live), in dataset order; rerun to resume. --hours caps the fetch at 6 hours.
pnpm --filter @citation-equity/bench exec tsx "$PWD/experiments/e1/fetch_geobench.ts" --splits test,val
pnpm --filter @citation-equity/bench exec tsx "$PWD/experiments/e1/cseo_replication.ts"

# 2. Normalize. On Explorer with the real tokenizers (normalize.sbatch), or locally with --approx.
python3 -I experiments/e1/normalize.py --approx

# 3. Wayback for every page whose live fetch failed or was unusable, then normalize again (same mode).
pnpm --filter @citation-equity/bench exec tsx "$PWD/experiments/e1/fetch_geobench.ts" --source wayback
python3 -I experiments/e1/normalize.py --approx

# 4. Admission and roles, then the frozen applicability table.
python3 -I experiments/e1/draw.py
pnpm --filter @citation-equity/bench exec tsx "$PWD/experiments/e1/applicability.ts"

# 5. Edit on Explorer (edit.sbatch), copy versions.jsonl back to experiments/e1/data/.
```

If `draw.py` reports fewer than 60 five-page queries and the fetch has not reached the end of the `val` split or 6 hours, fetch more queries before admitting four-page ones: the fallback rule looks only at what was fetched.

## On Explorer

The sbatch files hold no account or path of their own. They read site settings from the environment or from a `local.env` file in the folder you submit from, and stop with a message naming any required setting that is missing. `$CE_ROOT` below stands for your project folder on the cluster (for example `/projects/<your-project>/citation-equity`).

1. **Once: write `local.env`.** Copy `experiments/e1/local.env.example` to `local.env` and fill in your Slurm allocation (`SBATCH_ACCOUNT`), `CE_ROOT`, the Python of an env with vLLM (`CE_PYTHON`) and the Hugging Face cache that holds the models (`HF_HOME`). Optional: `CE_NODE` (a Node 22 or newer binary for the editor's engine bridge, when `node` on the compute node is missing or older; a Node module in `CE_MODULES` works too), `CE_CUDA_COMPAT` (NVIDIA forward-compat libcuda), `CE_MODULES` (default `miniconda3/24.11.1`) and `SBATCH_OUTPUT`/`SBATCH_ERROR` for logs. It is gitignored, so it stays on your machine and the cluster.
2. **Copy the code and data.** `experiments/e1/*.py`, `experiments/e1/*.sbatch`, `experiments/e1/prompts/`, `experiments/e1/out/bundle/engine_cli.js` and your `local.env` to `$CE_ROOT/code/e1/` (keeping that layout); `pages.jsonl` and `applicability.jsonl` to `$CE_ROOT/data/e1/` for the editor, the raw fetch records to `$CE_ROOT/data/e1/raw/` for normalization. For `generate.sbatch`, `experiments/explorer/batch_generate.py` goes to `$CE_ROOT/code/` and the batch files to `$CE_ROOT/e1/batches/`.
3. **Check the settings without submitting.** From `$CE_ROOT/code/e1`, `CE_DRY_RUN=1 bash edit.sbatch` (or `normalize.sbatch`, or `generate.sbatch` with `JUDGE` and `BATCH` set) prints the resolved settings and paths and exits before loading modules or touching a GPU.
4. **Submit from `$CE_ROOT/code/e1`.** `sbatch` reads `SBATCH_ACCOUNT` (and `SBATCH_OUTPUT`/`SBATCH_ERROR`) when you submit, so source `local.env` first:

   ```sh
   cd $CE_ROOT/code/e1
   . ./local.env && sbatch normalize.sbatch
   . ./local.env && sbatch --gres=gpu:h200:1 edit.sbatch
   . ./local.env && TP=2 sbatch --partition=gpu-short --time=02:00:00 --gres=gpu:a100:2 edit.sbatch
   . ./local.env && JUDGE=gemma-4-12b BATCH=main.gemma-4-12b.tier1 sbatch --gres=gpu:a100:1 generate.sbatch
   ```

   `DATA=<folder>` overrides `$CE_ROOT/data/e1` for the editor and normalization. Logs go to `<job name>-<job id>.out` and `.err` in the submit folder, or under `$CE_ROOT/logs` when `local.env` sets `SBATCH_OUTPUT` and `SBATCH_ERROR` there (create the folder first; Slurm does not).

## Choices the pre-registration leaves open

- **Question word** (Data 2): an interrogative (what, why, how, when, where, which, who, whom, whose) at the start; yes/no openers such as "is" or "can" do not count. Queries about named private individuals are dropped by id after review (`PRIVATE_INDIVIDUAL_QUERY_IDS`, empty until then).
- **Usable page** (Data 5): (a) and (b) are judged on the capped text, as the replication set states. Words are counted by a Python approximation of the engine's word count; key terms are a twin of the engine's `contentTerms`, checked against recorded engine output.
- **Cap**: a heading at offset 0 is not a cut point; with no heading or paragraph boundary before the limit the cut falls at the last line break, then the last space. The approximate count is whitespace words x 1.35.
- **Own-site links**: same host with `www.` ignored, relative links and fragments; Wayback-wrapped URLs are unwrapped first.
- **Donor draw**: the same rule as the target, including the Wikipedia exclusion.
- **Spans**: arm 1 uses only the paragraphs flagged for an opener; arm 6's span grows to the paragraph holding the quote, and the quote is added after it as `According to <speaker>, "<quote>"`; arm 12 uses the title, the first heading and the first prose paragraph. An arm whose check reports no span is not applicable.
- **Arms 5-7 insert only**: check 1 also requires the original span text to survive inside the span. Placebos for 5-7 paraphrase the sentence each insertion attaches to.
- **Check 2 for features**: arm 1 needs fewer unresolved openers; arm 12 fewer missing key terms; arm 13 more headings; arm 11 a definition as the first sentence; arm 14 `Updated:` under the title. A placebo must change at least one span.
- **Check 2 for arm 9** is its feature, not a rise of `question-coverage`: the query as an H2 directly under the title, followed by a sentence copied verbatim from the page. The arm is defined by the extraction ("the page sentence with the highest overlap"), and that sentence often misses the check's 8-40-word, 60% key-term bar, so a literal "the check rises" rule would exclude most arm 9 pairs by construction (smoke 0/2, development 1/5) for a Tier 1 arm. Applicability still uses the check (not applicable when it scores 0.9 or more).
- **Check 2 for arm 7 on the replication set** is its feature: every edited claim names the donor (`(source: <donor name>)`, the name from `validate.donor_name`). `cited-sources` counts only absolute http(s) links and footnotes, and the replication section requires attribution by name because C-SEO documents carry no URL, so the check cannot rise there. On the main set (donors with a URL) arm 7 still needs `cited-sources` to rise. ALL-text step 7 follows the same rule.
- The two check 2 readings above resolve conflicts inside PREREG_E1 r2 (check 2's "arms 2-10" against arm 9's extractive definition, and against the replication set's attribution by name). The prereg text should say so before the freeze.
- **Check 3**: arm 2's new heading words must stem from the heading or its section's first paragraph (or be function words); arm 12 may add only query words and function words. Numbers lose trailing `.` and `,` before the lookup.
- **Check 4** compares links by URL.
- **Check 5** uses whole-page words for arms and ALL, span words for placebos. ALL steps run checks 1-4 and 6; the whole ALL version then runs checks 3 and 5.
- **ALL**: a step is skipped when the recomputed check is no longer applicable or already scores 0.9 or more, or when arm 7's editor answers NONE; a step that fails twice excludes ALL. On the replication set ALL-text uses step 8 although arm 8 is not run alone there.
- **Editor**: thinking mode off (`--thinking` turns it on); `max_model_len` 20,480.
