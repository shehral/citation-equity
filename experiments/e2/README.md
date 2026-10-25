# E2 pipeline: heading markup or the query's words, and the editor check

This folder runs E2 as planned in [`../PLAN_E2.md`](../PLAN_E2.md). It reuses E1's pipeline in [`../e1`](../e1) (prompts, judges, seeds, score, statistics); E1's behaviour for E1 runs is unchanged.

- **E2a** adds two deterministic versions of arm 9 for every query whose E1 arm 9 version is valid (54 main, 52 replication): **9W** (the query as a plain paragraph, then arm 9's sentence) and **9P** (`## <first N words of S>` then S, where S is the page's prose sentence with the fewest query key terms). Only 9W and 9P are judged; the original's and arm 9's answers are E1's.
- **E2b** edits arm 12 and ALL again (with P12 and P_ALL) with Qwen3.8-27B on the main set, and judges those versions and the originals with Gemma-4-12B and Qwen3.5-9B.

Nothing under `data/` or `out/` is committed (both are gitignored): they hold page text, prompts and answers.

## Files

| File | What it does |
| --- | --- |
| `make_versions.py` | Writes E2a's 9W and 9P rows (E1's `versions.jsonl` schema) for every query whose E1 arm 9 is valid, and `make_versions.json` with the counts. It rebuilds arm 9 from the same engine output and stops if that differs from E1's arm 9 text, so 9W and 9P share E1's sentence. Uses E1's `data/engine_original.jsonl` when present, else the engine bridge. |
| `reuse_answers.py` | E2b: takes E1's answer for every Gemma prompt of an original that is byte-identical to E1's prompt with the same key, and removes those keys from the batch files. Every other prompt is generated. Writes `reuse.json`. |
| `analyze_e2.py` | E2a's planned tests and reported contrasts per set, E2b's sign rule, with `../e1/analyze.py`'s functions. Writes `out/analysis_e2.json`. |
| `report_e2.py` | `out/RESULTS_E2.md` from `out/analysis_e2.json`. |
| `tests/` | `python3 -I -m unittest discover -s experiments/e2/tests` (E1's: `-s experiments/e1/tests`). |

The E1 code that E2 uses: `deterministic_arms.arm9w` and `arm9p` (next to `arm9`), arms `9W` and `9P` in `e1_common` (tier 1, parent arm 9), the judge `qwen3.5-9b` (`Qwen/Qwen3.5-9B`; E1's judge order is unchanged), `build_prompts.py --without-original` (a folder of E2 versions and pages only; tokens are counted with the tokenizers of the judges named in `--judges`), `generate.sbatch` with `JUDGE=qwen3.5-9b` and `RUN=<folder under $CE_ROOT>`, and `edit.sbatch`, which refuses E1's data folder for any editor other than Gemma-4-31B.

## Local layout

| Folder | Holds |
| --- | --- |
| `experiments/e2/data/` | E2a: `versions.jsonl` and `make_versions.json` (from `make_versions.py`), copies of E1's `pages.jsonl` and `applicability.jsonl`, and what comes back from the cluster: `prompts.jsonl`, `prompt_build.json`, `answers/`. |
| `experiments/e2/data/b/` | E2b: `pages.jsonl`, `applicability.jsonl`, and from the cluster `versions.jsonl`, `prompts.jsonl`, `prompt_build.json`, `reuse.json`, `answers/`. |
| `experiments/e2/out/a/`, `out/b/` | `score.py` outputs for E2a and E2b. |
| `experiments/e2/out/` | `analysis_e2.json` and `RESULTS_E2.md`. |

## On Explorer, in order

The jobs, `local.env` and layout are E1's (see `../e1/README.md`, "On Explorer"). `$CE_ROOT` is your project folder on the cluster. Every `sbatch` line runs from `$CE_ROOT/code/e1` after `. ./local.env`; check any of them first with `CE_DRY_RUN=1` and `bash` in place of `sbatch`.

### 0. Code, folders and the E2a versions

```sh
# Locally, from the repository root: E2a's versions (stdlib only; E1's data/engine_original.jsonl or the engine bundle).
python3 -I experiments/e2/make_versions.py
# Expected: main 9W and 9P, 54 versions each; replication 9W and 9P, 52 each; all valid.

# Copy the code again: experiments/e1/*.py and *.sbatch to $CE_ROOT/code/e1 (prompts/, the engine bundle and
# local.env stay as they are), and experiments/e2/*.py to $CE_ROOT/code/e2.
# On the cluster:
mkdir -p $CE_ROOT/data/e2/a $CE_ROOT/data/e2/b $CE_ROOT/e2/a/batches $CE_ROOT/e2/b/batches
cp $CE_ROOT/data/e1/pages.jsonl $CE_ROOT/data/e1/applicability.jsonl $CE_ROOT/data/e2/a/
cp $CE_ROOT/data/e1/pages.jsonl $CE_ROOT/data/e1/applicability.jsonl $CE_ROOT/data/e2/b/
# and copy experiments/e2/data/versions.jsonl to $CE_ROOT/data/e2/a/versions.jsonl.
```

Download `Qwen/Qwen3.5-9B` into `$HF_HOME` before E2b's generation: the jobs read the cache offline and stop when a model is missing.

### 1. E2a: prompts and answers for 9W and 9P

```sh
cd $CE_ROOT/code/e1
# Prompts for E1's two judges, counted with their tokenizers (loads tokenizers only; use an interactive job
# if your site limits login-node memory). The original and arm 9 are not rebuilt: their answers are E1's.
. ./local.env && HF_HOME=$HF_HOME HF_HUB_OFFLINE=1 $CE_PYTHON -I build_prompts.py --data $CE_ROOT/data/e2/a --without-original
cp $CE_ROOT/data/e2/a/batches/*.prompts.jsonl $CE_ROOT/e2/a/batches/

# Four jobs: each set with each judge (seeds 1-8, tier 1).
. ./local.env && RUN=e2/a JUDGE=gemma-4-12b BATCH=main.gemma-4-12b.tier1 sbatch --gres=gpu:a100:1 generate.sbatch
. ./local.env && RUN=e2/a JUDGE=qwen3.8-27b BATCH=main.qwen3.8-27b.tier1 sbatch --gres=gpu:h200:1 generate.sbatch
. ./local.env && RUN=e2/a JUDGE=gemma-4-12b BATCH=replication.gemma-4-12b.tier1 sbatch --gres=gpu:a100:1 generate.sbatch
. ./local.env && RUN=e2/a JUDGE=qwen3.8-27b BATCH=replication.qwen3.8-27b.tier1 sbatch --gres=gpu:h200:1 generate.sbatch
```

With no query over 31,000 tokens (E1 refused none), the batches hold 864 prompts per main job and 832 per replication job, 3,392 in all. Answers land in `$CE_ROOT/e2/a/answers/<BATCH>.jsonl`.

**How E1's answers are reused.** The prompt depends only on the query, the target version's title and text, the three competitors and the seed: the same template, source order and slot rotation as E1 (`build_prompts.py`, unchanged for E1). So the original's and arm 9's prompts would be byte for byte E1's, and their E1 answers stand: `analyze_e2.py` reads E1's cells (`experiments/e1/out/cells.jsonl`) for the original and arm 9, and E2a's cells for 9W and 9P. The tests check that an E2 prompt equals E1's prompt for the same text.

### 2. E2b: Qwen3.8-27B edits arm 12 and ALL

```sh
cd $CE_ROOT/code/e1
. ./local.env && CE_DRY_RUN=1 MODEL=Qwen/Qwen3.8-27B DATA=$CE_ROOT/data/e2/b SETS="--set main" EXTRA="--arms 12" bash edit.sbatch
. ./local.env && MODEL=Qwen/Qwen3.8-27B DATA=$CE_ROOT/data/e2/b SETS="--set main" EXTRA="--arms 12" sbatch --gres=gpu:h200:1 edit.sbatch
```

This runs `editor.py --backend vllm --model Qwen/Qwen3.8-27B --set main --arms 12` with E1's prompts, spans, validators and settings (temperature 0, thinking off, one regenerate) and writes `$CE_ROOT/data/e2/b/versions.jsonl`: the original, 12, P12 (when 12 is valid), ALL and P_ALL (when ALL is valid). `--arms 12` leaves out only the other arms run alone; ALL and its steps run as in E1. E1's `versions.jsonl` is never written: `edit.sbatch` stops if a non-Gemma editor would write to `$CE_ROOT/data/e1`. Summarize the validity with `python3 -I validity_report.py $CE_ROOT/data/e2/b/versions.jsonl`.

### 3. E2b: prompts, Gemma's reused originals, answers

```sh
cd $CE_ROOT/code/e1
. ./local.env && HF_HOME=$HF_HOME HF_HUB_OFFLINE=1 $CE_PYTHON -I build_prompts.py --data $CE_ROOT/data/e2/b --sets main \
  --judges gemma-4-12b,qwen3.5-9b

# Gemma's answers for the originals come from E1 where the prompt is byte-identical (the rest are generated).
# --e1-prompts is the prompts.jsonl E1's batches were built from; --e1-answers is E1's answer folder.
. ./local.env && $CE_PYTHON -I $CE_ROOT/code/e2/reuse_answers.py --data $CE_ROOT/data/e2/b \
  --e1-prompts $CE_ROOT/data/e1/prompts.jsonl --e1-answers $CE_ROOT/e1/answers --answers-out $CE_ROOT/e2/b/answers
cp $CE_ROOT/data/e2/b/batches/*.prompts.jsonl $CE_ROOT/e2/b/batches/

# Four jobs: tier 1 is the originals (Qwen3.5-9B; Gemma's that were not reused), ALL and P_ALL; tier 2 is 12 and P12.
. ./local.env && RUN=e2/b JUDGE=gemma-4-12b BATCH=main.gemma-4-12b.tier1 sbatch --gres=gpu:a100:1 generate.sbatch
. ./local.env && RUN=e2/b JUDGE=gemma-4-12b BATCH=main.gemma-4-12b.tier2 sbatch --gres=gpu:a100:1 generate.sbatch
. ./local.env && RUN=e2/b JUDGE=qwen3.5-9b BATCH=main.qwen3.5-9b.tier1 sbatch --gres=gpu:a100:1 generate.sbatch
. ./local.env && RUN=e2/b JUDGE=qwen3.5-9b BATCH=main.qwen3.5-9b.tier2 sbatch --gres=gpu:a100:1 generate.sbatch
```

`reuse.json` says how many answers were reused and, for every original prompt that was not, why (no E1 prompt with that key, a prompt that differs, or no E1 answer). If it reports any, those prompts stay in the Gemma tier 1 batch and are generated.

### 4. Back on your machine: score, analyze, report

```sh
# E2a: copy $CE_ROOT/data/e2/a/prompts.jsonl and prompt_build.json to experiments/e2/data/, and
# $CE_ROOT/e2/a/answers/*.jsonl to experiments/e2/data/answers/.
python3 -I experiments/e1/score.py --data experiments/e2/data --out experiments/e2/out/a

# E2b: copy versions.jsonl, prompts.jsonl, prompt_build.json and reuse.json from $CE_ROOT/data/e2/b to
# experiments/e2/data/b/, and $CE_ROOT/e2/b/answers/*.jsonl (with reused-e1.gemma-4-12b.jsonl) to experiments/e2/data/b/answers/.
python3 -I experiments/e1/score.py --data experiments/e2/data/b --out experiments/e2/out/b --sets main

python3 -I experiments/e2/analyze_e2.py
python3 -I experiments/e2/report_e2.py
```

`analyze_e2.py` reads E1's `data/` and `out/` (for the original and arm 9, and for E1's sign in E2b) and writes `experiments/e2/out/analysis_e2.json`; a part whose cells are not there yet is reported as not run. `report_e2.py` writes `experiments/e2/out/RESULTS_E2.md`.

## Choices the plan leaves open

- **First N words of S** are S's words as the pipeline counts them (`common.count_words`), joined by single spaces, without markup, link targets or punctuation. When S has fewer than N words the heading is all of S's words.
- **Fewest query key terms** counts distinct key terms, as arm 9's "most" does; length is `common.count_words`.
- **9P's validity check** compares sets of key terms: the heading may repeat a key term S has, never add one S lacks. On the current data no S has any key term, so 9P's key-term change is 0 on every page.
- **9W and 9P are not given E1's length check** (the plan lists two checks). Their length ratios are reported: 9W's equal arm 9's, 9P's are slightly lower.
- **The length and key-term regression** is reported for each planned test and does not change a label, unlike E1's "possibly through length or query-term overlap": in 9 vs 9P the key-term change is the very thing tested.
- **E2b with fewer than 30 analyzable queries** still gets the sign rule (the plan's rule), and the report flags it.
- **E2b's p-values** are shown for reference; the plan's rule is the sign of d.
