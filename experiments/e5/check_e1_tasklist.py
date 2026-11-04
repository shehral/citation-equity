"""Proof that E5's editor change leaves E1's editor byte for byte as it was: runs E1's editor on
E1's main and replication pages with E1's applicability table and a recording fake backend, and
compares the sha256 of every prompt it sends (key, arm, prompt) and of every row it writes with
the values recorded before the change (2026-11-03 01:24 PST, editor.py at 7c1c725).

Usage: python3 -I experiments/e5/check_e1_tasklist.py   (about 90 s; needs E1's data/ and bundle)
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
E1 = Path(__file__).resolve().parents[1] / "e1"
sys.path.insert(0, str(E1))

import common  # noqa: E402
import editor  # noqa: E402

BEFORE = {"jobs": 1898, "rows": 1146,
          "jobs_sha256": "05671d929fc91c6969e70fb09e04f1c3ce6b2ea8d8cce1b2dcd81afa9c125d8f",
          "rows_sha256": "ecaaf7cc26ff3011a79b75a4a97c3747555968f7e8bf06884349984d00917767"}


class Recording(editor.FakeBackend):
    def __init__(self):
        self.jobs = []

    def generate(self, jobs, **sampling):
        self.jobs += [{"key": j["key"], "arm": j["arm"], "prompt": j["prompt"]} for j in jobs]
        return super().generate(jobs)


def task_list() -> dict:
    data = E1 / "data"
    pages = [p for p in common.read_jsonl(data / "pages.jsonl") if p["set"] in ("main", "replication")]
    rec = Recording()
    rows = editor.run(pages, common.read_jsonl(data / "applicability.jsonl"), rec)
    jobs = "".join(json.dumps(j, ensure_ascii=False) + "\n" for j in rec.jobs)
    vers = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    return {"jobs": len(rec.jobs), "rows": len(rows), "jobs_sha256": hashlib.sha256(jobs.encode()).hexdigest(),
            "rows_sha256": hashlib.sha256(vers.encode()).hexdigest()}


def main() -> None:
    now = task_list()
    print(json.dumps({"before": BEFORE, "now": now, "identical": now == BEFORE}, indent=1))
    sys.exit(0 if now == BEFORE else 1)


if __name__ == "__main__":
    main()
