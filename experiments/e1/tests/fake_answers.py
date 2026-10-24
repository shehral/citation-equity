"""Recorded fake answers for the smoke run: one deterministic answer per prompt key, no model.

About 1 in 10 answers carries no citation (a format failure). Arms 9 and ALL cite the target
first, so the smoke run has a visible effect; every other version cites a seeded order.

Run: python3 -I experiments/e1/tests/fake_answers.py <data dir>   (reads prompts.jsonl, writes answers/)
"""

from __future__ import annotations

import json
import random
import sys
from collections import defaultdict
from pathlib import Path

MODELS = {"gemma-4-12b": "google/gemma-4-12B-it", "qwen3.8-27b": "Qwen/Qwen3.8-27B"}


def fake_answer(row: dict) -> str:
    rng = random.Random(row["key"])
    if rng.random() < 0.1:
        return "The sources disagree, so no single answer is given."
    slots = [1, 2, 3, 4]
    rng.shuffle(slots)
    if row["arm"] in ("9", "ALL"):
        slots.remove(row["slot"])
        slots.insert(0, row["slot"])
    n = rng.randint(1, 3)
    return " ".join(f"Point {i + 1} about the question [{s}]." for i, s in enumerate(slots[:n]))


def write_answers(data_dir: Path) -> None:
    rows = [json.loads(x) for x in (data_dir / "prompts.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()]
    groups = defaultdict(list)
    for row in rows:
        groups[(row["set"], row["judge"])].append(row)
    out = data_dir / "answers"
    out.mkdir(parents=True, exist_ok=True)
    for (set_name, judge), group in groups.items():
        lines = [json.dumps({"key": r["key"], "answer": fake_answer(r), "model": MODELS.get(judge, judge)}) for r in group]
        (out / f"{set_name}.{judge}.fake.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: fake_answers.py <data dir>")
    write_answers(Path(sys.argv[1]))
