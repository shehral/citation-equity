# E3 pipeline: more queries and one more attempt for seven checks

This folder runs E3 as planned in [`../PLAN_E3.md`](../PLAN_E3.md): question headings (arm 2), tables (4), statistics (5), attributed quotes (6), cited sources (7), direct answer first (8) and explicit comparisons (10), the checks E1 could not judge. It reuses E1's pipeline in [`../e1`](../e1) (draw rule, applicability rules, editor, prompts, validators, judges, seeds, score and statistics); E1's behaviour for E1 runs is unchanged.

- **New queries.** `e3`: the 72 five-page GEO-bench test queries E1 did not use (E1's 80 and the timing query `geo-test-939` left out), with E1's target, donor and competitor draw. `e3-four`: the 108 queries with exactly four usable pages, with the same draw minus the donor, for arms 2, 4, 8 and 10 only.
- **One more attempt.** Every LLM edit (and its placebo) gets up to three attempts: a first try and two regenerates with the validator's message. E1's main-set pairs that ended invalid get their third attempt now, from E1's last failure; pairs that passed in E1 are untouched.
- **Pooled analysis.** Every query with a valid pair, E1's and new ones together, with E1's answers reused for the pairs E1 already judged.

Nothing under `data/` or `out/` is committed (both are gitignored): they hold page text, prompts and answers.

## Files

| File | What it does |
| --- | --- |
| `admit.py` | Admits `e3` and `e3-four` from E1's `candidates.jsonl` with `draw.py`'s functions (E1's admission is recomputed and must match E1's `pages.jsonl`), writes `pages.jsonl` (E1's page schema) and `admission_e3.json`, then the applicability table: E1's rules (a Python twin of `applicability.ts` / `e1_lib.ts`, checked against E1's frozen table and against `applicability.ts` on E3's pages) on the engine output (E1's `engine_original.jsonl` where it has the page, else the engine bridge). Arms a set does not run are written as not applicable. |
| `reuse_e3.py` | E2's reuse rule (`../e2/reuse_answers.py`) for both judges: an E3 prompt takes E1's answer only when E1 has a byte-identical prompt with the same key; those keys leave the batch files. Writes `reuse.json`. |
| `analyze_e3.py` | The pooled analysis and the three breakdowns, with `../e1/analyze.py`'s functions. Writes `out/analysis_e3.json`. |
| `report_e3.py` | `out/RESULTS_E3.md` from `out/analysis_e3.json`, in plain language. |
| `tests/` | `python3 -I -m unittest discover -s experiments/e3/tests` (E1's: `-s experiments/e1/tests`). |

The E1 code E3 uses, beyond E1's own steps: `editor.py --max-attempts N` (default 2, E1's) and `--retry-from <E1 versions.jsonl>` (`run_retry`), the editor's `--set e3` and `--set e3-four`, `score.py --sets e3,e3-four` (scored only when named), and `edit.sbatch`, which refuses `--max-attempts` and `--retry-from` on E1's data folder.

## Local layout

| Folder | Holds |
| --- | --- |
| `experiments/e3/data/` | New queries: `pages.jsonl`, `admission_e3.json`, `engine_original.jsonl`, `applicability.jsonl` (from `admit.py`), and from the cluster `versions.jsonl`, `prompts.jsonl`, `prompt_build.json`, `reuse.json`, `answers/`. |
| `experiments/e3/data/retry/` | E1's retried pairs: copies of E1's `pages.jsonl` and `applicability.jsonl`, and from the cluster `versions.jsonl` (only the edits made now), `prompts.jsonl`, `prompt_build.json`, `reuse.json`, `answers/`. |
| `experiments/e3/out/new/`, `out/retry/` | `score.py` outputs. |
| `experiments/e3/out/` | `analysis_e3.json` and `RESULTS_E3.md`. |

## Locally, first

From the repository root, with E1's `data/` in `experiments/e1/data` and the engine bundle built (`../e1/README.md`, step 0):

```sh
python3 -I experiments/e3/admit.py
mkdir -p experiments/e3/data/retry
cp experiments/e1/data/pages.jsonl experiments/e1/data/applicability.jsonl experiments/e3/data/retry/
```

With the current fetch `admit.py` prints: 391 main candidate queries, 153 with five usable pages (80 in E1's main set, 1 timing) and 108 with four; `e3` 72 queries, `e3-four` 108 (792 pages; every new target from the engine bridge). Applicable new targets per arm:

| Arm | 2 | 4 | 5 | 6 | 7 | 8 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `e3` (72) | 60 | 9 | 33 | 58 | 65 | 37 | 23 |
| `e3-four` (108) | 75 | 3 | not run | not run | not run | 55 | 23 |
| New targets | 135 | 12 | 33 | 58 | 65 | 92 | 46 |

## On Explorer, in order

The jobs, `local.env` and layout are E1's (`../e1/README.md`, "On Explorer"). `$CE_ROOT` is your project folder on the cluster. Every `sbatch` line runs from `$CE_ROOT/code/e1` after `. ./local.env`; check any of them first with `CE_DRY_RUN=1` and `bash` in place of `sbatch`.

### 0. Code and folders

Run the edit jobs only after PLAN_E3's amendment 1 (the tables check) is decided: arm 4 is deterministic, so E3 builds and validates it again with the `validate.py` that is in `$CE_ROOT/code/e1` when the jobs run.

```sh
# Copy the code again: experiments/e1/*.py and *.sbatch to $CE_ROOT/code/e1 (prompts/, the engine bundle and
# local.env stay as they are), experiments/e2/reuse_answers.py to $CE_ROOT/code/e2 and experiments/e3/*.py
# to $CE_ROOT/code/e3. Then experiments/e3/data/pages.jsonl and applicability.jsonl to $CE_ROOT/data/e3/new/.
# On the cluster:
mkdir -p $CE_ROOT/data/e3/new $CE_ROOT/data/e3/retry $CE_ROOT/e3/new/batches $CE_ROOT/e3/retry/batches
cp $CE_ROOT/data/e1/pages.jsonl $CE_ROOT/data/e1/applicability.jsonl $CE_ROOT/data/e3/retry/
```

### 1. Editing: two jobs, Gemma-4-31B-it (E1's editor; MODEL left at its default)

```sh
cd $CE_ROOT/code/e1
# New queries: arms 2, 4, 5, 6, 7, 8, 10 and their placebos, up to 3 attempts each (four-page queries: 2, 4, 8, 10).
. ./local.env && DATA=$CE_ROOT/data/e3/new SETS="--set e3 --set e3-four" \
  EXTRA="--arms 2,4,5,6,7,8,10 --no-all --max-attempts 3" sbatch --gres=gpu:h200:1 edit.sbatch
# E1's failed pairs: attempt 3 from E1's last failure; writes only the edits made now.
. ./local.env && DATA=$CE_ROOT/data/e3/retry SETS="--set main" \
  EXTRA="--arms 2,4,5,6,7,8,10 --max-attempts 3 --retry-from $CE_ROOT/data/e1/versions.jsonl" sbatch --gres=gpu:h200:1 edit.sbatch
```

They run `editor.py --backend vllm --model google/gemma-4-31B-it` with E1's prompts, spans, validators and settings (temperature 0, thinking off) and write `$CE_ROOT/data/e3/new/versions.jsonl` and `$CE_ROOT/data/e3/retry/versions.jsonl`; E1's `versions.jsonl` is only read. The job log's summary line has `per_arm` (with `attempts_3`) and, for the retry job, `retried`: per arm, the arms and placebos retried, the new placebos, the pairs that passed in E1 and the pairs not retried, with why. Summarize the validity with `python3 -I validity_report.py $CE_ROOT/data/e3/new/versions.jsonl` (and `.../retry/versions.jsonl`).

`--retry-from` gives a pair its next attempt as follows. An LLM arm whose E1 edit ended invalid gets attempt 3, whose prompt is the regenerate prompt E1's loop would have built after attempt 2 (E1's first prompt plus the validator's messages from E1's `excluded_reason`); if it passes, its placebo is built from the start with up to three attempts. An arm valid in E1 whose placebo ended invalid: only the placebo gets attempt 3, with the "What to fix" hints rebuilt from E1's last placebo text. Arm 4 (deterministic) is built and validated again. Not retried: pairs that passed in E1, arm 7 where the editor answered NONE (not applicable, as in E1), and a placebo whose E1 text does not fit the spans rebuilt from E1's arm version (one pair with the current data, so it is never retried as a different task).

### 2. Prompts, E1's answers where identical, and the generation jobs

```sh
cd $CE_ROOT/code/e1
# Prompts for E1's two judges, counted with their tokenizers (loads tokenizers only; use an interactive job
# if your site limits login-node memory). The retry folder holds only the new versions.
. ./local.env && HF_HOME=$HF_HOME HF_HUB_OFFLINE=1 $CE_PYTHON -I build_prompts.py --data $CE_ROOT/data/e3/new --sets e3,e3-four
. ./local.env && HF_HOME=$HF_HOME HF_HUB_OFFLINE=1 $CE_PYTHON -I build_prompts.py --data $CE_ROOT/data/e3/retry --sets main --without-original
for f in new retry; do
  . ./local.env && $CE_PYTHON -I $CE_ROOT/code/e3/reuse_e3.py --data $CE_ROOT/data/e3/$f \
    --e1-prompts $CE_ROOT/data/e1/prompts.jsonl --e1-answers $CE_ROOT/e1/answers --answers-out $CE_ROOT/e3/$f/answers
  cp $CE_ROOT/data/e3/$f/batches/*.prompts.jsonl $CE_ROOT/e3/$f/batches/
done

# One job per batch file: e3.<judge>.tier1-3 and e3-four.<judge>.tier1-3 (RUN=e3/new), main.<judge>.tier1-3 (RUN=e3/retry).
for f in new retry; do
  for b in $CE_ROOT/e3/$f/batches/*.prompts.jsonl; do
    BATCH=$(basename "$b" .prompts.jsonl)
    case "$BATCH" in
      *.gemma-4-12b.*) . ./local.env && RUN=e3/$f JUDGE=gemma-4-12b BATCH=$BATCH sbatch --gres=gpu:a100:1 generate.sbatch ;;
      *.qwen3.8-27b.*) . ./local.env && RUN=e3/$f JUDGE=qwen3.8-27b BATCH=$BATCH sbatch --gres=gpu:h200:1 generate.sbatch ;;
    esac
  done
done
```

Answers land in `$CE_ROOT/e3/<new|retry>/answers/<BATCH>.jsonl`. `reuse.json` says, per judge, how many answers came from E1 and why the rest did not. Expect none to be reused: the new queries have no E1 prompts, and every retried version was invalid in E1, so E1 built no prompt for it. The pairs E3 leaves as E1 made them are not rebuilt at all: `analyze_e3.py` reads E1's cells for them (as E2a does for the original and arm 9).

### 3. Back on your machine: score, analyze, report

```sh
# Copy versions.jsonl, prompts.jsonl, prompt_build.json and reuse.json from $CE_ROOT/data/e3/new to experiments/e3/data/,
# and $CE_ROOT/e3/new/answers/*.jsonl to experiments/e3/data/answers/; the same from .../retry to experiments/e3/data/retry/.
python3 -I experiments/e1/score.py --data experiments/e3/data --out experiments/e3/out/new --sets e3,e3-four
python3 -I experiments/e1/score.py --data experiments/e3/data/retry --out experiments/e3/out/retry --sets main
python3 -I experiments/e3/analyze_e3.py
python3 -I experiments/e3/report_e3.py
```

`analyze_e3.py` reads E1's `data/` and `out/` (`cells.jsonl`; `scores.jsonl`, `score_summary.json` and `analysis.json` when present) and writes `experiments/e3/out/analysis_e3.json`; a part whose cells are not there yet is reported as not run. `report_e3.py` writes `experiments/e3/out/RESULTS_E3.md`.

## Projected job sizes

From the local counts and E1's timing (editor about 1.2 s per version; judges 2.39 s per prompt for Gemma-4-12B on an A100 and 1.09 s per prompt for Qwen3.8-27B on an H200; model load not included). The upper bound counts every applicable edit and placebo as valid; E1's validity rates give the expected size.

| Job | Versions (upper bound) | Prompts per judge | Gemma-4-12B (A100) | Qwen3.8-27B (H200) |
| --- | --- | --- | --- | --- |
| `e3`, tier 1 (originals, 5, 6, 7) | 384 | 3,072 | 2.0 h | 0.9 h |
| `e3`, tier 2 (2, 8) | 194 | 1,552 | 1.0 h | 0.5 h |
| `e3`, tier 3 (4, 10) | 55 | 440 | 0.3 h | 0.1 h |
| `e3-four`, tier 1 (originals) | 108 | 864 | 0.6 h | 0.3 h |
| `e3-four`, tier 2 (2, 8) | 260 | 2,080 | 1.4 h | 0.6 h |
| `e3-four`, tier 3 (4, 10) | 49 | 392 | 0.3 h | 0.1 h |
| Retry, all tiers (1: 125, 2: 79, 3: 30 versions) | 234 | 1,872 | 1.2 h | 0.6 h |
| **All** | **1,284** | **10,272** | **6.8 h** | **3.1 h** |

- Editing: the new-query job writes at most 1,050 versions (180 originals, 858 LLM edits and placebos, 12 tables edits), about 0.35 hours at 1.2 s per version, or about 1 hour if every LLM edit needs all three attempts. The retry job makes 133 LLM attempts (97 arms, 36 placebos) plus at most 97 new placebos with up to three attempts each: under 0.3 hours.
- About 11 GPU-hours in all at the upper bound, within the plan's 10 to 20. No generation job exceeds 6 hours, so none is split.
- Expected pairs from the new queries at E1's validity rates (before the extra attempt): arm 2 about 46, 5 about 4, 6 about 26, 7 about 22, 8 about 54, 10 about 18. With E1's pairs that puts the pooled n near 63 (2), 52 (6), 47 (7) and 74 (8), and under 30 for statistics (about 8) and explicit comparisons (about 26) unless the extra attempt raises their validity. Tables depends on amendment 1; it applies to 12 new targets and 4 of E1's.

`build_prompts.py --tokens utf8` (UTF-8 bytes, the smoke-only upper bound) refuses most real queries at 31,000, so prompt counts for the real run come from `--tokens hf` on the cluster (E1 refused no query).

## Local proof with the fake editor

Each edit command above, with `--backend fake`, on two queries (the new-query run on `geo-test-494` from `e3` and `geo-test-43` from `e3-four`; the retry run on E1's `geo-test-25` and `geo-test-348`), from folders holding those queries' rows of `pages.jsonl` and `applicability.jsonl`:

```sh
python3 -I experiments/e1/editor.py --backend fake --pages $D/pages.jsonl --applicability $D/applicability.jsonl \
  --out $D/versions.jsonl --log $D/editor_log.jsonl --set e3 --set e3-four --arms 2,4,5,6,7,8,10 --no-all --max-attempts 3
python3 -I experiments/e1/editor.py --backend fake --pages $D/pages.jsonl --applicability $D/applicability.jsonl \
  --out $D/versions.jsonl --log $D/editor_log.jsonl --set main --arms 2,4,5,6,7,8,10 --max-attempts 3 \
  --retry-from experiments/e1/data/versions.jsonl
```

The fake editor returns each span unchanged (so validation fails and every regenerate runs), adds "?" to headings for arm 2 and answers NONE for arm 7. The new-query run made 26 model calls: arm 2 passed at once on `geo-test-494` and failed after three attempts on `geo-test-43`; arms 5, 6, 8 and 10 and the P2 of `geo-test-494` failed after three attempts; arm 4 failed its one deterministic check ("after the edit the tables check is not applicable", the case amendment 1 is about); arm 7 answered NONE. The retry run made 6 calls, each attempt 3: P2 for both queries, P8, arms 5, 6 and 7, with E1's failures and, for `geo-test-25`'s P2, the rebuilt "What to fix" hints in the prompt; arm 4 was validated again.

## Choices the plan leaves open

- **Four-page queries** have exactly four usable pages; the draw is `draw.assign_roles`, which gives no donor to a four-page query. Their arms 5 to 7 would need a donor, so they are not run, nor any arm outside 2, 4, 8 and 10 (written as not applicable, with the reason). For `e3`, every arm outside the seven and ALL are not applicable too, so no later step builds them.
- **Attempts** are counted per edit, as E1 counts them: a placebo has its own three. Arm 4 is deterministic, so it has one check, as in E1.
- **Resuming from E1** uses E1's `versions.jsonl` only: the attempt count, the last failure (`excluded_reason`) and the last text. The last failure's messages are split on " | ", as E1 joined them. Placebo hints come from the last placebo text, split into span replacements (`editor.recover_edits`; where a piece of fixed text occurs twice, the occurrence a character diff of the two texts points to). A placebo's spans come from E1's valid arm version the same way; they fit E1's placebo text for 136 of E1's 137 placebos (valid or not), and the one that does not fit is skipped.
- **A retried version replaces E1's row** for the same version id in the pooled analysis, so each pair is E1's or E3's. A query refused for prompt length in the retry folder loses only its retried versions; E1's cells for it stand.
- **The breakdowns** are E3's new queries, E1's queries with the extra attempt, and E1's queries as E1 ran them. The last reproduces E1's own n and d for all seven arms (checked on E1's cells).
- **The family** is one Holm family over the arms that reach 30 analyzable queries, at alpha 0.05; each arm's smallest detectable d uses alpha / m.
- ALL and P_ALL are not part of E3.
