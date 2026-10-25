"""Reuses E1 answers for E2 prompts that are byte-identical to E1's (experiments/PLAN_E2.md, E2b).

E2b judges the originals of the main set again, with Gemma-4-12B and Qwen3.5-9B. Gemma's answers
for an original may come from E1 only when the E2b prompt is byte-identical to the E1 prompt with
the same key (same judge, version, seed); every other prompt is generated. This script:

- reads the E2 folder's prompts.jsonl (from build_prompts.py) and keeps the rows of --judge and --arms;
- streams E1's prompts.jsonl and answers (only the keys it needs are parsed);
- writes the E1 answer of every byte-identical prompt to <answers-out>/reused-e1.<judge>.jsonl
  (default <data>/answers, the folder score.py reads);
- removes those keys from the E2 folder's batch files, so the cluster does not answer them again;
- writes <data>/reuse.json: how many were reused and, for each prompt that was not, why.
prompts.jsonl itself is left whole: score.py needs every key. Running it twice gives the same files.

Usage: python3 -I experiments/e2/reuse_answers.py --data DIR --e1-prompts FILE --e1-answers DIR
           [--judge gemma-4-12b] [--arms original] [--answers-out DIR]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "e1"))

from e1_common import read_jsonl, write_json, write_jsonl  # noqa: E402

_KEY = re.compile(r'^\{"key": "((?:[^"\\]|\\.)*)"')


def line_key(line: str) -> str | None:
    """The key of a prompts.jsonl or answers line written by json.dumps, without parsing the line."""
    m = _KEY.match(line)
    return json.loads(f'"{m.group(1)}"') if m else None


def _scan(path: Path, wanted: set[str]):
    """Rows of a JSONL file whose key is in `wanted`, read line by line."""
    with Path(path).open(encoding="utf-8") as f:
        for line in f:
            key = line_key(line)
            if key is not None and key in wanted:
                yield json.loads(line)


def reuse(e2_prompts: list[dict], e1_prompts: Path, e1_answers: Path, judge: str, arms: list[str]):
    """(reused answer rows, not-reused [{key, reason}]) for the E2 prompts of `judge` and `arms`."""
    rows = {p["key"]: p for p in e2_prompts if p["judge"] == judge and p["arm"] in arms}
    wanted = set(rows)
    e1 = {r["key"]: r["prompt"] for r in _scan(e1_prompts, wanted)}
    identical = {k for k in wanted if e1.get(k) == rows[k]["prompt"]}
    answers = {}
    for path in sorted(Path(e1_answers).glob("*.jsonl")):
        for r in _scan(path, identical):
            if r["key"] in answers and answers[r["key"]]["answer"] != r["answer"]:
                raise ValueError(f"key {r['key']} has two different E1 answers (second in {path.name})")
            answers[r["key"]] = r
    reused, rebuilt = [], []
    for key in sorted(wanted):
        if key not in e1:
            rebuilt.append({"key": key, "reason": "no E1 prompt with this key"})
        elif key not in identical:
            rebuilt.append({"key": key, "reason": "the E1 prompt differs"})
        elif key not in answers:
            rebuilt.append({"key": key, "reason": "no E1 answer"})
        else:
            reused.append(answers[key] | {"reused_from": "e1"})
    return reused, rebuilt


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="the E2 folder (prompts.jsonl and batches/ from build_prompts.py)")
    ap.add_argument("--e1-prompts", required=True, help="the prompts.jsonl E1's batches were built from")
    ap.add_argument("--e1-answers", required=True, help="the folder of E1's answer files (*.jsonl)")
    ap.add_argument("--judge", default="gemma-4-12b")
    ap.add_argument("--arms", default="original", help="comma-separated arms whose answers may be reused")
    ap.add_argument("--answers-out", help="where reused-e1.<judge>.jsonl goes (default <data>/answers)")
    args = ap.parse_args(argv)
    data = Path(args.data)
    arms = args.arms.split(",")
    reused, rebuilt = reuse(read_jsonl(data / "prompts.jsonl"), Path(args.e1_prompts), Path(args.e1_answers),
                            args.judge, arms)
    answers_out = Path(args.answers_out) if args.answers_out else data / "answers"
    write_jsonl(answers_out / f"reused-e1.{args.judge}.jsonl", reused)
    gone = {r["key"] for r in reused}
    batches = {}
    for path in sorted((data / "batches").glob(f"*.{args.judge}.tier*.prompts.jsonl")):
        lines = read_jsonl(path)
        kept = [x for x in lines if x["key"] not in gone]
        if len(kept) != len(lines):
            write_jsonl(path, kept)
        batches[path.name.removesuffix(".prompts.jsonl")] = {"before": len(lines), "after": len(kept)}
    write_json(data / "reuse.json", {"judge": args.judge, "arms": arms, "reused": len(reused),
                                     "not_reused": len(rebuilt), "rebuilt": rebuilt, "batches": batches})
    print(f"reuse_answers: {len(reused)} reused from E1, {len(rebuilt)} left to generate "
          f"({args.judge}, arms {', '.join(arms)}); answers in {answers_out}")


if __name__ == "__main__":
    main()
