#!/bin/bash
# Citation Equity E1 generation (experiments/PREREG_E1.md r2, Measurement 2): answers one batch file
# from build_prompts.py with experiments/explorer/batch_generate.py, unchanged.
#
# Fixed by the pre-registration: judges Gemma-4-12B-it and Qwen3.8-27B with thinking off,
# temperature 0.5 and seeds 1-8 (carried in every prompt line), at most 1,024 new tokens,
# max_model_len 32,768 (the numCtx of every line; this script refuses any other value).
# One job per (set, judge, tier). Run plan: tiers in order, Gemma before Qwen within each tier.
#
# Submit from $CE_ROOT/code/e1 on the cluster (batch_generate.py in $CE_ROOT/code, batch files in
# $CE_ROOT/$RUN/batches, RUN defaulting to e1; E2 uses RUN=e2/a and RUN=e2/b, experiments/e2/README.md):
#   . ./local.env && JUDGE=gemma-4-12b BATCH=main.gemma-4-12b.tier1 sbatch --gres=gpu:a100:1 generate.sbatch
#   . ./local.env && JUDGE=qwen3.8-27b BATCH=main.qwen3.8-27b.tier1 sbatch --gres=gpu:h200:1 generate.sbatch
# Answers land in $CE_ROOT/$RUN/answers/<BATCH>.jsonl; copy them to experiments/e1/data/answers/ for score.py.
# E2b's second judge (experiments/PLAN_E2.md) is JUDGE=qwen3.5-9b, Qwen3.5-9B.
# Check the settings first with CE_DRY_RUN=1 JUDGE=... BATCH=... bash generate.sbatch
#SBATCH --job-name=ce-e1-gen
#SBATCH --partition=gpu
#SBATCH --nodes=1 --ntasks=1 --cpus-per-task=8
#SBATCH --gres=gpu:1
#SBATCH --mem=64G
#SBATCH --time=08:00:00
#SBATCH --output=%x-%j.out
#SBATCH --error=%x-%j.err
#SBATCH --export=ALL
set -e
set -o pipefail
: "${JUDGE:?set JUDGE to gemma-4-12b, qwen3.8-27b or qwen3.5-9b}"
: "${BATCH:?set BATCH to a batch name from build_prompts.py, such as main.gemma-4-12b.tier1}"
case "$JUDGE" in
  gemma-4-12b) MODEL=google/gemma-4-12B-it ;;
  qwen3.8-27b) MODEL=Qwen/Qwen3.8-27B ;;
  qwen3.5-9b) MODEL=Qwen/Qwen3.5-9B ;;
  *) echo "FATAL: unknown JUDGE $JUDGE (the editor Gemma-4-31B is never a judge)"; exit 2 ;;
esac
case "$BATCH" in
  *".$JUDGE.tier"*) ;;
  *) echo "FATAL: batch $BATCH is not for judge $JUDGE"; exit 2 ;;
esac

