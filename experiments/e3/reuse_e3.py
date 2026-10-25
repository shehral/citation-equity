"""Reuses E1 answers for E3 prompts that are byte-identical to E1's (experiments/PLAN_E3.md: "the
answers E1 already has are reused"), with E2's rule and code (experiments/e2/reuse_answers.py).

An E3 prompt takes E1's answer only when E1 has a prompt with the same key (judge, version, seed)
and the two prompts are byte for byte the same; every other prompt is generated. For each judge in
--judges, over every arm of the folder's prompts.jsonl, this script:
- writes the reused E1 answers to <answers-out>/reused-e1.<judge>.jsonl (default <data>/answers,
  the folder score.py reads);
- removes those keys from the folder's batch files, so the cluster does not answer them again;
- writes <data>/reuse.json: per judge, how many were reused and, for the rest, how many for each
  reason (no E1 prompt with this key, the E1 prompt differs, no E1 answer), with a few example keys.
prompts.jsonl itself is left whole: score.py needs every key. Running it twice gives the same files.

Most E3 keys have no E1 prompt at all: the new queries are not E1's, and a retried version was
invalid in E1, so E1 built no prompt for it. The pairs E3 leaves as E1 made them are never rebuilt:
analyze_e3.py reads E1's cells for them.

Usage: python3 -I experiments/e3/reuse_e3.py --data DIR --e1-prompts FILE --e1-answers DIR
           [--judges gemma-4-12b,qwen3.8-27b] [--answers-out DIR]
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.dont_write_bytecode = True
E3_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(E3_DIR.parent / "e1"))
sys.path.insert(0, str(E3_DIR.parent / "e2"))

import reuse_answers as ra  # noqa: E402
from e1_common import JUDGE_ORDER, read_jsonl, write_json, write_jsonl  # noqa: E402

EXAMPLES = 10


def reuse_folder(data: Path, e1_prompts: Path, e1_answers: Path, judges: list[str], answers_out: Path) -> dict:
    prompts = read_jsonl(data / "prompts.jsonl")
    report = {}
    for judge in judges:
        arms = sorted({p["arm"] for p in prompts if p["judge"] == judge})
        reused, rebuilt = ra.reuse(prompts, e1_prompts, e1_answers, judge, arms)
        write_jsonl(answers_out / f"reused-e1.{judge}.jsonl", reused)
        gone = {r["key"] for r in reused}
        batches = {}
        for path in sorted((data / "batches").glob(f"*.{judge}.tier*.prompts.jsonl")):
            lines = read_jsonl(path)
            kept = [x for x in lines if x["key"] not in gone]
            if len(kept) != len(lines):
                write_jsonl(path, kept)
            batches[path.name.removesuffix(".prompts.jsonl")] = {"before": len(lines), "after": len(kept)}
        report[judge] = {"arms": arms, "reused": len(reused), "not_reused": len(rebuilt),
                         "reasons": dict(Counter(r["reason"] for r in rebuilt)),
                         "examples": rebuilt[:EXAMPLES], "batches": batches}
    write_json(data / "reuse.json", {"judges": report})
    return report


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="an E3 folder (prompts.jsonl and batches/ from build_prompts.py)")
    ap.add_argument("--e1-prompts", required=True, help="the prompts.jsonl E1's batches were built from")
    ap.add_argument("--e1-answers", required=True, help="the folder of E1's answer files (*.jsonl)")
    ap.add_argument("--judges", default=",".join(JUDGE_ORDER))
    ap.add_argument("--answers-out", help="where reused-e1.<judge>.jsonl goes (default <data>/answers)")
    args = ap.parse_args(argv)
    data = Path(args.data)
    out = Path(args.answers_out) if args.answers_out else data / "answers"
    report = reuse_folder(data, Path(args.e1_prompts), Path(args.e1_answers), args.judges.split(","), out)
    for judge, r in report.items():
        print(f"reuse_e3: {judge}: {r['reused']} reused from E1, {r['not_reused']} left to generate "
              f"({', '.join(f'{k}: {v}' for k, v in sorted(r['reasons'].items())) or 'none'})")


if __name__ == "__main__":
    main()
