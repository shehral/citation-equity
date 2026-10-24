#!/bin/bash
# Citation Equity E1: normalization and the 3,000-token cap with the two judge tokenizers
# (experiments/PREREG_E1.md, Data 4-5). CPU only; the tokenizers are read from the cached models.
# Copy experiments/e1 to $CE_ROOT/code/e1 and the raw fetch records to $DATA/raw/ first
# (experiments/e1/README.md). Submit from $CE_ROOT/code/e1 on the cluster:
#   . ./local.env && sbatch normalize.sbatch
# Optional: DATA=<folder> (default $CE_ROOT/data/e1). Check the settings first with
#   CE_DRY_RUN=1 bash normalize.sbatch
#SBATCH --job-name=ce-e1-norm
#SBATCH --partition=short
#SBATCH --nodes=1 --ntasks=1 --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=02:00:00
#SBATCH --output=%x-%j.out
#SBATCH --error=%x-%j.err
#SBATCH --export=ALL
set -e
set -o pipefail

# Site settings come from the environment, or from local.env next to this file on the cluster
# (gitignored; copy local.env.example). Nothing about one person's account is in this file.
#   SBATCH_ACCOUNT  your Slurm allocation; sbatch reads it at submit time, so submit with
#                   `. ./local.env && sbatch ...` (or pass --account)
#   CE_ROOT         the project folder on the cluster, holding code/e1 and data/e1
#   CE_PYTHON       the Python of an env with transformers (for the tokenizers)
#   HF_HOME         the Hugging Face cache that holds the two judge models (read offline)
#   CE_MODULES      optional: modules to load first (default: miniconda3/24.11.1, Explorer's)
#   SBATCH_OUTPUT, SBATCH_ERROR  optional: log paths, such as $CE_ROOT/logs/%x-%j.out
#                   (default: %x-%j.out and .err in the folder you submit from)
LOCAL_ENV="${SLURM_SUBMIT_DIR:-.}/local.env"
# shellcheck source=/dev/null
[ -f "$LOCAL_ENV" ] && . "$LOCAL_ENV"
: "${CE_ROOT:?set CE_ROOT to the project folder on the cluster (see local.env.example)}"
: "${CE_PYTHON:?set CE_PYTHON to the Python of an env with transformers (see local.env.example)}"
: "${HF_HOME:?set HF_HOME to the Hugging Face cache that holds the judge models (see local.env.example)}"
PROJ=$CE_ROOT
E1=$PROJ/code/e1
DATA=${DATA:-$PROJ/data/e1}
MODULES=${CE_MODULES-miniconda3/24.11.1}
if [ -n "${CE_DRY_RUN:-}" ]; then
  echo "ce-e1-norm dry run: resolved settings (nothing loaded or run)"
  echo "  SBATCH_ACCOUNT=${SBATCH_ACCOUNT:-<unset: the cluster default>}"
  echo "  CE_ROOT=$CE_ROOT"
  echo "  CE_PYTHON=$CE_PYTHON"
  echo "  HF_HOME=$HF_HOME"
  echo "  CE_MODULES=$MODULES"
  echo "  E1=$E1"
  echo "  DATA=$DATA"
  echo "  logs=${SBATCH_OUTPUT:-%x-%j.out in the submit folder}"
  exit 0
fi

echo "=== ce-e1-norm start: $(date) on $(hostname) ==="
source /etc/profile
module purge
for m in $MODULES; do module load "$m"; done
export PATH=$(dirname "$CE_PYTHON"):$PATH
PYTHON=$CE_PYTHON
export HF_HOME
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_DATASETS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DISABLE_PROGRESS_BARS=1
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY

$PYTHON -I $E1/normalize.py --data $DATA --tokenizers google/gemma-4-12B-it,Qwen/Qwen3.8-27B
echo "=== ce-e1-norm done: $(date) ==="
