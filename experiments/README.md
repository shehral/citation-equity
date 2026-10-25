# Experiments

Research runs of the citation test bench on larger open models, on Northeastern's Explorer cluster. The bench itself runs locally (Node 24), and the cluster only generates answers. Prompts go out as a file and answers come back as a file, keyed by the bench's `recordingKey`, so cluster runs use exactly the bench's prompts, retrieval, seeds and metrics.

These are bench runs: a content check on a model over a fixed page set. They do not predict live AI engines.

How the bench works and what it found on the sample drafts: [samples/README.md](../samples/README.md). Every `ce bench` option, including `--export-prompts` and `--answers`: [docs/cli.md](../docs/cli.md). The E1 study has its own folder, [e1/](e1/README.md), with its pre-registration in [PREREG_E1.md](PREREG_E1.md); the sensitivity test's results are in [RESULTS_sensitivity.md](RESULTS_sensitivity.md).

## Data

Every result of these experiments is on Hugging Face: [Shehral/citation-equity-experiments](https://huggingface.co/datasets/Shehral/citation-equity-experiments) (scores, per-query cells, metadata, plans; no page text) and the gated [Shehral/citation-equity-experiments-pages](https://huggingface.co/datasets/Shehral/citation-equity-experiments-pages) (the fetched pages, edited versions, prompts and answers, for non-commercial research).

## Files

| File                                                     | What it is                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `PREREG_sensitivity.md`                                  | Pre-registration of the bench sensitivity test, written before any run. Read it before E2.   |
| `explorer/sensitivity.py`, `explorer/sensitivity.sbatch` | The sensitivity test itself (its own prompts, re-implemented in Python).                     |
| `explorer/smoke_vllm.py`, `explorer/smoke.sbatch`        | The first vLLM smoke test on Explorer.                                                       |
| `explorer/batch_generate.py`, `explorer/batch.sbatch`    | The batch bridge below: answers a prompts file from `ce bench --export-prompts`.             |
| `explorer/test_batch_generate.py`                        | Tests for the bridge's prompt handling and output shape, without vLLM.                       |
| `explorer/local.env.example`                             | The cluster settings the sbatch files read: copy it to `local.env` (gitignored) and fill in. |
| `results/`                                               | Summaries copied back from the cluster.                                                      |

## The loop: export, copy, sbatch, copy back, replay

The commands below run from the repository root. `explorer` is an ssh host alias for `login.explorer.northeastern.edu`, and `$CE_ROOT` stands for your project folder on the cluster (for example `/projects/<your-project>/citation-equity`). The sbatch files hold no account or path of their own: they read them from the environment or from a `local.env` file next to them on the cluster.
0. **Once: write `local.env`.** Copy `experiments/explorer/local.env.example` to `local.env` and fill in your Slurm allocation (`SBATCH_ACCOUNT`), `CE_ROOT`, the Python of an env with vLLM (`CE_PYTHON`) and the Hugging Face cache that holds the models (`HF_HOME`). It is gitignored, so it stays on your machine and the cluster.
1. **Export the prompts.** `--model` must be the cluster model's Hugging Face id, because the model id is part of every answer's key. Every other setting (`--runs`, `--k`, `--seed`, `--temperature`, `--num-ctx`) works as for a normal bench run. Nothing contacts a model.

   ```sh
   mkdir -p .cache/batches
   pnpm --filter @citation-equity/bench ce bench \
     --draft "$PWD/samples/espresso-bitterness/before.md" --after "$PWD/samples/espresso-bitterness/after.md" \
     --pack "$PWD/samples/espresso-bitterness/pack.json" --model google/gemma-4-12B-it \
     --export-prompts "$PWD/.cache/batches/espresso-gemma12b.prompts.jsonl"
   ```

   This writes questions x runs x drafts lines (4 x 8 x 2 = 64 here). Each line is one `PromptLine`: `key`, `model`, `seed`, `temperature`, `numCtx`, `prompt`, `packId`, `draftId`, `queryId` and `run`. `.cache/` is gitignored. Keep prompts files there: a prompts file built from a C-SEO pack holds third-party page text, which this repository never commits.

2. **Copy the prompts and the scripts to the cluster.**

   ```sh
   CE_ROOT=/projects/<your-project>/citation-equity   # the same value as in local.env
   ssh explorer "mkdir -p $CE_ROOT/{batches,code,jobs}"
   scp .cache/batches/espresso-gemma12b.prompts.jsonl explorer:$CE_ROOT/batches/
   scp experiments/explorer/batch_generate.py explorer:$CE_ROOT/code/
   scp experiments/explorer/batch.sbatch experiments/explorer/local.env explorer:$CE_ROOT/jobs/
   ```

3. **Submit the batch job.** `batch.sbatch` sets up the job as `sensitivity.sbatch` does: the Python in `CE_PYTHON`, an optional CUDA forward-compat `LD_LIBRARY_PATH` (`CE_CUDA_COMPAT`), the cached models under `HF_HOME` read offline with the proxy unset, and the allocation in `SBATCH_ACCOUNT`, all from `local.env`. `sbatch` reads `SBATCH_ACCOUNT` when you submit, so the command below sources `local.env` first. It takes its run parameters from the environment:

   | Variable  | Meaning                                                                                                       |
   | --------- | ------------------------------------------------------------------------------------------------------------- |
   | `PROMPTS` | the prompts file (required)                                                                                   |
   | `MODEL`   | the Hugging Face id the prompts were exported for (required; the script refuses any other)                    |
   | `OUT`     | the answers file to write (required)                                                                          |
   | `EXTRA`   | extra flags for `batch_generate.py`, such as `--max-tokens 600`; thinking is off unless you pass `--thinking` |
   | `TP`      | tensor-parallel GPUs (default 1); request the same number in `--gres`                                         |

   ```sh
   ssh explorer "cd $CE_ROOT/jobs && . ./local.env && \
     PROMPTS=../batches/espresso-gemma12b.prompts.jsonl MODEL=google/gemma-4-12B-it \
     OUT=../batches/espresso-gemma12b.answers.jsonl \
     sbatch --gres=gpu:a100:1 batch.sbatch"
   ```

   `batch_generate.py` runs one vLLM offline batch with `enforce_eager=True`, which skips the long `torch.compile` step the smoke test hit. `max_model_len` is the largest `numCtx` in the file. Each prompt goes in as a single user message through the model's chat template, with its own seed and temperature, and at most 1,024 new tokens by default. Thinking is off by default (`enable_thinking=False`), because a reasoning trace carries `[n]` markers of its own; the bench also drops a leading `<think>...</think>` block before scoring. The script writes one `AnswerLine` (`key`, `answer`, `model`) per prompt. It prints how many answers stopped at the token limit, so a high count says to raise `--max-tokens`. Logs land in the folder you submit from, as `ce-batch-<jobid>.out` and `.err`.

4. **Copy the answers back.**

   ```sh
   scp explorer:$CE_ROOT/batches/espresso-gemma12b.answers.jsonl .cache/batches/
   ```

5. **Replay locally.** Use the same command as step 1, with `--answers` in place of `--export-prompts`. The bench runs with a `RecordedAdapter` built from the answers and writes the normal reports (`before.json`, `after.json`, `comparison.json`) to `--out`.

   ```sh
   pnpm --filter @citation-equity/bench ce bench \
     --draft "$PWD/samples/espresso-bitterness/before.md" --after "$PWD/samples/espresso-bitterness/after.md" \
     --pack "$PWD/samples/espresso-bitterness/pack.json" --model google/gemma-4-12B-it \
     --answers "$PWD/.cache/batches/espresso-gemma12b.answers.jsonl" --out "$PWD/.cache/batches/espresso-gemma12b"
   ```

   If any prompt has no answer, the replay stops before writing a report and says how many are missing. The usual cause is a setting that differs from the export. `--answers` also accepts the `recording.json` that `ce bench --record` writes.

Why batch and replay instead of running the bench on the cluster: the cluster's Node.js is v22 (the bench needs 24), and IdleBot cancels a GPU job whose GPU sits under-used for an hour, which an interactive model server waiting on a slow client would risk.

## Per-user limits on Explorer

These are per-user QOS caps. They count every job under the user, in any project. Verified 2026-10-12 with `sacctmgr -n -P show qos format=Name,MaxTRES,MaxTRESPU,MaxJobsPU,MaxSubmitPU`; they change, so re-check.

| Partition         | Default / max time | GPUs per job | Per user: running jobs / queued jobs / GPUs |
| ----------------- | ------------------ | ------------ | ------------------------------------------- |
| `gpu`             | 4 h / 8 h          | 1            | 4 / 8 / 4                                   |
| `gpu-short`       | 1 h / 2 h          | 2            | 2 / 8 / 2                                   |
| `gpu-interactive` | 1 h / 2 h          | 1            | 2 / 4 / none                                |
- `batch.sbatch` asks for `gpu-short` and 1 h 30 min. For a longer batch, pass `--partition=gpu --time=08:00:00` with one GPU. A job asking for more GPUs than its partition allows per job is accepted and then pends forever (`QOSMaxGRESPerJob`): cancel it and resize.
- A ninth queued job on `gpu` is refused at submit time. The sensitivity test hit this limit on 2026-10-23.
- The three partitions share the same nodes, so spreading jobs across them adds job slots, not GPUs.

## Pre-registration

Before any E2 run on a model, read [`PREREG_sensitivity.md`](PREREG_sensitivity.md). It fixes, before running, which models are usable for E2: valid-answer rate at least 0.90, the off-topic floor (H1) and the sensitivity criterion (H2). A model that fails H2 is dropped from E2. Write a new pre-registration, committed before its first run, for any experiment that is not covered there.

## Tests

```sh
python3 -I experiments/explorer/test_batch_generate.py
pnpm --filter @citation-equity/bench exec vitest run test/batch.test.ts
```

The Python tests need no GPU and no vLLM. The bench tests check that `--export-prompts` writes exactly the prompts `runBench` sends, and that a replay from an answers file gives the same reports as a `RecordedAdapter` run.
