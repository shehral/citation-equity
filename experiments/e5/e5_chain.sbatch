#!/bin/bash
# E5: answer several batch files (or shards) in one GPU allocation, one after another, with one judge.
# Operational only: each file runs through E1's generate.sbatch unchanged (same settings check, same
# batch_generate.py call, same refusal to overwrite an existing answers file), so the answers are
# exactly what separate jobs would write. Used when per-user submit limits leave fewer job slots
# than batch files.
#
#   cd $CE_ROOT/code/e1 && . ./local.env && \
#     JUDGE=gemma-4-12b BATCHES="e5-main.gemma-4-12b.tier1-p1of2 e5-main.gemma-4-12b.tier1-p2of2" \
#     sbatch --gres=gpu:a100:1 $CE_ROOT/code/e5/e5_chain.sbatch
#
# Submit from the folder whose local.env should apply (generate.sbatch reads $SLURM_SUBMIT_DIR/local.env).
#SBATCH --job-name=ce-e5-chain
#SBATCH --partition=gpu
#SBATCH --nodes=1 --ntasks=1 --cpus-per-task=8
#SBATCH --gres=gpu:1
#SBATCH --mem=64G
#SBATCH --time=08:00:00
#SBATCH --export=ALL
set -u
: "${JUDGE:?set JUDGE (gemma-4-12b or qwen3.8-27b)}"
: "${BATCHES:?set BATCHES to a space-separated list of E5 batch names}"
LOCAL_ENV="${SLURM_SUBMIT_DIR:-.}/local.env"
# shellcheck source=/dev/null
[ -f "$LOCAL_ENV" ] && . "$LOCAL_ENV"
: "${CE_ROOT:?set CE_ROOT (local.env)}"
GEN=$CE_ROOT/code/e1/generate.sbatch
status=0
for b in $BATCHES; do
  echo "=== ce-e5-chain: $b start $(date) ==="
  if [ -e "$CE_ROOT/e5/answers/$b.jsonl" ]; then
    echo "=== ce-e5-chain: $b skipped (answers file exists) ==="
    continue
  fi
  RUN=e5 JUDGE=$JUDGE BATCH=$b bash "$GEN" || { echo "=== ce-e5-chain: $b FAILED (exit $?) ==="; status=1; }
  echo "=== ce-e5-chain: $b end $(date) ==="
done
exit $status
