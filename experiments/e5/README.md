# E5 pipeline: the reader's-words edit with only a keyword

This folder runs E5 as planned in [`../PLAN_E5.md`](../PLAN_E5.md) (r2): does arm 9's gain hold on E3's 180 new GEO-bench queries, and does the edit still help when it carries only a keyword's two words (9K) or the question the tool's local-model path writes from that keyword (9L)? It reuses E1's pipeline in [`../e1`](../e1) (pages, editor, prompts, validators, judges, seeds, citation score) and E3's new queries ([`../e3`](../e3)); E1's, E2's and E3's behaviour is unchanged.

Nothing under `data/` or `out/` is committed (both are gitignored): they hold page text, prompts and answers. `PRERUN.md` holds only numbers.

## Files

| File | What it does |
| --- | --- |
| `questions_cli.ts` | The questions bridge: the tool's `keywordQuestion`, `pageQuestions` and the current engine's question-coverage (the tool's own view, `tool_gate`), JSONL on stdin. Bundled once to `out/bundle/questions_cli.js` from the commit in `bundles.json`. |
| `bundles.json` | The two pinned bundles: E1's engine (`../e1/out/bundle/engine_cli.js`, sha256 `1b8e30db...4c47`, never rebuilt) and the questions bridge (sha256, commit, build command). Every E5 script checks the hash of the bundle it runs and stops otherwise. |
| `e5_common.py` | Paths, the pins, the bridge call, E5's sets and strata, and the edit-text rules (k from the page pool, surface words, the 9A text, the titled page for q_G, the first-H2 rule, the sha256 query order). |
| `edit_texts.py` | `data/edit_texts.jsonl` (one row per query: k, q', template, the 9A text, q_G, q_L pending) and `edit_texts.json` (counts, sha256); also `data/pages.jsonl`, E5's page set (E1's main and replication rows, E3's e3 and e3-four rows). |
| `applicability.py` | `data/applicability.jsonl` (E1's rows for E1's queries; arms 9 and 12 by E1's rules on the new queries; 9K, 9A, 9G, 9L and 12K rows), `edit_applicability.jsonl` (the edit job's table: 12 on the new queries, 12K on the main set), `edit_questions.jsonl` (q' per main query) and `engine_original.jsonl` (the pinned engine on every target; E1's rows are reproduced byte for byte). |
| `make_versions.py` | `build`: the deterministic versions (original, 9, 9P, 9K, 9A, 9G), checked against E1's, E2's and E3's rows, and E1's own 12 and P12 on its main queries, copied (re-answered in tier 3, PLAN_E5 amendment 2). `ql`: merges the edit job's q_L and builds 9L. `merge-edits`: adds the edit job's 12, P12, 12K and P12K rows and keeps E1's 12 and P12. |
| `build_prompts_e5.py` | E5's prompts and batch files (E1's prompt; keys `e5|<judge>|<version_id>|<seed>`; batches per E5 set, judge and tier in sha256(query id) order). |
| `env_check.py`, `e1_env_reference.json` | Logs vLLM, torch, transformers, the models' cache revisions, the sampling settings and the GPU, and prints every mismatch with E1's records. |
| `fake_editor.py`, `smoke_e5.py` | The local smoke run of the edit job on two real queries, no model call. |
| `prerun_counts.py` | `PRERUN.md` and `data/prerun_counts.json`. |
| `check_e1_tasklist.py` | Proves E1's editor sends the same prompts and writes the same rows as before E5's change (sha256 recorded before the change). |
| `tool_twin_fixtures.ts`, `tests/tool_twin_fixtures.json` | The TypeScript side of the q_L twin test (the tool's prompt, parse and default temperature). |
| `analyze_e5.py`, `report_e5.py`, `simulate_null_e5.py` | The analysis, report and null simulation (see `README-analysis.md`). |
| `tests/` | `python3 -I -m unittest discover -s experiments/e5/tests` (E1's, E2's and E3's suites stay green: `-s experiments/e1/tests`, and so on). |

The E1 code E5 uses, beyond E1's own steps: `e1_common`'s E5 labels and tiers (`E5_ARMS`; 9K, 9L, 9A and 9G are their own parent arms, P12K's is 12K; E1's and E2's lookups are unchanged), `editor.py --arms 12K --edit-questions FILE` (E1's arm 12 prompt, spans, missing terms and validator with q'; its placebo P12K is E1's P12 with q), `editor.py --q-l-from FILE --q-l-out FILE` (q_L first, in the same process), and the E5 guards in `edit.sbatch` and `generate.sbatch`.

## Local steps (done for the freeze; rerun only to check)

From the repository root, with E1's and E3's `data/` in place and E1's engine bundle (sha256 above) in `experiments/e1/out/bundle/`. Never run `experiments/e1/smoke.sh` or E1's README step 0 for E5: both rebuild E1's bundle.

```sh
# The questions bridge (only when out/bundle/questions_cli.js is missing): from the commit in bundles.json,
# with a clean packages/ tree, then check its sha256 against bundles.json.
pnpm exec tsup experiments/e5/questions_cli.ts --format esm --target node22 -d experiments/e5/out/bundle
shasum -a 256 experiments/e5/out/bundle/questions_cli.js

python3 -I experiments/e5/edit_texts.py            # data/pages.jsonl, edit_texts.jsonl, edit_texts.json
python3 -I experiments/e5/applicability.py         # applicability tables, edit_questions.jsonl, engine_original.jsonl
python3 -I experiments/e5/make_versions.py build   # deterministic versions and E1's own 12 and P12 (about 4 minutes)
python3 -I experiments/e5/build_prompts_e5.py --tokens none   # prompts and batches without token counts
python3 -I experiments/e5/prerun_counts.py         # PRERUN.md
python3 -I experiments/e5/smoke_e5.py              # the edit job's paths with fake editors (data/smoke/)
python3 -I experiments/e5/check_e1_tasklist.py     # E1's editor unchanged (about 90 s)
python3 -I -m unittest discover -s experiments/e5/tests
```

What they print with the current data (details in `PRERUN.md`): 320 queries (e1 80, e3 72, e3-four 108, replication 60); q' keeps the keyword for 232 of 260 main queries (26 "What is/are", 2 "How to") and 56 of 60 replication; arm 9 applies on 117 new queries (valid 115), 9K is valid on 168 main and 53 replication queries, 9G on 147 and 41; 12K applies on 132 main queries; the rebuilt originals (320) and arm 9 versions (108) equal E1's and E3's rows, 9P equals E2's 106, and E1's own 12 and P12 (63 and 50 rows, 50 and 33 valid) are copied unchanged, so their 1,328 E5 prompts equal E1's byte for byte. About 32,900 answers in all (15,744 in tier 1; 1,328 of them E1's 12 and P12 in tier 3), about 10.6 GPU-hours at E1's 3,100 answers per GPU-hour, or 11.5 to 13.8 GPU-hours summed over the jobs at the measured per-job rates (`PRERUN.md`, "Projected job hours").

## On Explorer, in order

The jobs, `local.env` and layout are E1's (`../e1/README.md`, "On Explorer"). `$CE_ROOT` is the project folder on the cluster and every `sbatch` line runs from `$CE_ROOT/code/e1` after `. ./local.env`; check each first with `CE_DRY_RUN=1` and `bash` in place of `sbatch`. Times below are PST; the cluster's clock is US Eastern (PST + 3 h).

**Deadline.** The models are read from `HF_HOME`, which is on the cluster's scratch space, and scratch is purged on 2026-11-06; the login rules change on 2026-11-06 at 09:00 US Eastern (06:00 PST). Every answer must be copied back to this machine by **2026-11-06 05:00 PST** (08:00 on the cluster's clock). If the queue projects past that, cut in the plan's order (tier 3; Qwen for tier 2; tier 2 on the replication set; within tier 2, the `tier2-12K` files, 12K and P12K, before `tier2-9L`: PLAN_E5 amendment 1), never seeds, tier 1 or the primary judge, and log each cut with `date` in the E5 log. Each cut depends only on completion status and the queue projection, never on outcomes.

### 0. Code, data and checks

```sh
# From this machine ($EXPLORER is your ssh host alias for the cluster). Set CE_ROOT here to the CLUSTER's project
# folder (the value in the cluster's local.env), since every remote path below is expanded on this machine.
export CE_ROOT=/projects/<your-project>/citation-equity
# The folders first: rsync creates only the last folder of a destination path.
ssh $EXPLORER "mkdir -p $CE_ROOT/code/e1 $CE_ROOT/code/e2 $CE_ROOT/code/e3 $CE_ROOT/code/e5/out/bundle $CE_ROOT/data/e5"
# Code: E1's Python and sbatch files (the prompts/, E1's engine bundle and local.env on the cluster stay as they
# are), E2's make_versions.py, E3's admit.py, and E5's code with its bundle.
rsync -a experiments/e1/*.py experiments/e1/*.sbatch $EXPLORER:$CE_ROOT/code/e1/
rsync -a experiments/e2/make_versions.py $EXPLORER:$CE_ROOT/code/e2/
rsync -a experiments/e3/admit.py $EXPLORER:$CE_ROOT/code/e3/
rsync -a experiments/e5/*.py experiments/e5/bundles.json experiments/e5/e1_env_reference.json $EXPLORER:$CE_ROOT/code/e5/
rsync -a experiments/e5/out/bundle/questions_cli.js $EXPLORER:$CE_ROOT/code/e5/out/bundle/
# Data: E5's inputs and its deterministic versions (page text: the cluster folder is yours only).
rsync -a experiments/e5/data/{pages,edit_texts,applicability,edit_applicability,edit_questions,engine_original,versions}.jsonl \
  experiments/e5/data/edit_texts.json experiments/e5/data/make_versions.json $EXPLORER:$CE_ROOT/data/e5/
```

On the cluster:

```sh
mkdir -p $CE_ROOT/e5/batches $CE_ROOT/e5/answers
cd $CE_ROOT/code/e1
# Both bundles must have the frozen hashes (E1's engine: 1b8e30dbea4e01134302d302fe457e03e2e16baff658c891a9fb3e89fa5a4c47;
# the questions bridge: bundles.json).
sha256sum out/bundle/engine_cli.js ../e5/out/bundle/questions_cli.js
# The cache holds all three models (scratch, purged 2026-11-06): each prints a revision.
. ./local.env && for m in google--gemma-4-31B-it google--gemma-4-12B-it Qwen--Qwen3.8-27B; do cat $HF_HOME/hub/models--$m/refs/main; echo; done
# Dry runs: the settings each job will use.
. ./local.env && CE_DRY_RUN=1 DATA=$CE_ROOT/data/e5 SETS="--set main --set e3 --set e3-four" \
  EXTRA="--arms 12,12K --no-all --edit-questions $CE_ROOT/data/e5/edit_questions.jsonl --q-l-from $CE_ROOT/data/e5/edit_texts.jsonl --q-l-out $CE_ROOT/data/e5/q_L.jsonl" bash edit.sbatch
. ./local.env && CE_DRY_RUN=1 RUN=e5 JUDGE=gemma-4-12b BATCH=e5-main.gemma-4-12b.tier1 bash generate.sbatch
# The environment against E1's records, on a GPU node (keep the JSON with the E5 logs; any MISMATCH line is logged
# and reported, and the run uses E1's GPU types: Gemma-4-12B on an A100, Qwen3.8-27B and Gemma-4-31B on an H200).
. ./local.env && srun ${SBATCH_ACCOUNT:+--account=$SBATCH_ACCOUNT} --partition=gpu --gres=gpu:a100:1 --time=00:15:00 --mem=16G \
  env HF_HOME=$HF_HOME $CE_PYTHON -I $CE_ROOT/code/e5/env_check.py --model google/gemma-4-12B-it --json $CE_ROOT/e5/env_check.json
```

### 1. Prompts with the judges' token counts, then the edit job and tier 1 and tier 3 in parallel

```sh
cd $CE_ROOT/code/e1
# Prompts for both judges, counted with their tokenizers, in an interactive CPU job (the builder holds about 1 GB of
# prompts in memory; never on the login node). Add --shards 2 to split each batch at query boundaries when GPUs are
# free. Leave the job with exit.
. ./local.env && srun ${SBATCH_ACCOUNT:+--account=$SBATCH_ACCOUNT} --partition=short --cpus-per-task=4 --mem=16G --time=01:00:00 --pty bash
cd $CE_ROOT/code/e1 && . ./local.env
HF_HOME=$HF_HOME HF_HUB_OFFLINE=1 $CE_PYTHON -I $CE_ROOT/code/e5/build_prompts_e5.py --data $CE_ROOT/data/e5
exit
cp -n $CE_ROOT/data/e5/batches/*.prompts.jsonl $CE_ROOT/e5/batches/
. ./local.env && $CE_PYTHON -I $CE_ROOT/code/e5/env_check.py --batches $CE_ROOT/e5/batches | grep -E 'MISMATCH|env_check:'

# The edit job (Gemma-4-31B-it, E1's editor settings): q_L for all 320 keywords, then 12K and P12K (main set) and
# 12 and P12 on the new queries. Writes $CE_ROOT/data/e5/q_L.jsonl, edit_versions.jsonl and edit_log.jsonl only.
. ./local.env && DATA=$CE_ROOT/data/e5 SETS="--set main --set e3 --set e3-four" \
  EXTRA="--arms 12,12K --no-all --edit-questions $CE_ROOT/data/e5/edit_questions.jsonl --q-l-from $CE_ROOT/data/e5/edit_texts.jsonl --q-l-out $CE_ROOT/data/e5/q_L.jsonl" \
  sbatch --gres=gpu:h200:1 edit.sbatch

# Judges, at once: tier 1 (Gemma first), then tier 3 (9A, 9G, and E1's own 12 and P12 on its main queries).
# Gemma-4-12B on an A100, Qwen3.8-27B on an H200 (E1's).
for b in e5-main.gemma-4-12b.tier1 e5-replication.gemma-4-12b.tier1 e5-main.qwen3.8-27b.tier1 e5-replication.qwen3.8-27b.tier1 \
         e5-main.gemma-4-12b.tier3 e5-replication.gemma-4-12b.tier3 e5-main.qwen3.8-27b.tier3 e5-replication.qwen3.8-27b.tier3; do
  case "$b" in
    *.gemma-4-12b.*) . ./local.env && RUN=e5 JUDGE=gemma-4-12b BATCH=$b sbatch --gres=gpu:a100:1 generate.sbatch ;;
    *.qwen3.8-27b.*) . ./local.env && RUN=e5 JUDGE=qwen3.8-27b BATCH=$b sbatch --gres=gpu:h200:1 generate.sbatch ;;
  esac
done
```

With `--shards N`, submit every `<batch>-p<i>of<N>` file the same way (the loop's names gain the suffix). Projected wall-clock per job at the judges' measured E1 and E3 rates, model load included (`PRERUN.md`, "Projected job hours"; use these for the queue projection): Gemma tier 1 main 2.0 h on an A100 80 GB, 2.9 h on an A100 40 GB (`gpu:a100` can land on either), replication 0.6 to 0.9 h; Qwen tier 1 main 1.7 h, replication 0.6 h; tier 3 main 1.0 to 1.5 h; every tier 2 and tier 3-12 job under 0.8 h; the edit job about 1 GPU-hour.

### 2. After the edit job: 9L, the edited versions, and tier 2 and tier 3-12

```sh
cd $CE_ROOT/code/e1
# An interactive CPU job (never the login node): the three steps run E1's engine and the questions bridge with
# Node 22 or newer, and the prompt builder holds about 1 GB of prompts in memory.
. ./local.env && srun ${SBATCH_ACCOUNT:+--account=$SBATCH_ACCOUNT} --partition=short --cpus-per-task=4 --mem=16G --time=01:00:00 --pty bash
# Inside the job: the modules edit.sbatch loads (CE_MODULES), then Node: $CE_NODE if local.env sets it, else node on
# the PATH. It must print v22 or newer; otherwise set CE_NODE in local.env or add a Node 22 module to CE_MODULES.
cd $CE_ROOT/code/e1 && . ./local.env && source /etc/profile && module purge
for m in ${CE_MODULES-miniconda3/24.11.1}; do module load "$m"; done
NODE=${CE_NODE:-node} && "$NODE" --version
export E1_ENGINE="$NODE $CE_ROOT/code/e1/out/bundle/engine_cli.js" \
  E5_QUESTIONS="$NODE $CE_ROOT/code/e5/out/bundle/questions_cli.js"
# Each step checks both bundles' sha256 before it rewrites any file.
$CE_PYTHON -I $CE_ROOT/code/e5/make_versions.py --data $CE_ROOT/data/e5 ql --q-l $CE_ROOT/data/e5/q_L.jsonl
$CE_PYTHON -I $CE_ROOT/code/e5/make_versions.py --data $CE_ROOT/data/e5 merge-edits --edits $CE_ROOT/data/e5/edit_versions.jsonl
# Prompts again: tier 1 and tier 3 files must come out identical (the builder stops otherwise); new files for tier 2 and 3-12.
HF_HOME=$HF_HOME HF_HUB_OFFLINE=1 $CE_PYTHON -I $CE_ROOT/code/e5/build_prompts_e5.py --data $CE_ROOT/data/e5
exit
cp -n $CE_ROOT/data/e5/batches/*.prompts.jsonl $CE_ROOT/e5/batches/
# Tier 2: 9L first, then 12K and P12K (PLAN_E5 amendment 1: 12K and P12K are cut before 9L), Gemma before Qwen;
# then tier 3-12 (main only).
for b in e5-main.gemma-4-12b.tier2-9L e5-replication.gemma-4-12b.tier2-9L e5-main.gemma-4-12b.tier2-12K \
         e5-main.qwen3.8-27b.tier2-9L e5-replication.qwen3.8-27b.tier2-9L e5-main.qwen3.8-27b.tier2-12K \
         e5-main.gemma-4-12b.tier3-12 e5-main.qwen3.8-27b.tier3-12; do
  case "$b" in
    *.gemma-4-12b.*) . ./local.env && RUN=e5 JUDGE=gemma-4-12b BATCH=$b sbatch --gres=gpu:a100:1 generate.sbatch ;;
    *.qwen3.8-27b.*) . ./local.env && RUN=e5 JUDGE=qwen3.8-27b BATCH=$b sbatch --gres=gpu:h200:1 generate.sbatch ;;
  esac
done
```

The job log's summary line has `q_L` (rows and how many got a question) and `per_arm` (valid counts); `make_versions.py` writes `make_versions_ql.json` and `make_versions_edits.json` with the counts and reasons.

### 3. Copy back by 2026-11-06 05:00 PST, then score and analyze here

```sh
rsync -a $EXPLORER:$CE_ROOT/e5/answers/ experiments/e5/data/answers/
rsync -a $EXPLORER:$CE_ROOT/data/e5/{versions,edit_texts,applicability,prompts,q_L,edit_versions,edit_log}.jsonl \
  $EXPLORER:$CE_ROOT/data/e5/{prompt_build,make_versions_ql,make_versions_edits}.json experiments/e5/data/
rsync -a $EXPLORER:$CE_ROOT/e5/env_check.json experiments/e5/data/
python3 -I experiments/e1/score.py --data experiments/e5/data --out experiments/e5/out --sets main,e3,e3-four,replication
python3 -I experiments/e5/analyze_e5.py
python3 -I experiments/e5/report_e5.py
```

Copy what has finished at each check, not only at the end: a job that has not finished by the deadline is cut and logged, and the analysis runs once on the snapshot whose file hashes it logs.

## Local proof with the fake editors (smoke_e5.py)

On `geo-test-15` (an E1 query) and `geo-test-413` (an E3 five-page query), 12K applicable on both and arm 12 on the second, with each query's rows of E5's files in `data/smoke/`:

- **The edit job's command** (edit.sbatch's E5 command line with `--backend fake`, E1's fake editor, which answers every span unchanged): q_L gets a question for both keywords; 12K (both) and 12 fail validation after the regenerate, as the unchanged spans miss check 2; the same command aimed at E1's `versions.jsonl` is refused.
- **A cooperative fake editor** (`fake_editor.py`, in process, main()'s order): q_L sent at the tool's temperature 0.5 with seed 1; the prompts carry q' for 12K and the true query for P12K, 12 and P12; 12K valid on both, 12 and P12 valid on the new query, P12K valid on one (on the other the fake's paraphrase leaves the span unchanged, which the validator rejects).
- **The steps after the edit job**, in the cluster's order: `build_prompts_e5.py` on the local build, `make_versions.py ql` and `merge-edits`, `build_prompts_e5.py` again (tier 1 and tier 3 files unchanged, so it does not stop) and E1's `score.py` on fake answers give complete cells for all eleven labels (original, 9, 9P, 9K, 9L, 9A, 9G, 12, P12, 12K, P12K), E1's own 12 and P12 on `geo-test-15` included.

## Choices the plan leaves open

- **Sets in the files.** `edit_texts.jsonl` has E5's set (`main`, `replication`) and the stratum (`e1`, `e3`, `e3-four`, `replication`). Versions, prompts and cells keep the page's own set (`main` for E1's queries, `e3`, `e3-four`, `replication`), so E1's `score.py` runs unchanged with `--sets main,e3,e3-four,replication` and E5's cells join E1's and E3's cells on (set, query, version, judge) for the drift check.
- **Keys.** E5's prompt keys start with `e5|`, so an E5 answer can never be mistaken for an E1, E2 or E3 answer; version ids are E1's (`<query_id>:<arm>`).
- **Page pool for k.** Distinct normalized texts by sha256 (main 1,122 of 1,192 rows; replication 299 of 300), text only. The plan's pre-run template count (231 kept) used every row; the sha256 rule changes k for the 8 queries the feasibility critique named and gives 232 kept, 26 "What is/are", 2 "How to".
- **First H2.** The first heading of depth 2 in E1's engine artifacts, compared after trimming and lowercasing.
- **9P** is built wherever arm 9 is applicable (not only where arm 9 is valid, as in E2), with E2's builder and validity; on the replication set it is E2's version (identical where E2 has it).
- **Invalid versions** record 0 added words, as E1's editor writes them.
- **edit_text** is the text an edit was built from: q for 9 and 12, q' for 9K and 12K, q_L, the 9A text, q_G; null for the original and the placebos (9P, P12, P12K), whose `tool_gate` is null too.
- **tool_gate** runs the tool's question-coverage (current engine, through the bridge) on the original text alone, as E1's applicability does, with the edit text as the question; `tool_covers_edit_text` and `tool_covers_q` run it on the edited text.
- **12 and P12** are rebuilt on the new queries only. On E1's main queries E1's own 12 and P12 versions are copied unchanged into `versions.jsonl` (all 113 rows, valid or not, E1's fields verbatim) and their 83 valid versions are re-answered in the `tier3` files (PLAN_E5 amendment 2, "One run for arm 12 too"), so pooled 12 vs P12 and 12K vs 12 compare answers from E5's run; `edit_applicability.jsonl` marks them not applicable so the edit job never rebuilds them, and `merge-edits` keeps them and refuses an edit job that did. They sit in `tier3` (built locally, run in parallel with tier 1) rather than `tier3-12`, which holds only the edit job's versions; if tier 3 is cut, both reported items fall back to E1's answers and are flagged cross-run.
- **Edit texts that are q.** Where q_G or the 9A text equals q (ignoring case, spaces and a final question mark), that 9G or 9A version makes arm 9's edit, up to the heading's case. `versions.jsonl` marks every row with `edit_text_is_q`; `PRERUN.md` lists the queries: 9G on `geo-test-330`, `geo-test-428` (case only) and `geo-test-618` (the same text as arm 9) are valid, the 9A cases and 9G on `geo-test-226` are not applicable. The report should flag them.
- **Node.** `E1_ENGINE` or `E5_QUESTIONS` given as the `.js` bundle alone (an unset `$CE_NODE`) runs it with `$CE_NODE` or `node`, never as a program; the step 2 job loads `CE_MODULES` first, as `edit.sbatch` does.
- **Data folders.** Every E5 script that writes refuses E1's, E2's and E3's folders: the code-relative ones (`experiments/e1/data` here, `code/e1/data` on the cluster) and the cluster's `$CE_ROOT/data/e1`, `data/e2`, `data/e3` and their subfolders.
- **q_L's answer length.** The tool's adapter sets no token limit; the edit job uses the editor's 4,096 new tokens, far above one question line.
- **Tier 2 in two files** (`tier2-9L`, submitted first, and `tier2-12K`, cut first: PLAN_E5 amendment 1), so the cut inside tier 2 never touches the other file; tier 3's 12 and P12 on the new queries have their own file (`tier3-12`) because they come from the edit job.