# Site settings come from the environment, or from local.env next to this file on the cluster
# (gitignored; copy local.env.example). Nothing about one person's account is in this file.
#   SBATCH_ACCOUNT  your Slurm allocation; sbatch reads it at submit time, so submit with
#                   `. ./local.env && sbatch ...` (or pass --account)
#   CE_ROOT         the project folder on the cluster, holding code/ and e1/batches
#   CE_PYTHON       the Python of an env with vLLM and torch
#   HF_HOME         the Hugging Face cache that holds the judge models (read offline)
#   CE_CUDA_COMPAT  optional: NVIDIA forward-compat libcuda folder, when the env's torch needs a
#                   newer CUDA than the node driver
#   CE_MODULES      optional: modules to load first (default: miniconda3/24.11.1, Explorer's)
#   SBATCH_OUTPUT, SBATCH_ERROR  optional: log paths, such as $CE_ROOT/logs/%x-%j.out
#                   (default: %x-%j.out and .err in the folder you submit from)
LOCAL_ENV="${SLURM_SUBMIT_DIR:-.}/local.env"
# shellcheck source=/dev/null
[ -f "$LOCAL_ENV" ] && . "$LOCAL_ENV"
: "${CE_ROOT:?set CE_ROOT to the project folder on the cluster (see local.env.example)}"
: "${CE_PYTHON:?set CE_PYTHON to the Python of an env with vLLM (see local.env.example)}"
: "${HF_HOME:?set HF_HOME to the Hugging Face cache that holds the judge models (see local.env.example)}"
PROJ=$CE_ROOT
RUN=${RUN:-e1}
PROMPTS=$PROJ/$RUN/batches/$BATCH.prompts.jsonl
OUT=$PROJ/$RUN/answers/$BATCH.jsonl
MODULES=${CE_MODULES-miniconda3/24.11.1}
if [ -n "${CE_DRY_RUN:-}" ]; then
  echo "ce-e1-gen dry run: resolved settings (nothing loaded or run)"
  echo "  SBATCH_ACCOUNT=${SBATCH_ACCOUNT:-<unset: the cluster default>}"
  echo "  CE_ROOT=$CE_ROOT"
  echo "  CE_PYTHON=$CE_PYTHON"
  echo "  HF_HOME=$HF_HOME"
  echo "  CE_CUDA_COMPAT=${CE_CUDA_COMPAT:-<unset>}"
  echo "  CE_MODULES=$MODULES"
  echo "  JUDGE=$JUDGE MODEL=$MODEL tp=${TP:-1}"
  echo "  PROMPTS=$PROMPTS"
  echo "  OUT=$OUT"
  echo "  logs=${SBATCH_OUTPUT:-%x-%j.out in the submit folder}"
  exit 0
fi

echo "=== ce-e1-gen start: $(date) on $(hostname) judge=$JUDGE model=$MODEL prompts=$PROMPTS out=$OUT tp=${TP:-1} ==="
[ -f "$PROMPTS" ] || { echo "FATAL: prompts file $PROMPTS not found"; exit 2; }
[ -e "$OUT" ] && { echo "FATAL: $OUT exists; move it aside before re-running (score.py refuses two answers per key)"; exit 2; }

source /etc/profile
module purge
for m in $MODULES; do module load "$m"; done
export PATH=$(dirname "$CE_PYTHON"):$PATH
PYTHON=$CE_PYTHON
[ -n "${CE_CUDA_COMPAT:-}" ] && export LD_LIBRARY_PATH=$CE_CUDA_COMPAT:$LD_LIBRARY_PATH

# Models are read from the cache offline (read-only use here).
export HF_HOME
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_DATASETS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DISABLE_PROGRESS_BARS=1
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# Settings check before loading a model: every line must carry the pre-registered context and temperature.
$PYTHON -I -c '
import json, sys
bad = 0
with open(sys.argv[1], encoding="utf-8") as f:
    for line in f:
        if line.strip():
            p = json.loads(line)
            bad += p["numCtx"] != 32768 or p["temperature"] != 0.5 or p["model"] != sys.argv[2] or not 1 <= p["seed"] <= 8
sys.exit(f"FATAL: {bad} prompt lines break the pre-registered settings") if bad else print("settings ok")
' "$PROMPTS" "$MODEL"

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
$PYTHON -c "import torch; assert torch.cuda.is_available(); x=torch.ones(1,device='cuda'); assert (x+1).item()==2; print('torch', torch.__version__, torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"

SNAPDIR=$(ls -d $HF_HOME/hub/models--${MODEL//\//--}/snapshots/*/ 2>/dev/null | head -1)
[ -n "$SNAPDIR" ] && [ -f "$SNAPDIR/config.json" ] || { echo "FATAL: $MODEL not cached under $HF_HOME"; exit 2; }

( while sleep 120; do nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits | sed "s/^/gpu-util: /"; done ) &
WATCH=$!
trap 'kill $WATCH 2>/dev/null' EXIT

mkdir -p "$(dirname "$OUT")"
$PYTHON $PROJ/code/batch_generate.py --prompts "$PROMPTS" --model "$MODEL" --out "$OUT" \
  --no-thinking --max-tokens 1024 --tp ${TP:-1}
echo "=== ce-e1-gen done: $(date) ==="
