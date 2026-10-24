#!/bin/bash
# Citation Equity E1: the editor (experiments/PREREG_E1.md, Editor). Gemma-4-31B-it builds every
# edited version of each target: temperature 0, at most 4,096 new tokens, one regenerate per failing
# edit. The engine checks run as a Node subprocess (the bundled experiments/e1/out/bundle/engine_cli.js).
# Copy experiments/e1 to $CE_ROOT/code/e1 and pages.jsonl + applicability.jsonl to $DATA first
# (experiments/e1/README.md). Submit from $CE_ROOT/code/e1 on the cluster:
#   . ./local.env && sbatch --gres=gpu:h200:1 edit.sbatch                                          # one H200
#   . ./local.env && TP=2 sbatch --partition=gpu-short --time=02:00:00 --gres=gpu:a100:2 edit.sbatch  # 2x A100
# Optional: SETS="--set main" (default all sets but timing; the timing smoke: SETS="--set timing"), EXTRA="--arms 9,5,6,7" (tier order cuts),
# DATA=<folder> (default $CE_ROOT/data/e1). Check the settings first with CE_DRY_RUN=1 bash edit.sbatch
#SBATCH --job-name=ce-e1-edit
#SBATCH --partition=gpu
#SBATCH --nodes=1 --ntasks=1 --cpus-per-task=8
#SBATCH --mem=96G
#SBATCH --time=08:00:00
#SBATCH --output=%x-%j.out
#SBATCH --error=%x-%j.err
#SBATCH --export=ALL
set -e
set -o pipefail
MODEL=${MODEL:-google/gemma-4-31B-it}

# Site settings come from the environment, or from local.env next to this file on the cluster
# (gitignored; copy local.env.example). Nothing about one person's account is in this file.
#   SBATCH_ACCOUNT  your Slurm allocation; sbatch reads it at submit time, so submit with
#                   `. ./local.env && sbatch ...` (or pass --account)
#   CE_ROOT         the project folder on the cluster, holding code/e1 and data/e1
#   CE_PYTHON       the Python of an env with vLLM and torch
#   HF_HOME         the Hugging Face cache that holds the model (read offline)
#   CE_NODE         optional: a Node 22 or newer binary for the engine bridge (default: node on
#                   the PATH, for example from a module named in CE_MODULES)
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
: "${HF_HOME:?set HF_HOME to the Hugging Face cache that holds the model (see local.env.example)}"
PROJ=$CE_ROOT
E1=$PROJ/code/e1
DATA=${DATA:-$PROJ/data/e1}
NODE=${CE_NODE:-node}
MODULES=${CE_MODULES-miniconda3/24.11.1}
if [ -n "${CE_DRY_RUN:-}" ]; then
  echo "ce-e1-edit dry run: resolved settings (nothing loaded or run)"
  echo "  SBATCH_ACCOUNT=${SBATCH_ACCOUNT:-<unset: the cluster default>}"
  echo "  CE_ROOT=$CE_ROOT"
  echo "  CE_PYTHON=$CE_PYTHON"
  echo "  HF_HOME=$HF_HOME"
  echo "  CE_NODE=$NODE"
  echo "  CE_CUDA_COMPAT=${CE_CUDA_COMPAT:-<unset>}"
  echo "  CE_MODULES=$MODULES"
  echo "  E1=$E1"
  echo "  DATA=$DATA"
  echo "  MODEL=$MODEL tp=${TP:-1} sets=${SETS:-all but timing} extra=${EXTRA:-}"
  echo "  logs=${SBATCH_OUTPUT:-%x-%j.out in the submit folder}"
  exit 0
fi

echo "=== ce-e1-edit start: $(date) on $(hostname) model=$MODEL tp=${TP:-1} sets=${SETS:-all but timing} extra=$EXTRA ==="
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

# The engine bridge needs Node 22 or newer (the bundle targets node22 and has no dependencies).
NODE_MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null) ||
  { echo "FATAL: no Node.js at '$NODE'; set CE_NODE to a node binary or load a Node 22 module in CE_MODULES (see local.env.example)"; exit 2; }
[ "$NODE_MAJOR" -ge 22 ] 2>/dev/null ||
  { echo "FATAL: $NODE is Node $NODE_MAJOR; the engine bridge needs Node 22 or newer (set CE_NODE or CE_MODULES)"; exit 2; }
echo "node $("$NODE" --version) at $NODE"
export E1_ENGINE="$NODE $E1/out/bundle/engine_cli.js"
[ -f "$E1/out/bundle/engine_cli.js" ] || { echo "FATAL: $E1/out/bundle/engine_cli.js missing; build and copy it"; exit 2; }
for f in pages.jsonl applicability.jsonl; do [ -f "$DATA/$f" ] || { echo "FATAL: $DATA/$f missing"; exit 2; }; done

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
$PYTHON -c "import torch; assert torch.cuda.is_available(); x=torch.ones(1,device='cuda'); assert (x+1).item()==2; print('torch', torch.__version__, torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"

SNAPDIR=$(ls -d $HF_HOME/hub/models--${MODEL//\//--}/snapshots/*/ 2>/dev/null | head -1)
[ -n "$SNAPDIR" ] && [ -f "$SNAPDIR/config.json" ] || { echo "FATAL: $MODEL not cached under $HF_HOME"; exit 2; }

( while sleep 120; do nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits | sed "s/^/gpu-util: /"; done ) &
WATCH=$!
trap 'kill $WATCH 2>/dev/null' EXIT

$PYTHON -I $E1/editor.py --backend vllm --model "$MODEL" --tp ${TP:-1} \
  --pages $DATA/pages.jsonl --applicability $DATA/applicability.jsonl \
  --out $DATA/versions.jsonl --log $DATA/editor_log.jsonl $SETS $EXTRA
echo "=== ce-e1-edit done: $(date) ==="
