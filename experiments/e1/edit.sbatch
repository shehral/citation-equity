#!/bin/bash
# Citation Equity E1: the editor (experiments/PREREG_E1.md, Editor). Gemma-4-31B-it builds every
# edited version of each target: temperature 0, at most 4,096 new tokens, one regenerate per failing
# edit. The engine checks run as a Node subprocess (the bundled experiments/e1/out/bundle/engine_cli.js).
# Copy experiments/e1 to $CE_ROOT/code/e1 and pages.jsonl + applicability.jsonl to $DATA first
# (experiments/e1/README.md). Submit from $CE_ROOT/code/e1 on the cluster:
#   . ./local.env && sbatch --gres=gpu:h200:1 edit.sbatch                                          # one H200
#   . ./local.env && TP=2 sbatch --partition=gpu-short --time=02:00:00 --gres=gpu:a100:2 edit.sbatch  # 2x A100
# Optional: SETS="--set main" (default all sets but timing; the timing smoke: SETS="--set timing"), EXTRA="--arms 9,5,6,7" (tier order cuts),
# DATA=<folder> (default $CE_ROOT/data/e1), MODEL=<editor> (default Gemma-4-31B-it; any other editor, such as
# E2b's Qwen/Qwen3.8-27B, must write to its own DATA folder). E3 (experiments/e3/README.md) passes
# --max-attempts 3 and, for E1's failed pairs, --retry-from in EXTRA, always with its own DATA folder.
# E5 (experiments/e5/README.md) runs with DATA=$CE_ROOT/data/e5 and its options in EXTRA (--q-l-from,
# --q-l-out, --edit-questions, --arms 12,12K); it reads edit_applicability.jsonl and writes
# edit_versions.jsonl and edit_log.jsonl (APPL, VERSIONS, EDIT_LOG override), never versions.jsonl.
# Check the settings first with CE_DRY_RUN=1 bash edit.sbatch
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
# E1's versions.jsonl is written by E1's editor only: another editor needs its own folder.
if [ "$MODEL" != "google/gemma-4-31B-it" ] && [ "${DATA%/}" = "$PROJ/data/e1" ]; then
  echo "FATAL: editor $MODEL would overwrite E1's $DATA/versions.jsonl; set DATA to its own folder (E2b: DATA=\$CE_ROOT/data/e2/b)"
  exit 2
fi
# E3's options change what is written, so they never run on E1's folder either.
case " ${EXTRA:-} " in
  *" --retry-from"*|*" --max-attempts"*)
    if [ "${DATA%/}" = "$PROJ/data/e1" ]; then
      echo "FATAL: EXTRA has E3's --retry-from or --max-attempts, which would overwrite E1's $DATA/versions.jsonl; set DATA to E3's folder (DATA=\$CE_ROOT/data/e3/new or \$CE_ROOT/data/e3/retry)"
      exit 2
    fi ;;
esac
# E5's options and E5's folder: never E1's folder, and never E5's own deterministic versions.jsonl.
E5_RUN=
case " ${EXTRA:-} " in
  *" --edit-questions"*|*" --q-l-from"*|*" --q-l-out"*|*12K*) E5_RUN=1 ;;
esac
case "${DATA%/}" in
  "$PROJ/data/e5"|"$PROJ/data/e5/"*) E5_RUN=1 ;;
esac
APPL=$DATA/applicability.jsonl
VERSIONS=$DATA/versions.jsonl
EDIT_LOG=$DATA/editor_log.jsonl
if [ -n "$E5_RUN" ]; then
  if [ "${DATA%/}" = "$PROJ/data/e1" ]; then
    echo "FATAL: EXTRA has E5's options, which would overwrite E1's $DATA/versions.jsonl; set DATA=\$CE_ROOT/data/e5"
    exit 2
  fi
  APPL=${APPL_E5:-$DATA/edit_applicability.jsonl}
  VERSIONS=${VERSIONS_E5:-$DATA/edit_versions.jsonl}
  EDIT_LOG=${EDIT_LOG_E5:-$DATA/edit_log.jsonl}
  if [ "$VERSIONS" = "$DATA/versions.jsonl" ] || [ "$VERSIONS" = "${DATA%/}/versions.jsonl" ]; then
    echo "FATAL: an E5 edit job writes edit_versions.jsonl; $DATA/versions.jsonl holds E5's deterministic versions"
    exit 2
  fi
fi
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
  [ -n "$E5_RUN" ] && echo "  E5: APPL=$APPL VERSIONS=$VERSIONS EDIT_LOG=$EDIT_LOG"
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
for f in "$DATA/pages.jsonl" "$APPL"; do [ -f "$f" ] || { echo "FATAL: $f missing"; exit 2; }; done
if [ -n "$E5_RUN" ]; then  # E5 runs only on E1's engine bundle, byte for byte
  PIN=1b8e30dbea4e01134302d302fe457e03e2e16baff658c891a9fb3e89fa5a4c47
  GOT=$(sha256sum "$E1/out/bundle/engine_cli.js" | cut -d' ' -f1)
  [ "$GOT" = "$PIN" ] || { echo "FATAL: $E1/out/bundle/engine_cli.js has sha256 $GOT, not E1's $PIN; copy E1's bundle (never rebuild it)"; exit 2; }
fi

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
$PYTHON -c "import torch; assert torch.cuda.is_available(); x=torch.ones(1,device='cuda'); assert (x+1).item()==2; print('torch', torch.__version__, torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"

SNAPDIR=$(ls -d $HF_HOME/hub/models--${MODEL//\//--}/snapshots/*/ 2>/dev/null | head -1)
[ -n "$SNAPDIR" ] && [ -f "$SNAPDIR/config.json" ] || { echo "FATAL: $MODEL not cached under $HF_HOME"; exit 2; }

( while sleep 120; do nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits | sed "s/^/gpu-util: /"; done ) &
WATCH=$!
trap 'kill $WATCH 2>/dev/null' EXIT

$PYTHON -I $E1/editor.py --backend vllm --model "$MODEL" --tp ${TP:-1} \
  --pages $DATA/pages.jsonl --applicability $APPL \
  --out $VERSIONS --log $EDIT_LOG $SETS $EXTRA
echo "=== ce-e1-edit done: $(date) ==="
