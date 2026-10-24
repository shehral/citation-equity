#!/bin/bash
# Citation Equity: answer a bench prompts file in one vLLM batch (experiments/README.md).
# Submit from the cluster:
#   PROMPTS=<prompts.jsonl> MODEL=<hf id> OUT=<answers.jsonl> [EXTRA=--thinking] [TP=2] \
#     sbatch --gres=gpu:<type>:<TP, default 1> batch.sbatch
# gpu-short allows 2 GPUs per job and 2 hours; for longer runs add --partition=gpu --time=<= 08:00:00 (1 GPU).
#SBATCH --job-name=ce-batch
#SBATCH --partition=gpu-short
#SBATCH --nodes=1 --ntasks=1 --cpus-per-task=8
#SBATCH --mem=64G
#SBATCH --time=01:30:00
#SBATCH --output=%x-%j.out
#SBATCH --error=%x-%j.err
#SBATCH --export=ALL
set -e
set -o pipefail
: "${PROMPTS:?set PROMPTS to the prompts file from ce bench --export-prompts}"
: "${MODEL:?set MODEL to the Hugging Face id the prompts were exported for}"
: "${OUT:?set OUT to the answers file to write}"
echo "=== ce-batch start: $(date) on $(hostname) model=$MODEL prompts=$PROMPTS out=$OUT tp=${TP:-1} extra=$EXTRA ==="
[ -f "$PROMPTS" ] || { echo "FATAL: prompts file $PROMPTS not found"; exit 2; }

# Site settings come from the environment, or from local.env next to this file on the cluster
# (gitignored; copy local.env.example). Nothing about one person's account is in this file.
#   SBATCH_ACCOUNT  your Slurm allocation; sbatch reads it at submit time, so submit with
#                   `. ./local.env && sbatch ...` (or pass --account)
#   CE_ROOT         the project folder on the cluster, holding code/ (and data/, results/)
#   CE_PYTHON       the Python of an env with vLLM and torch
#   HF_HOME         the Hugging Face cache that holds the model (read offline)
#   CE_CUDA_COMPAT  optional: NVIDIA forward-compat libcuda folder, when the env's torch needs a
#                   newer CUDA than the node driver
#   CE_MODULES      optional: modules to load first (default: miniconda3/24.11.1, Explorer's)
LOCAL_ENV="${SLURM_SUBMIT_DIR:-.}/local.env"
# shellcheck source=/dev/null
[ -f "$LOCAL_ENV" ] && . "$LOCAL_ENV"
: "${CE_ROOT:?set CE_ROOT to the project folder on the cluster (see local.env.example)}"
: "${CE_PYTHON:?set CE_PYTHON to the Python of an env with vLLM (see local.env.example)}"
: "${HF_HOME:?set HF_HOME to the Hugging Face cache that holds the model (see local.env.example)}"
PROJ=$CE_ROOT
source /etc/profile
module purge
for m in ${CE_MODULES-miniconda3/24.11.1}; do module load "$m"; done
export PATH=$(dirname "$CE_PYTHON"):$PATH
PYTHON=$CE_PYTHON
[ -n "${CE_CUDA_COMPAT:-}" ] && export LD_LIBRARY_PATH=$CE_CUDA_COMPAT:$LD_LIBRARY_PATH

# Models are read from the cache offline (read-only use here).
export HF_HOME
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_DATASETS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DISABLE_PROGRESS_BARS=1
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
$PYTHON -c "import torch; assert torch.cuda.is_available(); x=torch.ones(1,device='cuda'); assert (x+1).item()==2; print('torch', torch.__version__, torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"

SNAPDIR=$(ls -d $HF_HOME/hub/models--${MODEL//\//--}/snapshots/*/ 2>/dev/null | head -1)
[ -n "$SNAPDIR" ] && [ -f "$SNAPDIR/config.json" ] || { echo "FATAL: $MODEL not cached under $HF_HOME"; exit 2; }

( while sleep 120; do nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits | sed "s/^/gpu-util: /"; done ) &
WATCH=$!
trap 'kill $WATCH 2>/dev/null' EXIT

$PYTHON $PROJ/code/batch_generate.py --prompts "$PROMPTS" --model "$MODEL" --out "$OUT" --tp ${TP:-1} $EXTRA
echo "=== ce-batch done: $(date) ==="
