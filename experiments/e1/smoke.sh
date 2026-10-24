#!/bin/bash
# E1 local smoke run (PREREG_E1.md, Smoke set): the 8 sample questions through the whole data and
# editing pipeline, with the fake editor and approximate token counts. Outputs go to
# experiments/e1/data/smoke/ (gitignored) and produce no reported results.
# Run from the repository root: bash experiments/e1/smoke.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
E1=$ROOT/experiments/e1
OUT=$E1/data/smoke
mkdir -p "$OUT"
pnpm exec tsup "$E1/engine_cli.ts" --format esm --target node22 -d "$E1/out/bundle" --silent
python3 -I "$E1/normalize.py" --from-samples "$ROOT/samples" --data "$OUT" --approx
python3 -I "$E1/draw.py" --candidates "$OUT/candidates.jsonl" --out "$OUT/pages.jsonl" --summary "$OUT/admission.json"
pnpm --filter @citation-equity/bench exec tsx "$E1/applicability.ts" --data "$OUT"
python3 -I "$E1/editor.py" --backend fake --pages "$OUT/pages.jsonl" --applicability "$OUT/applicability.jsonl" \
  --out "$OUT/versions.jsonl" --log "$OUT/editor_log.jsonl"
